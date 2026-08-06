/**
 * Servicio de la cartera de cheques.
 *
 * El cliente opera con cheques diferidos: recibe de clientes y entrega a
 * proveedores. El patron replica el modulo probado en cosecha:
 *  - Recibidos: en_cartera -> depositado -> acreditado | rechazado, o endosado.
 *    Un rechazado puede volver a depositarse (segunda presentacion).
 *  - Emitidos: nacen entregados; solo pueden rebotar o anularse.
 *  - `anulado` corrige un alta equivocada; no existe borrar.
 *
 * El cheque todavia NO impacta caja ni cuenta corriente: eso llega con el
 * circuito de cobros/pagos. Por ahora es la cartera con su control de
 * vencimientos, que es lo que el cliente necesita mirar todos los dias.
 */

import { desc, eq, sql } from 'drizzle-orm';

import {
  TRANSICIONES_CHEQUE,
  type ChequeVista,
  type EntradaNuevoCheque,
  type ResumenCartera,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { cheques, type EstadoCheque } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { existeEntidad } from '../repositorios/cuentas-corrientes.repositorio';
import { emitir } from '../eventos';
import { esCentavosValido } from '../utiles/numeros';

/** AAAA-MM-DD de hoy y de dentro de una semana, para los indicadores. */
function fechasDeCorte(): { hoy: string; enSieteDias: string } {
  const hoy = new Date();
  const semana = new Date(hoy.getTime() + 7 * 24 * 60 * 60 * 1000);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);
  return { hoy: iso(hoy), enSieteDias: iso(semana) };
}

export const chequesServicio = {
  crear(entrada: EntradaNuevoCheque): ChequeVista {
    if (entrada.numero.trim() === '') {
      throw new ErrorValidacion('El numero de cheque es obligatorio.');
    }
    if (entrada.contraparte.trim() === '') {
      throw new ErrorValidacion(
        entrada.tipo === 'recibido'
          ? 'Falta quien emitio el cheque.'
          : 'Falta a quien se entrego el cheque.',
      );
    }
    if (!esCentavosValido(entrada.importe) || entrada.importe <= 0) {
      throw new ErrorValidacion('El importe tiene que ser un entero de centavos mayor a cero.');
    }
    if (entrada.formato === 'echeq' && !entrada.cuitEmisor?.trim()) {
      throw new ErrorValidacion('Un ECHEQ necesita el CUIT del emisor.');
    }
    if (entrada.fechaPago < entrada.fechaEmision) {
      throw new ErrorValidacion('La fecha de pago no puede ser anterior a la de emision.');
    }

    const entidadTipo = entrada.entidadTipo ?? null;
    const entidadId = entrada.entidadId ?? null;
    if (entidadTipo !== null && entidadId !== null && !existeEntidad(entidadTipo, entidadId)) {
      throw new ErrorNoEncontrado(entidadTipo, entidadId);
    }

    const fila = ejecutarSeguro('registrar un cheque', () =>
      obtenerDb()
        .insert(cheques)
        .values({
          tipo: entrada.tipo,
          formato: entrada.formato,
          numero: entrada.numero.trim(),
          banco: entrada.banco?.trim() || null,
          cuitEmisor: entrada.cuitEmisor?.trim() || null,
          contraparte: entrada.contraparte.trim(),
          entidadTipo,
          entidadId,
          importe: entrada.importe,
          fechaEmision: entrada.fechaEmision,
          fechaPago: entrada.fechaPago,
          // El recibido entra a cartera; el emitido nace entregado.
          estado: entrada.tipo === 'recibido' ? 'en_cartera' : 'entregado',
          notas: entrada.notas?.trim() || null,
        })
        .returning()
        .all()[0],
    );
    if (!fila) throw new ErrorValidacion('La base no devolvio el cheque insertado.');

    emitir('cheques:cambio');
    return fila;
  },

  cambiarEstado(chequeId: number, nuevoEstado: EstadoCheque): ChequeVista {
    const resultado = ejecutarSeguro('cambiar el estado de un cheque', () =>
      obtenerDb().transaction((tx) => {
        const cheque = tx.select().from(cheques).where(eq(cheques.id, chequeId)).get();
        if (!cheque) throw new ErrorNoEncontrado('cheque', chequeId);

        const permitidas = TRANSICIONES_CHEQUE[cheque.tipo][cheque.estado];
        if (!permitidas.includes(nuevoEstado)) {
          throw new ErrorReglaNegocio(
            `Un cheque ${cheque.tipo} en estado ${cheque.estado} no puede pasar a ${nuevoEstado}.` +
              (permitidas.length > 0 ? ` Transiciones validas: ${permitidas.join(', ')}.` : ' Es un estado terminal.'),
            { tipo: cheque.tipo, estadoActual: cheque.estado },
          );
        }

        const actualizado = tx
          .update(cheques)
          .set({ estado: nuevoEstado })
          .where(eq(cheques.id, chequeId))
          .returning()
          .all()[0];
        if (!actualizado) throw new ErrorNoEncontrado('cheque', chequeId);
        return actualizado;
      }),
    );

    emitir('cheques:cambio');
    return resultado;
  },

  listar(): ChequeVista[] {
    return ejecutarSeguro('listar cheques', () =>
      obtenerDb().select().from(cheques).orderBy(desc(cheques.fechaPago), desc(cheques.id)).all(),
    );
  },

  /** Indicadores de la cartera: cuanta plata hay en la calle y que vence. */
  resumenCartera(): ResumenCartera {
    const { hoy, enSieteDias } = fechasDeCorte();
    return ejecutarSeguro('resumir la cartera de cheques', () => {
      const filas = obtenerDb()
        .select({
          estado: cheques.estado,
          importe: sql<number>`COALESCE(SUM(${cheques.importe}), 0)`.mapWith(Number),
          cantidad: sql<number>`COUNT(*)`.mapWith(Number),
          porVencer: sql<number>`SUM(CASE WHEN ${cheques.fechaPago} >= ${hoy} AND ${cheques.fechaPago} <= ${enSieteDias} THEN 1 ELSE 0 END)`.mapWith(Number),
          vencidos: sql<number>`SUM(CASE WHEN ${cheques.fechaPago} < ${hoy} THEN 1 ELSE 0 END)`.mapWith(Number),
        })
        .from(cheques)
        .where(sql`${cheques.estado} IN ('en_cartera','entregado')`)
        .groupBy(cheques.estado)
        .all();

      let enCartera = 0;
      let importeEnCartera = 0;
      let porVencer = 0;
      let vencidos = 0;
      for (const fila of filas) {
        if (fila.estado === 'en_cartera') {
          enCartera = fila.cantidad;
          importeEnCartera = fila.importe;
        }
        porVencer += fila.porVencer;
        vencidos += fila.vencidos;
      }
      return { enCartera, importeEnCartera, porVencer7Dias: porVencer, vencidos };
    });
  },
};
