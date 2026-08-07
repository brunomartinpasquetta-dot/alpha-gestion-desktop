/**
 * Tesoreria: caja diaria y cobranzas/pagos de cuenta corriente.
 *
 * CAJA. Solo puede haber UNA caja abierta a la vez: si hubiera dos, un cobro no
 * sabria a cual entrar y el arqueo perderia sentido. Al cerrar se calcula el
 * teorico (apertura + ingresos - egresos), se compara con lo que el operador
 * conto de verdad y la diferencia queda registrada: es el dato que revela
 * faltantes, vueltos mal dados o ventas sin cargar.
 *
 * COBROS Y PAGOS. Un cobro a cliente y un pago a proveedor son el mismo hecho
 * con el signo invertido, y ambos tocan dos ledgers a la vez: la cuenta
 * corriente y —si es en efectivo— la caja. Por eso van en una transaccion.
 * En cheque no tocan la caja: el cheque tiene su propia cartera.
 */

import { eq, sql } from 'drizzle-orm';

import type {
  CajaVista,
  EntradaCierreCaja,
  EntradaCobroPago,
  EntradaMovimientoCaja,
  ResultadoCobroPago,
  ResultadoMovimientoCaja,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  cajaMovimientos,
  cajas,
  clientes,
  cuentasCorrientes,
  proveedores,
} from '../db/schema';
import {
  ejecutarSeguro,
  ErrorNoEncontrado,
  ErrorReglaNegocio,
  ErrorValidacion,
} from '../dominio/errores';
import { emitir } from '../eventos';
import { esCentavosValido } from '../utiles/numeros';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

function vistaCaja(tx: Tx, cajaId: number): CajaVista {
  const fila = tx
    .select({
      id: cajas.id,
      fechaApertura: cajas.fechaApertura,
      fechaCierre: cajas.fechaCierre,
      montoApertura: cajas.montoApertura,
      montoCierreTeorico: cajas.montoCierreTeorico,
      montoCierreReal: cajas.montoCierreReal,
      diferencia: cajas.diferencia,
      estado: cajas.estado,
      usuario: cajas.usuario,
      cantidadMovimientos: sql<number>`(SELECT COUNT(*) FROM caja_movimientos WHERE caja_id = ${cajas.id})`.mapWith(Number),
      totalIngresos: sql<number>`COALESCE((SELECT SUM(monto) FROM caja_movimientos WHERE caja_id = ${cajas.id} AND tipo = 'ingreso'), 0)`.mapWith(Number),
      totalEgresos: sql<number>`COALESCE((SELECT SUM(monto) FROM caja_movimientos WHERE caja_id = ${cajas.id} AND tipo = 'egreso'), 0)`.mapWith(Number),
    })
    .from(cajas)
    .where(eq(cajas.id, cajaId))
    .get();
  if (!fila) throw new ErrorNoEncontrado('caja', cajaId);
  return fila as CajaVista;
}

/** Saldo teorico de una caja abierta: apertura + ingresos - egresos. */
function saldoTeorico(tx: Tx, cajaId: number): number {
  const caja = tx.select({ apertura: cajas.montoApertura }).from(cajas).where(eq(cajas.id, cajaId)).get();
  if (!caja) throw new ErrorNoEncontrado('caja', cajaId);
  const movimientos = tx
    .select({
      total: sql<number>`COALESCE(SUM(CASE WHEN ${cajaMovimientos.tipo} = 'ingreso' THEN ${cajaMovimientos.monto} ELSE -${cajaMovimientos.monto} END), 0)`.mapWith(Number),
    })
    .from(cajaMovimientos)
    .where(eq(cajaMovimientos.cajaId, cajaId))
    .get();
  return caja.apertura + (movimientos?.total ?? 0);
}

function buscarCajaAbierta(tx: Tx): { id: number } | undefined {
  return tx.select({ id: cajas.id }).from(cajas).where(eq(cajas.estado, 'abierta')).get();
}

export const tesoreriaServicio = {
  /* ---------------------------------- Caja --------------------------------- */

  abrirCaja(montoApertura: number, usuario: string | null): CajaVista {
    if (!esCentavosValido(montoApertura)) {
      throw new ErrorValidacion('El monto de apertura tiene que ser un entero de centavos (>= 0).');
    }
    const resultado = ejecutarSeguro('abrir la caja', () =>
      obtenerDb().transaction((tx) => {
        const abierta = buscarCajaAbierta(tx);
        if (abierta !== undefined) {
          throw new ErrorReglaNegocio(
            `Ya hay una caja abierta (#${abierta.id}). Cerrala antes de abrir otra.`,
          );
        }
        const caja = tx
          .insert(cajas)
          .values({
            fechaApertura: new Date().toISOString(),
            montoApertura,
            estado: 'abierta',
            usuario: usuario?.trim() || null,
          })
          .returning({ id: cajas.id })
          .all()[0];
        if (!caja) throw new ErrorValidacion('La base no devolvio la caja insertada.');
        return vistaCaja(tx, caja.id);
      }),
    );
    emitir('caja:cambio');
    return resultado;
  },

  cerrarCaja(cajaId: number, entrada: EntradaCierreCaja): CajaVista {
    if (!esCentavosValido(entrada.montoCierreReal)) {
      throw new ErrorValidacion('El monto contado tiene que ser un entero de centavos (>= 0).');
    }
    const resultado = ejecutarSeguro('cerrar la caja', () =>
      obtenerDb().transaction((tx) => {
        const caja = tx.select({ estado: cajas.estado }).from(cajas).where(eq(cajas.id, cajaId)).get();
        if (!caja) throw new ErrorNoEncontrado('caja', cajaId);
        if (caja.estado !== 'abierta') throw new ErrorReglaNegocio('La caja ya esta cerrada.');

        const teorico = saldoTeorico(tx, cajaId);
        tx.update(cajas)
          .set({
            fechaCierre: new Date().toISOString(),
            montoCierreTeorico: teorico,
            montoCierreReal: entrada.montoCierreReal,
            // Positiva = sobra plata; negativa = falta.
            diferencia: entrada.montoCierreReal - teorico,
            estado: 'cerrada',
          })
          .where(eq(cajas.id, cajaId))
          .run();
        return vistaCaja(tx, cajaId);
      }),
    );
    emitir('caja:cambio');
    return resultado;
  },

  /** Movimiento manual: retiro del dueño, pago de un flete, aporte, etc. */
  registrarMovimientoCaja(entrada: EntradaMovimientoCaja): ResultadoMovimientoCaja {
    if (!esCentavosValido(entrada.monto) || entrada.monto <= 0) {
      throw new ErrorValidacion('El monto tiene que ser un entero de centavos mayor a cero.');
    }
    if (entrada.concepto.trim().length < 3) {
      throw new ErrorValidacion('El concepto tiene que explicar el movimiento (minimo 3 caracteres).');
    }
    const resultado = ejecutarSeguro('registrar un movimiento de caja', () =>
      obtenerDb().transaction((tx) => {
        const abierta = buscarCajaAbierta(tx);
        if (abierta === undefined) {
          throw new ErrorReglaNegocio('No hay ninguna caja abierta: abri la caja del dia primero.');
        }
        // Un egreso mayor al saldo no se bloquea: puede ser plata que ya salio y
        // se esta registrando tarde. Queda avisado en el resultado.
        const avisos: string[] = [];
        if (entrada.tipo === 'egreso') {
          const disponible = saldoTeorico(tx, abierta.id);
          if (entrada.monto > disponible) {
            avisos.push(
              `La caja queda en ${((disponible - entrada.monto) / 100).toFixed(2)}: tenia ` +
                `${(disponible / 100).toFixed(2)}.`,
            );
          }
        }
        tx.insert(cajaMovimientos)
          .values({
            cajaId: abierta.id,
            tipo: entrada.tipo,
            concepto: entrada.concepto.trim(),
            monto: entrada.monto,
            documentoTipo: null,
            documentoId: null,
            fecha: new Date().toISOString(),
            usuario: entrada.usuario?.trim() || null,
            notas: entrada.notas?.trim() || null,
          })
          .run();
        return { caja: vistaCaja(tx, abierta.id), advertencias: avisos };
      }),
    );
    emitir('caja:cambio');
    return resultado;
  },

  /* ---------------------------- Cobros y pagos ----------------------------- */

  /**
   * Cobro a cliente ('haber': baja lo que nos debe) o pago a proveedor ('debe':
   * baja lo que le debemos). En efectivo impacta la caja; en cheque no, porque
   * el cheque se administra en su propia cartera.
   */
  registrarCobroPago(entrada: EntradaCobroPago): ResultadoCobroPago {
    if (!esCentavosValido(entrada.monto) || entrada.monto <= 0) {
      throw new ErrorValidacion('El importe tiene que ser un entero de centavos mayor a cero.');
    }

    const esCobro = entrada.entidadTipo === 'cliente';
    const resultado = ejecutarSeguro('registrar un cobro o pago', () =>
      obtenerDb().transaction((tx) => {
        const advertencias: string[] = [];
        const ahora = new Date().toISOString();

        const nombre = esCobro
          ? tx.select({ n: clientes.nombre }).from(clientes).where(eq(clientes.id, entrada.entidadId)).get()?.n
          : tx.select({ n: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, entrada.entidadId)).get()?.n;
        if (nombre === undefined) {
          throw new ErrorNoEncontrado(esCobro ? 'cliente' : 'proveedor', entrada.entidadId);
        }

        const saldo =
          tx
            .select({
              s: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE -${cuentasCorrientes.monto} END), 0)`.mapWith(Number),
            })
            .from(cuentasCorrientes)
            .where(
              sql`${cuentasCorrientes.entidadTipo} = ${entrada.entidadTipo} AND ${cuentasCorrientes.entidadId} = ${entrada.entidadId}`,
            )
            .get()?.s ?? 0;

        // Cobrar de mas no se bloquea (puede ser un anticipo), pero se avisa:
        // el saldo queda a favor del cliente y conviene que sea a proposito.
        const deuda = esCobro ? saldo : -saldo;
        if (entrada.monto > deuda) {
          advertencias.push(
            deuda <= 0
              ? `${nombre} no tenia deuda: queda un saldo a favor de ${((entrada.monto - Math.max(deuda, 0)) / 100).toFixed(2)}.`
              : `El importe supera la deuda de ${(deuda / 100).toFixed(2)}: queda un saldo a favor.`,
          );
        }

        tx.insert(cuentasCorrientes)
          .values({
            entidadTipo: entrada.entidadTipo,
            entidadId: entrada.entidadId,
            tipoMovimiento: esCobro ? 'haber' : 'debe',
            monto: entrada.monto,
            documentoTipo: esCobro ? 'cobro' : 'pago',
            documentoId: null,
            fecha: ahora,
            notas: entrada.notas?.trim() || (esCobro ? 'Cobro' : 'Pago'),
          })
          .run();

        if (entrada.medio === 'efectivo') {
          const abierta = buscarCajaAbierta(tx);
          if (abierta === undefined) {
            advertencias.push(
              'No hay caja abierta: el movimiento quedo en la cuenta corriente pero no entro ni salio de ninguna caja.',
            );
          } else {
            if (!esCobro) {
              // No se bloquea: el pago ya se hizo y el sistema registra hechos.
              // Bloquearlo lograria que el operador no lo cargue, que es peor
              // que una caja en negativo bien visible.
              const disponible = saldoTeorico(tx, abierta.id);
              if (entrada.monto > disponible) {
                advertencias.push(
                  `La caja queda en ${((disponible - entrada.monto) / 100).toFixed(2)}: tenia ` +
                    `${(disponible / 100).toFixed(2)}. Revisa si falta registrar un ingreso.`,
                );
              }
            }
            tx.insert(cajaMovimientos)
              .values({
                cajaId: abierta.id,
                tipo: esCobro ? 'ingreso' : 'egreso',
                concepto: `${esCobro ? 'Cobro a' : 'Pago a'} ${nombre}`,
                monto: entrada.monto,
                documentoTipo: esCobro ? 'cobro' : 'pago',
                documentoId: null,
                fecha: ahora,
                usuario: null,
                notas: entrada.notas?.trim() || null,
              })
              .run();
          }
        }

        return { entidadNombre: nombre, monto: entrada.monto, advertencias };
      }),
    );

    emitir('cc:cambio');
    emitir('caja:cambio');
    return resultado;
  },
};
