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

import { TRANSICIONES_ORDEN, type EntradaNuevaOrden } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  movimientosStock,
  ordenesProduccion,
  pedidos,
  produccionConsumos,
  recetaItems,
  recetas,
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
  /**
   * Avisos que NO bloquean: la tanda fisica ya ocurrio y el ledger tiene que
   * registrarla igual, pero el operador debe enterarse (ej: un insumo quedo en
   * stock negativo, señal de que faltan compras por cargar).
   */
  advertencias: string[];
}

export const produccionServicio = {
  /**
   * Planifica una tanda. La cantidad no se escribe a mano: sale del rinde de la
   * receta por el factor de escala, para que orden y receta no puedan discrepar
   * (media tanda = 0.5, doble = 2). El lote todavia no existe: nace al ejecutar.
   */
  crearOrden(entrada: EntradaNuevaOrden): { id: number } {
    if (!Number.isFinite(entrada.factorEscala) || entrada.factorEscala <= 0) {
      throw new ErrorValidacion('El factor de escala tiene que ser mayor a cero.');
    }
    const resultado = ejecutarSeguro('planificar una orden de produccion', () =>
      obtenerDb().transaction((tx) => {
        const receta = tx
          .select({
            id: recetas.id,
            articuloProducidoId: recetas.articuloProducidoId,
            rindeCantidad: recetas.rindeCantidad,
            activa: recetas.activa,
          })
          .from(recetas)
          .where(eq(recetas.id, entrada.recetaId))
          .get();
        if (!receta) throw new ErrorNoEncontrado('receta', entrada.recetaId);
        if (!receta.activa) {
          throw new ErrorReglaNegocio('La receta esta inactiva: no se puede planificar produccion con ella.');
        }

        if (entrada.pedidoId != null) {
          const pedido = tx
            .select({ id: pedidos.id })
            .from(pedidos)
            .where(eq(pedidos.id, entrada.pedidoId))
            .get();
          if (!pedido) throw new ErrorNoEncontrado('pedido', entrada.pedidoId);
        }

        const orden = tx
          .insert(ordenesProduccion)
          .values({
            recetaId: receta.id,
            articuloProducidoId: receta.articuloProducidoId,
            cantidadPlanificada: redondearCantidad(receta.rindeCantidad * entrada.factorEscala),
            factorEscala: entrada.factorEscala,
            estado: 'planificada',
            pedidoId: entrada.pedidoId ?? null,
            fechaPlanificada: new Date().toISOString(),
            notas: entrada.notas?.trim() || null,
          })
          .returning({ id: ordenesProduccion.id })
          .all()[0];
        if (!orden) throw new ErrorValidacion('La base no devolvio la orden insertada.');
        return { id: orden.id };
      }),
    );
    emitir('ordenes:cambio');
    return resultado;
  },

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

          return { id: ordenId, estado: nuevoEstado, numeroLote, advertencias: [] };
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

          // Consumos: negativo por cada insumo, el real si se registro. Si el
          // descuento deja el insumo en negativo NO se bloquea (la produccion
          // fisica ya paso), pero se avisa: es la señal de compras sin cargar.
          const advertencias: string[] = [];
          for (const consumo of consumos) {
            const cantidad = redondearCantidad(consumo.cantidadReal ?? consumo.cantidadTeorica);
            if (cantidad <= 0) continue; // Un consumo en cero no genera asiento.

            const saldoInsumo =
              tx
                .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
                .from(movimientosStock)
                .where(eq(movimientosStock.articuloId, consumo.articuloInsumoId))
                .get()?.s ?? 0;
            if (saldoInsumo - cantidad < 0) {
              const nombre =
                tx
                  .select({ n: articulos.nombre })
                  .from(articulos)
                  .where(eq(articulos.id, consumo.articuloInsumoId))
                  .get()?.n ?? `articulo ${consumo.articuloInsumoId}`;
              advertencias.push(
                `${nombre} queda con stock negativo (${redondearCantidad(saldoInsumo - cantidad)}): revisa si falta cargar una compra.`,
              );
            }

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

          return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote, advertencias };
        }

        /* ------------------------------ Cancelar ---------------------------- */
        tx.update(ordenesProduccion)
          .set({ estado: nuevoEstado })
          .where(eq(ordenesProduccion.id, ordenId))
          .run();
        return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote, advertencias: [] };
      }),
    );

    emitir('ordenes:cambio');
    return resultado;
  },
};
