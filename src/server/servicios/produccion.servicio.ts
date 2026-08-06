/**
 * Servicio de ejecucion de ordenes de produccion.
 *
 * Es el corazon de la trazabilidad:
 *  - Al EJECUTAR una orden (planificada -> en_proceso) se le asigna su numero de
 *    lote unico (L-AAAAMMDD-NN). Ese numero identifica la tanda para siempre.
 *  - Al FINALIZAR (en_proceso -> finalizada) se generan, en UNA transaccion, los
 *    movimientos del ledger: consumo negativo por cada insumo (real si se
 *    registro, teorico si no) y el ingreso positivo del articulo producido.
 *    Todos llevan documento_tipo='orden_produccion' + documento_id, que es lo
 *    que permite reconstruir la historia del lote desde el ledger.
 *
 * La orden NO se puede finalizar sin pasar por en_proceso: sin ejecucion no hay
 * lote, y sin lote no hay trazabilidad.
 */

import { eq, like, sql } from 'drizzle-orm';

import { TRANSICIONES_ORDEN } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  movimientosStock,
  ordenesProduccion,
  produccionConsumos,
  recetaItems,
  type EstadoOrdenProduccion,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';

/** Formato del lote: L-AAAAMMDD-NN (fecha de ejecucion + correlativo del dia). */
function armarNumeroLote(correlativoDelDia: number): string {
  const hoy = new Date();
  const fecha = [
    hoy.getFullYear(),
    String(hoy.getMonth() + 1).padStart(2, '0'),
    String(hoy.getDate()).padStart(2, '0'),
  ].join('');
  return `L-${fecha}-${String(correlativoDelDia).padStart(2, '0')}`;
}

export interface ResultadoCambioOrden {
  id: number;
  estado: EstadoOrdenProduccion;
  numeroLote: string | null;
}

export const produccionServicio = {
  /**
   * Aplica una transicion de la maquina de estados de la orden. Los efectos
   * (lote, movimientos) van en la MISMA transaccion que el cambio de estado:
   * una orden finalizada sin sus movimientos seria un agujero en el ledger.
   */
  cambiarEstado(
    ordenId: number,
    nuevoEstado: EstadoOrdenProduccion,
    rindeReal?: number | null,
  ): ResultadoCambioOrden {
    const resultado = ejecutarSeguro('cambiar el estado de una orden de produccion', () =>
      obtenerDb().transaction((tx) => {
        const orden = tx
          .select()
          .from(ordenesProduccion)
          .where(eq(ordenesProduccion.id, ordenId))
          .get();
        if (!orden) throw new ErrorNoEncontrado('orden de produccion', ordenId);

        const permitidas = TRANSICIONES_ORDEN[orden.estado];
        if (!permitidas.includes(nuevoEstado)) {
          throw new ErrorReglaNegocio(
            `Una orden ${orden.estado} no puede pasar a ${nuevoEstado}. Transiciones validas: ${
              permitidas.length > 0 ? permitidas.join(', ') : 'ninguna (estado terminal)'
            }.`,
            { estadoActual: orden.estado, estadoPedido: nuevoEstado },
          );
        }

        const ahora = new Date().toISOString();

        /* ------------------------- Ejecutar: nace el lote ------------------- */
        if (nuevoEstado === 'en_proceso') {
          // Correlativo del dia: cuantos lotes ya se asignaron hoy + 1.
          const hoyPrefijo = armarNumeroLote(0).slice(0, -3); // "L-AAAAMMDD-"
          const usados =
            tx
              .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(ordenesProduccion)
              .where(like(ordenesProduccion.numeroLote, `${hoyPrefijo}%`))
              .get()?.total ?? 0;
          const numeroLote = armarNumeroLote(usados + 1);

          // Si la orden no tiene consumos cargados, se generan los TEORICOS
          // desde la receta (cantidad x factor de escala). Sin esto, una orden
          // creada sin consumos quedaria imposible de finalizar.
          const consumosExistentes =
            tx
              .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(produccionConsumos)
              .where(eq(produccionConsumos.ordenId, ordenId))
              .get()?.total ?? 0;

          if (consumosExistentes === 0) {
            const itemsReceta = tx
              .select()
              .from(recetaItems)
              .where(eq(recetaItems.recetaId, orden.recetaId))
              .all();
            if (itemsReceta.length === 0) {
              throw new ErrorReglaNegocio(
                'La receta de la orden no tiene insumos: no se puede ejecutar una tanda sin saber que consume.',
                { ordenId, recetaId: orden.recetaId },
              );
            }
            for (const item of itemsReceta) {
              tx.insert(produccionConsumos)
                .values({
                  ordenId,
                  articuloInsumoId: item.articuloInsumoId,
                  cantidadTeorica: redondearCantidad(item.cantidad * orden.factorEscala),
                  cantidadReal: null,
                })
                .run();
            }
          }

          tx.update(ordenesProduccion)
            .set({ estado: nuevoEstado, numeroLote, fechaInicio: ahora })
            .where(eq(ordenesProduccion.id, ordenId))
            .run();

          return { id: ordenId, estado: nuevoEstado, numeroLote };
        }

        /* --------------------- Finalizar: impacta el ledger ----------------- */
        if (nuevoEstado === 'finalizada') {
          const consumos = tx
            .select()
            .from(produccionConsumos)
            .where(eq(produccionConsumos.ordenId, ordenId))
            .all();

          if (consumos.length === 0) {
            throw new ErrorReglaNegocio(
              'La orden no tiene consumos cargados: no se puede finalizar sin saber que insumos gasto.',
              { ordenId },
            );
          }

          const producido = redondearCantidad(rindeReal ?? orden.cantidadPlanificada);
          if (!Number.isFinite(producido) || producido <= 0) {
            throw new ErrorValidacion('El rinde real tiene que ser mayor a cero.');
          }

          // Consumos: negativo por cada insumo, el real si se registro.
          for (const consumo of consumos) {
            const cantidad = redondearCantidad(consumo.cantidadReal ?? consumo.cantidadTeorica);
            if (cantidad <= 0) continue; // Un consumo en cero no genera asiento.
            tx.insert(movimientosStock)
              .values({
                articuloId: consumo.articuloInsumoId,
                tipo: 'consumo_produccion',
                cantidad: -cantidad,
                documentoTipo: 'orden_produccion',
                documentoId: ordenId,
                fecha: ahora,
                notas: `Lote ${orden.numeroLote ?? '?'}: consumo de produccion`,
              })
              .run();
          }

          // Ingreso del producido.
          tx.insert(movimientosStock)
            .values({
              articuloId: orden.articuloProducidoId,
              tipo: 'ingreso_produccion',
              cantidad: producido,
              documentoTipo: 'orden_produccion',
              documentoId: ordenId,
              fecha: ahora,
              notas: `Lote ${orden.numeroLote ?? '?'}: ingreso de produccion`,
            })
            .run();

          tx.update(ordenesProduccion)
            .set({ estado: nuevoEstado, rindeReal: producido, fechaFin: ahora })
            .where(eq(ordenesProduccion.id, ordenId))
            .run();

          return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote };
        }

        /* ------------------------------ Cancelar ---------------------------- */
        tx.update(ordenesProduccion)
          .set({ estado: nuevoEstado })
          .where(eq(ordenesProduccion.id, ordenId))
          .run();
        return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote };
      }),
    );

    emitir('ordenes:cambio');
    return resultado;
  },
};
