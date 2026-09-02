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

import { and, desc, eq, sql } from 'drizzle-orm';

import {
  TRANSICIONES_CHEQUE,
  type ChequeVista,
  type EntradaCambioEstadoCheque,
  type EntradaNuevoCheque,
  type ResumenCartera,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { cheques, cuentasCorrientes, type EstadoCheque } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { existeEntidad } from '../repositorios/cuentas-corrientes.repositorio';
import { comprobantesAbiertosEnTx, resolverFifo } from './cc-detalle.servicio';
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

  /**
   * Cambia el estado de un cheque Y asienta lo que ese cambio significa en las
   * cuentas corrientes. Un cheque no es un papel con un estado: es plata de
   * alguien, y cada movimiento tiene su contrapartida.
   *
   *  - Recibido RECHAZADO: el cliente nunca nos pago. La deuda VUELVE ('debe').
   *    Antes el cheque quedaba en rojo en la cartera y el cliente figuraba al
   *    dia: la plata se perdia sin que nadie se enterara.
   *  - Recibido ENDOSADO a un proveedor: le entregamos un cheque de un tercero,
   *    asi que le pagamos. Baja lo que le debemos ('debe' en su cuenta).
   *  - Emitido RECHAZADO: nuestro cheque reboto, seguimos debiendo ('haber').
   *  - Emitido ACREDITADO: el banco lo debito. La deuda ya se habia bajado al
   *    entregarlo, asi que no se asienta nada: solo cierra el circuito.
   */
  cambiarEstado(chequeId: number, entrada: EstadoCheque | EntradaCambioEstadoCheque): ChequeVista {
    const pedido: EntradaCambioEstadoCheque =
      typeof entrada === 'string' ? { estado: entrada } : entrada;
    const nuevoEstado = pedido.estado;

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

        const ahora = new Date().toISOString();
        let endosadoA: number | null = cheque.endosadoAId;
        const asentar = (
          entidadTipo: 'cliente' | 'proveedor',
          entidadId: number,
          tipoMovimiento: 'debe' | 'haber',
          notas: string,
        ): void => {
          tx.insert(cuentasCorrientes)
            .values({
              entidadTipo,
              entidadId,
              tipoMovimiento,
              monto: cheque.importe,
              documentoTipo: 'cheque',
              documentoId: cheque.id,
              fecha: ahora,
              notas,
            })
            .run();
        };

        const etiqueta = `Cheque ${cheque.numero}`;

        /**
         * Un asiento de cheque que BAJA una deuda (el endoso a un proveedor, o
         * la acreditacion tras un rechazo) tiene que imputarse contra los
         * comprobantes abiertos, igual que una cobranza.
         *
         * Antes se asentaba con documentoTipo='cheque' y documentoId=<id del
         * cheque>. La imputacion FIFO agrupa por documento, asi que esa clave
         * no correspondia a ningun comprobante: el saldo total bajaba bien
         * —sale de sumar debe menos haber— pero la factura quedaba abierta por
         * su importe completo y la ficha inventaba un "saldo a favor" que no
         * existia. El comprobante no se cerraba nunca.
         */
        const asentarImputado = (
          entidadTipo: 'cliente' | 'proveedor',
          entidadId: number,
          tipoMovimiento: 'debe' | 'haber',
          notas: string,
        ): void => {
          const abiertos = comprobantesAbiertosEnTx(tx, entidadTipo, entidadId);
          const { imputaciones, sobrante } = resolverFifo(abiertos, cheque.importe);
          for (const imputacion of imputaciones) {
            tx.insert(cuentasCorrientes)
              .values({
                entidadTipo,
                entidadId,
                tipoMovimiento,
                monto: imputacion.importe,
                documentoTipo: imputacion.documentoTipo,
                documentoId: imputacion.documentoId,
                fecha: ahora,
                notas: `${notas} · imputado a ${imputacion.documentoTipo} #${String(imputacion.documentoId)}`,
              })
              .run();
          }
          // Lo que sobra queda como saldo a favor, con el cheque como documento
          // para poder rastrearlo.
          if (sobrante > 0) {
            tx.insert(cuentasCorrientes)
              .values({
                entidadTipo,
                entidadId,
                tipoMovimiento,
                monto: sobrante,
                documentoTipo: 'cheque',
                documentoId: cheque.id,
                fecha: ahora,
                notas: imputaciones.length > 0 ? `${notas} · excedente a favor` : notas,
              })
              .run();
          }
        };

        /*
         * ACREDITADO cierra el circuito. Si el cheque habia rebotado antes, el
         * rechazo dejo un asiento que hay que REVERTIR: el cliente ya nos pago
         * de verdad. Sin esto, un cheque que rebota y despues se cobra dejaba
         * la deuda en pie para siempre y el total de deudores inflado.
         * La compensacion se calcula contando los asientos de ESTE cheque, asi
         * que dos rebotes seguidos no dejan la cuenta a medias ni se duplica si
         * la transicion se repite.
         */
        if (nuevoEstado === 'acreditado') {
          const asientos = tx
            .select({ tipoMovimiento: cuentasCorrientes.tipoMovimiento })
            .from(cuentasCorrientes)
            .where(
              and(
                eq(cuentasCorrientes.documentoTipo, 'cheque'),
                eq(cuentasCorrientes.documentoId, cheque.id),
              ),
            )
            .all();
          const debe = asientos.filter((a) => a.tipoMovimiento === 'debe').length;
          const haber = asientos.filter((a) => a.tipoMovimiento === 'haber').length;

          if (cheque.tipo === 'recibido' && cheque.entidadTipo === 'cliente' && cheque.entidadId !== null) {
            // Un rechazo sin compensar deja debe > haber: se salda con un haber.
            if (debe > haber) {
              asentarImputado('cliente', cheque.entidadId, 'haber', `${etiqueta} acreditado tras el rechazo`);
            }
          }
          if (cheque.tipo === 'emitido' && cheque.entidadTipo === 'proveedor' && cheque.entidadId !== null) {
            // Del lado emitido el rechazo asienta 'haber' (volvemos a deber).
            if (haber > debe) {
              asentarImputado('proveedor', cheque.entidadId, 'debe', `${etiqueta} debitado tras el rechazo`);
            }
          }
        }

        if (cheque.tipo === 'recibido' && nuevoEstado === 'rechazado') {
          if (cheque.entidadTipo === 'cliente' && cheque.entidadId !== null) {
            asentar('cliente', cheque.entidadId, 'debe', `${etiqueta} rechazado: la deuda vuelve`);
          }
          /*
           * Si el cheque estaba ENDOSADO, el rebote toca DOS cuentas: el cliente
           * que lo libro nos vuelve a deber (arriba) y el proveedor al que se lo
           * dimos nos vuelve a ser acreedor, porque ese pago no existio.
           * Revertir solo una de las dos dejaba el otro lado mal para siempre.
           */
          if (cheque.estado === 'endosado' && cheque.endosadoAId !== null) {
            asentar(
              'proveedor',
              cheque.endosadoAId,
              'haber',
              `${etiqueta} endosado y rechazado: le seguimos debiendo`,
            );
          }
        }

        if (cheque.tipo === 'recibido' && nuevoEstado === 'endosado') {
          const destinoId = pedido.destinoEntidadId ?? null;
          if (pedido.destinoEntidadTipo !== 'proveedor' || destinoId === null) {
            throw new ErrorValidacion(
              'Para endosar un cheque hay que indicar a que proveedor se le entrega: el endoso le baja la deuda.',
            );
          }
          asentarImputado('proveedor', destinoId, 'debe', `${etiqueta} endosado como pago`);
          endosadoA = destinoId;
        }

        if (cheque.tipo === 'emitido' && nuevoEstado === 'rechazado') {
          if (cheque.entidadTipo === 'proveedor' && cheque.entidadId !== null) {
            asentar('proveedor', cheque.entidadId, 'haber', `${etiqueta} rechazado: la deuda vuelve`);
          }
        }

        const notasNuevas =
          nuevoEstado === 'endosado' && pedido.destinoEntidadId !== null
            ? `${cheque.notas ? `${cheque.notas} · ` : ''}Endosado a proveedor #${String(pedido.destinoEntidadId)}`
            : cheque.notas;

        const actualizado = tx
          .update(cheques)
          .set({ estado: nuevoEstado, notas: notasNuevas, endosadoAId: endosadoA })
          .where(eq(cheques.id, chequeId))
          .returning()
          .all()[0];
        if (!actualizado) throw new ErrorNoEncontrado('cheque', chequeId);
        return actualizado;
      }),
    );

    emitir('cheques:cambio');
    emitir('cc:cambio');
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
