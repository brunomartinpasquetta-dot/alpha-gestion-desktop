/**
 * Detalle de una cuenta corriente e IMPUTACION FIFO de cobranzas.
 *
 * Portado del modulo de cuentas corrientes de StockFlow. Lo que aporta sobre lo
 * que Alpha ya tenia (un saldo global por entidad) es lo que el cliente
 * realmente pregunta por telefono: *que factura* quedo sin pagar.
 *
 * Como se imputa, sin tabla nueva:
 *   - Un 'debe' con documentoTipo='venta' y documentoId=N ES la factura N.
 *   - Un 'haber' con el MISMO documentoTipo/documentoId es plata aplicada a esa
 *     factura. El saldo del comprobante es la resta.
 *   - Un 'haber' sin documento es un anticipo: baja el saldo total pero no
 *     cierra ningun comprobante.
 * Eso alcanza porque la tabla ya guarda el documento de origen: una tabla de
 * imputaciones aparte seria una segunda verdad que hay que mantener sincronizada.
 *
 * FIFO (del mas viejo al mas nuevo) es lo que hace StockFlow y es lo que espera
 * cualquiera que lleve una cuenta: se cancela lo mas viejo primero. Lo que sobra
 * despues de cerrar todo queda como saldo a favor, no se pierde.
 */

import { and, asc, eq, sql } from 'drizzle-orm';

import type { TipoEntidadCc } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { clientes, cuentasCorrientes, proveedores, type TipoDocumentoCc } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorValidacion } from '../dominio/errores';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

export interface ComprobanteConSaldo {
  documentoTipo: TipoDocumentoCc;
  documentoId: number;
  fecha: string;
  /** Importe original del comprobante. */
  total: number;
  /** Lo ya aplicado a este comprobante. */
  imputado: number;
  /** total - imputado. Siempre > 0 en esta lista. */
  saldo: number;
  notas: string | null;
}

export interface MovimientoCcVista {
  id: number;
  fecha: string;
  tipoMovimiento: 'debe' | 'haber';
  monto: number;
  documentoTipo: TipoDocumentoCc;
  documentoId: number | null;
  notas: string | null;
  /** Saldo de la cuenta DESPUES de este asiento, en orden cronologico. */
  saldoAcumulado: number;
}

export interface DetalleCuentaCorriente {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  entidadNombre: string;
  saldo: number;
  /** Comprobantes que todavia tienen algo sin cancelar, del mas viejo al mas nuevo. */
  comprobantes: ComprobanteConSaldo[];
  /** Plata cobrada sin imputar a ningun comprobante (anticipos). */
  saldoAFavor: number;
  movimientos: MovimientoCcVista[];
}

/** Una imputacion resuelta: a que comprobante y cuanto. */
export interface ImputacionFifo {
  documentoTipo: TipoDocumentoCc;
  documentoId: number;
  importe: number;
}

/**
 * Comprobantes con saldo, del mas viejo al mas nuevo. En un cliente el
 * comprobante que genera deuda es el 'debe' (venta); en un proveedor es el
 * 'haber' (compra). Se mira el lado que corresponde y no ambos, porque si no
 * una nota de credito aparece como si fuera una factura por cobrar.
 */
function comprobantesAbiertos(
  tx: Tx,
  entidadTipo: TipoEntidadCc,
  entidadId: number,
): ComprobanteConSaldo[] {
  const ladoDeuda = entidadTipo === 'cliente' ? 'debe' : 'haber';
  const ladoPago = entidadTipo === 'cliente' ? 'haber' : 'debe';

  const filas = tx
    .select()
    .from(cuentasCorrientes)
    .where(
      and(
        eq(cuentasCorrientes.entidadTipo, entidadTipo),
        eq(cuentasCorrientes.entidadId, entidadId),
      ),
    )
    .orderBy(asc(cuentasCorrientes.fecha), asc(cuentasCorrientes.id))
    .all();

  const porComprobante = new Map<string, ComprobanteConSaldo>();
  for (const fila of filas) {
    if (fila.documentoId === null) continue;
    const clave = `${fila.documentoTipo}#${String(fila.documentoId)}`;
    if (fila.tipoMovimiento === ladoDeuda) {
      const actual = porComprobante.get(clave);
      if (actual === undefined) {
        porComprobante.set(clave, {
          documentoTipo: fila.documentoTipo,
          documentoId: fila.documentoId,
          fecha: fila.fecha,
          total: fila.monto,
          imputado: 0,
          saldo: fila.monto,
          notas: fila.notas,
        });
      } else {
        actual.total += fila.monto;
        actual.saldo += fila.monto;
      }
    } else if (fila.tipoMovimiento === ladoPago) {
      const actual = porComprobante.get(clave);
      if (actual !== undefined) {
        actual.imputado += fila.monto;
        actual.saldo -= fila.monto;
      }
    }
  }

  return [...porComprobante.values()]
    .filter((c) => c.saldo > 0)
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.documentoId - b.documentoId));
}

function nombreEntidad(tx: Tx, entidadTipo: TipoEntidadCc, entidadId: number): string {
  const nombre =
    entidadTipo === 'cliente'
      ? tx.select({ n: clientes.nombre }).from(clientes).where(eq(clientes.id, entidadId)).get()?.n
      : tx.select({ n: proveedores.nombre }).from(proveedores).where(eq(proveedores.id, entidadId)).get()
          ?.n;
  if (nombre === undefined) throw new ErrorNoEncontrado(entidadTipo, entidadId);
  return nombre;
}

/**
 * Reparte un importe entre los comprobantes abiertos, del mas viejo al mas
 * nuevo. Devuelve las imputaciones y lo que sobro (anticipo). No escribe nada:
 * el que decide si eso se asienta es quien la llama, dentro de su transaccion.
 */
export function resolverFifo(
  comprobantes: readonly ComprobanteConSaldo[],
  importe: number,
): { imputaciones: ImputacionFifo[]; sobrante: number } {
  const imputaciones: ImputacionFifo[] = [];
  let restante = importe;
  for (const comprobante of comprobantes) {
    if (restante <= 0) break;
    const aplica = Math.min(restante, comprobante.saldo);
    if (aplica <= 0) continue;
    imputaciones.push({
      documentoTipo: comprobante.documentoTipo,
      documentoId: comprobante.documentoId,
      importe: aplica,
    });
    restante -= aplica;
  }
  return { imputaciones, sobrante: restante };
}

export const ccDetalleServicio = {
  /** Ficha completa de la cuenta: comprobantes abiertos + libro con saldo corrido. */
  detalle(entidadTipo: TipoEntidadCc, entidadId: number, limite = 200): DetalleCuentaCorriente {
    return ejecutarSeguro('ver el detalle de una cuenta corriente', () =>
      obtenerDb().transaction((tx) => {
        const entidadNombre = nombreEntidad(tx, entidadTipo, entidadId);
        const comprobantes = comprobantesAbiertos(tx, entidadTipo, entidadId);

        const filas = tx
          .select()
          .from(cuentasCorrientes)
          .where(
            and(
              eq(cuentasCorrientes.entidadTipo, entidadTipo),
              eq(cuentasCorrientes.entidadId, entidadId),
            ),
          )
          .orderBy(asc(cuentasCorrientes.fecha), asc(cuentasCorrientes.id))
          .all();

        // El saldo corrido se calcula en orden cronologico y despues se da
        // vuelta: mostrar lo mas nuevo arriba es comodo, pero el acumulado solo
        // tiene sentido sumando desde el principio.
        let acumulado = 0;
        const movimientos: MovimientoCcVista[] = filas.map((fila) => {
          acumulado += fila.tipoMovimiento === 'debe' ? fila.monto : -fila.monto;
          return {
            id: fila.id,
            fecha: fila.fecha,
            tipoMovimiento: fila.tipoMovimiento,
            monto: fila.monto,
            documentoTipo: fila.documentoTipo,
            documentoId: fila.documentoId,
            notas: fila.notas,
            saldoAcumulado: acumulado,
          };
        });

        const saldo = entidadTipo === 'cliente' ? acumulado : -acumulado;
        const deudaEnComprobantes = comprobantes.reduce((suma, c) => suma + c.saldo, 0);

        return {
          entidadTipo,
          entidadId,
          entidadNombre,
          saldo,
          comprobantes,
          // Lo que se cobro de mas: el saldo total es menor que lo que queda
          // abierto en comprobantes.
          saldoAFavor: Math.max(deudaEnComprobantes - Math.max(saldo, 0), 0),
          movimientos: movimientos.reverse().slice(0, limite),
        };
      }),
    );
  },

  /**
   * Vista previa de como se repartiria un cobro. La pantalla la muestra ANTES
   * de confirmar: que el operador vea que factura se cierra es lo que evita el
   * "pero yo pague la del 3" tres semanas despues.
   */
  simularImputacion(
    entidadTipo: TipoEntidadCc,
    entidadId: number,
    importe: number,
  ): { imputaciones: (ImputacionFifo & { fecha: string; total: number })[]; sobrante: number } {
    if (!Number.isInteger(importe) || importe <= 0) {
      throw new ErrorValidacion('El importe tiene que ser un entero de centavos mayor a cero.');
    }
    return ejecutarSeguro('simular la imputacion de un cobro', () =>
      obtenerDb().transaction((tx) => {
        nombreEntidad(tx, entidadTipo, entidadId);
        const comprobantes = comprobantesAbiertos(tx, entidadTipo, entidadId);
        const { imputaciones, sobrante } = resolverFifo(comprobantes, importe);
        return {
          imputaciones: imputaciones.map((imputacion) => {
            const comprobante = comprobantes.find(
              (c) =>
                c.documentoTipo === imputacion.documentoTipo &&
                c.documentoId === imputacion.documentoId,
            );
            return {
              ...imputacion,
              fecha: comprobante?.fecha ?? '',
              total: comprobante?.total ?? 0,
            };
          }),
          sobrante,
        };
      }),
    );
  },

  /** Los comprobantes abiertos, para la lista "Comprobantes con saldo". */
  comprobantesAbiertosDe(entidadTipo: TipoEntidadCc, entidadId: number): ComprobanteConSaldo[] {
    return ejecutarSeguro('listar comprobantes con saldo', () =>
      obtenerDb().transaction((tx) => {
        nombreEntidad(tx, entidadTipo, entidadId);
        return comprobantesAbiertos(tx, entidadTipo, entidadId);
      }),
    );
  },
};

/** Reexportado para que tesoreria impute dentro de SU transaccion. */
export function comprobantesAbiertosEnTx(
  tx: Tx,
  entidadTipo: TipoEntidadCc,
  entidadId: number,
): ComprobanteConSaldo[] {
  return comprobantesAbiertos(tx, entidadTipo, entidadId);
}

/** Suma de saldos abiertos, para avisos. Usa el sql agregado y no la lista. */
export function deudaTotalEnTx(tx: Tx, entidadTipo: TipoEntidadCc, entidadId: number): number {
  const fila = tx
    .select({
      s: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE -${cuentasCorrientes.monto} END), 0)`.mapWith(
        Number,
      ),
    })
    .from(cuentasCorrientes)
    .where(
      and(
        eq(cuentasCorrientes.entidadTipo, entidadTipo),
        eq(cuentasCorrientes.entidadId, entidadId),
      ),
    )
    .get();
  const saldo = fila?.s ?? 0;
  return entidadTipo === 'cliente' ? saldo : -saldo;
}
