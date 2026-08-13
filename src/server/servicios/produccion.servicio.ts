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

import { and, eq, inArray, like, sql } from 'drizzle-orm';

import { TRANSICIONES_ORDEN, type EntradaNuevaOrden } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  movimientosStock,
  ordenesProduccion,
  pedidoItems,
  pedidos,
  produccionConsumos,
  recetaItems,
  recetas,
  type EstadoOrdenProduccion,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';
import { cubrirPedidosPendientes, faltaCubrir, promoverSiCubierto, reservar } from './reservas.servicio';

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
    if (!Number.isFinite(entrada.cantidad) || entrada.cantidad <= 0) {
      throw new ErrorValidacion('La cantidad a producir tiene que ser mayor a cero.');
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
            cantidadPlanificada: redondearCantidad(entrada.cantidad),
            // El factor es lo que escala la receta al finalizar: sale de cuanto
            // se produce contra lo que rinde una tanda.
            factorEscala: redondearCantidad(entrada.cantidad / receta.rindeCantidad),
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
   * Abre una orden por cada producto de un pedido.
   *
   * Se dispara sola al cargar el pedido: nadie tiene que acordarse de planificar
   * la produccion, porque un pedido cargado ES trabajo pendiente de fabrica. El
   * que elabora ve la lista de ordenes y decide cuales arranca —puede tener dos
   * o tres tandas en curso al mismo tiempo, cada una con su lote—, y esa decision
   * sigue siendo suya: el sistema solo se encarga de que el trabajo aparezca.
   *
   * Es idempotente: si el pedido ya tiene una orden viva para ese producto, no
   * se duplica. Y no bloquea nada: un producto sin receta simplemente se informa,
   * porque puede ser algo que se revende sin elaborar.
   */
  generarOrdenesParaPedido(pedidoId: number): {
    creadas: { ordenId: number; articuloNombre: string; cantidad: number }[];
    sinReceta: string[];
  } {
    const resultado = ejecutarSeguro('generar las ordenes de un pedido', () =>
      obtenerDb().transaction((tx) => {
        const items = tx
          .select({
            articuloId: pedidoItems.articuloId,
            nombre: articulos.nombre,
            cantidad: pedidoItems.cantidad,
          })
          .from(pedidoItems)
          .innerJoin(articulos, eq(articulos.id, pedidoItems.articuloId))
          .where(eq(pedidoItems.pedidoId, pedidoId))
          .all();

        const creadas: { ordenId: number; articuloNombre: string; cantidad: number }[] = [];
        const sinReceta: string[] = [];

        // Si al corregir el pedido se saco un producto, la orden que se habia
        // abierto sola por el queda sin motivo. Se cancela mientras no haya
        // empezado: una tanda ya en curso no se toca por atras.
        const articulosDelPedido = new Set(items.map((i) => i.articuloId));
        for (const orden of tx
          .select({ id: ordenesProduccion.id, articuloId: ordenesProduccion.articuloProducidoId })
          .from(ordenesProduccion)
          .where(
            and(
              eq(ordenesProduccion.pedidoId, pedidoId),
              eq(ordenesProduccion.estado, 'planificada'),
            ),
          )
          .all()) {
          if (!articulosDelPedido.has(orden.articuloId)) {
            tx.update(ordenesProduccion)
              .set({ estado: 'cancelada', notas: `El pedido #${pedidoId} ya no lleva este producto` })
              .where(eq(ordenesProduccion.id, orden.id))
              .run();
          }
        }

        for (const item of items) {
          const receta = tx
            .select({ id: recetas.id, rindeCantidad: recetas.rindeCantidad })
            .from(recetas)
            .where(and(eq(recetas.articuloProducidoId, item.articuloId), eq(recetas.activa, true)))
            .get();
          if (!receta) {
            sinReceta.push(item.nombre);
            continue;
          }

          // Lo que falta elaborar es lo pedido menos lo apartado, MENOS lo que
          // ya esta viniendo en ordenes vivas de este pedido (una tanda en
          // elaboracion va a reservar al finalizar: no se cuenta dos veces).
          const enCamino =
            tx
              .select({ s: sql<number>`COALESCE(SUM(${ordenesProduccion.cantidadPlanificada}), 0)`.mapWith(Number) })
              .from(ordenesProduccion)
              .where(
                and(
                  eq(ordenesProduccion.pedidoId, pedidoId),
                  eq(ordenesProduccion.articuloProducidoId, item.articuloId),
                  inArray(ordenesProduccion.estado, ['planificada', 'en_proceso', 'pausada']),
                ),
              )
              .get()?.s ?? 0;
          const pendiente = redondearCantidad(faltaCubrir(tx, pedidoId, item.articuloId) - enCamino);
          if (pendiente <= 0) continue;

          // Si hay una orden PLANIFICADA de este pedido, se agranda: el que
          // produce ve una sola orden con la cantidad real, no dos papelitos.
          // (Antes, agrandar el pedido de 10 a 50 no producia los 40 extra:
          // la orden existente hacia de tapon y nadie se enteraba.)
          const planificada = tx
            .select({ id: ordenesProduccion.id, cantidadPlanificada: ordenesProduccion.cantidadPlanificada })
            .from(ordenesProduccion)
            .where(
              and(
                eq(ordenesProduccion.pedidoId, pedidoId),
                eq(ordenesProduccion.articuloProducidoId, item.articuloId),
                eq(ordenesProduccion.estado, 'planificada'),
              ),
            )
            .get();
          if (planificada !== undefined) {
            const nueva = redondearCantidad(planificada.cantidadPlanificada + pendiente);
            tx.update(ordenesProduccion)
              .set({
                cantidadPlanificada: nueva,
                factorEscala: redondearCantidad(nueva / receta.rindeCantidad),
                notas: `Ampliada: el pedido #${pedidoId} crecio`,
              })
              .where(eq(ordenesProduccion.id, planificada.id))
              .run();
            creadas.push({ ordenId: planificada.id, articuloNombre: item.nombre, cantidad: nueva });
            continue;
          }

          const orden = tx
            .insert(ordenesProduccion)
            .values({
              recetaId: receta.id,
              articuloProducidoId: item.articuloId,
              cantidadPlanificada: redondearCantidad(pendiente),
              factorEscala: redondearCantidad(pendiente / receta.rindeCantidad),
              estado: 'planificada',
              pedidoId,
              fechaPlanificada: new Date().toISOString(),
              notas: `Generada automaticamente por el pedido #${pedidoId}`,
            })
            .returning({ id: ordenesProduccion.id })
            .all()[0];
          if (orden) {
            creadas.push({
              ordenId: orden.id,
              articuloNombre: item.nombre,
              cantidad: redondearCantidad(pendiente),
            });
          }
        }

        return { creadas, sinReceta };
      }),
    );
    if (resultado.creadas.length > 0) emitir('ordenes:cambio');
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
    forzar = false,
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

        /* -------------------- Pausar / reanudar la tanda -------------------- */
        // La pausa no toca lote, consumos ni insumos: la tanda sigue teniendo
        // dueño de su materia prima, solo esta detenida.
        if (nuevoEstado === 'pausada') {
          tx.update(ordenesProduccion)
            .set({ estado: 'pausada' })
            .where(eq(ordenesProduccion.id, ordenId))
            .run();
          return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote, advertencias: [] };
        }
        if (nuevoEstado === 'en_proceso' && orden.estado === 'pausada') {
          tx.update(ordenesProduccion)
            .set({ estado: 'en_proceso' })
            .where(eq(ordenesProduccion.id, ordenId))
            .run();
          return { id: ordenId, estado: nuevoEstado, numeroLote: orden.numeroLote, advertencias: [] };
        }

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

          /* Chequeo de insumos EN EL MOMENTO de elaborar: el stock pudo cambiar
             desde que la orden se creo. "Disponible" descuenta lo que las tandas
             en curso van a consumir cuando finalicen, porque esa harina ya tiene
             dueño aunque el ledger todavia la muestre.

             Si falta y no se fuerza, la orden no arranca: elaborar sin insumos
             cargados dejaria stock negativo seguro. El operador que tiene la
             materia prima en la mesa (papel atrasado) puede forzar, avisado. */
          const advertenciasElaborar: string[] = [];
          const consumosDeEsta = tx
            .select({
              insumoId: produccionConsumos.articuloInsumoId,
              cantidad: sql<number>`COALESCE(${produccionConsumos.cantidadReal}, ${produccionConsumos.cantidadTeorica})`.mapWith(Number),
            })
            .from(produccionConsumos)
            .where(eq(produccionConsumos.ordenId, ordenId))
            .all();

          const faltantes: string[] = [];
          for (const consumo of consumosDeEsta) {
            const stockInsumo =
              tx
                .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
                .from(movimientosStock)
                .where(eq(movimientosStock.articuloId, consumo.insumoId))
                .get()?.s ?? 0;
            const comprometido =
              tx
                .select({
                  s: sql<number>`COALESCE(SUM(COALESCE(${produccionConsumos.cantidadReal}, ${produccionConsumos.cantidadTeorica})), 0)`.mapWith(Number),
                })
                .from(produccionConsumos)
                .innerJoin(ordenesProduccion, eq(ordenesProduccion.id, produccionConsumos.ordenId))
                .where(
                  and(
                    inArray(ordenesProduccion.estado, ['en_proceso', 'pausada']),
                    sql`${produccionConsumos.articuloInsumoId} = ${consumo.insumoId}`,
                  ),
                )
                .get()?.s ?? 0;
            const disponible = stockInsumo - comprometido;
            if (disponible < consumo.cantidad) {
              const ficha = tx
                .select({ nombre: articulos.nombre })
                .from(articulos)
                .where(eq(articulos.id, consumo.insumoId))
                .get();
              faltantes.push(
                `${ficha?.nombre ?? `insumo ${consumo.insumoId}`}: faltan ${redondearCantidad(consumo.cantidad - disponible)}`,
              );
            }
          }

          if (faltantes.length > 0) {
            if (!forzar) {
              throw new ErrorReglaNegocio(
                `No alcanzan los insumos para elaborar la orden #${ordenId}: ${faltantes.join(' · ')}. ` +
                  'Carga la compra que falta, o forza la elaboracion si la materia prima esta fisicamente.',
                { ordenId, faltantes },
              );
            }
            advertenciasElaborar.push(
              `Se elaboro forzado con insumos en falta (${faltantes.join(' · ')}): el stock va a quedar negativo al finalizar.`,
            );
          }

          tx.update(ordenesProduccion)
            .set({ estado: nuevoEstado, numeroLote, fechaInicio: ahora })
            .where(eq(ordenesProduccion.id, ordenId))
            .run();

          // Una tanda del pedido arranco: el pedido entero esta en produccion.
          if (orden.pedidoId !== null) {
            tx.update(pedidos)
              .set({ estado: 'en_produccion' })
              .where(
                and(
                  eq(pedidos.id, orden.pedidoId),
                  inArray(pedidos.estado, ['pendiente', 'confirmado']),
                ),
              )
              .run();
          }

          return { id: ordenId, estado: nuevoEstado, numeroLote, advertencias: advertenciasElaborar };
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

          // Si la tanda se elaboro contra un pedido, lo producido entra al
          // deposito pero ya con dueño: es de ese cliente y no se le puede
          // vender a otro. Una orden interna, en cambio, entra disponible.
          //
          // Se reserva solo lo que el pedido todavia necesita: si la tanda
          // rindio de mas, el excedente queda a la venta, que es lo correcto
          // —el cliente encargo una cantidad, no la tanda entera—.
          const pedidoDeLaOrden =
            orden.pedidoId === null
              ? undefined
              : tx
                  .select({ estado: pedidos.estado })
                  .from(pedidos)
                  .where(eq(pedidos.id, orden.pedidoId))
                  .get();
          const pedidoVivo =
            pedidoDeLaOrden !== undefined &&
            ['pendiente', 'confirmado', 'en_produccion', 'listo'].includes(pedidoDeLaOrden.estado);

          if (orden.pedidoId !== null && !pedidoVivo) {
            // La tanda se elaboro para un pedido que ya no existe (cancelado o
            // entregado por otra via): lo producido entra DISPONIBLE. El lote no
            // se pierde: queda en la orden y en el ledger; solo cambia de dueño.
            advertencias.push(
              `El pedido #${orden.pedidoId} ya no esta vigente: lo producido entra al stock disponible.`,
            );
          }

          if (orden.pedidoId !== null && pedidoVivo) {
            const pendiente = faltaCubrir(tx, orden.pedidoId, orden.articuloProducidoId);
            const aReservar = Math.min(producido, pendiente);
            if (aReservar > 0) {
              reservar(tx, {
                pedidoId: orden.pedidoId,
                articuloId: orden.articuloProducidoId,
                cantidad: aReservar,
                origen: 'produccion',
                ordenId,
                numeroLote: orden.numeroLote,
                notas: `Elaborado para el pedido #${orden.pedidoId}`,
              });
            }
            if (producido > pendiente && pendiente > 0) {
              advertencias.push(
                `Sobraron ${redondearCantidad(producido - pendiente)} del pedido #${orden.pedidoId}: quedan disponibles para vender.`,
              );
            }
            if (promoverSiCubierto(tx, orden.pedidoId)) {
              advertencias.push(
                `El pedido #${orden.pedidoId} quedo LISTO: todo lo pedido esta apartado para el cliente.`,
              );
            }
          }

          // Lo que entro sin dueño (tanda interna, o sobrante de la del pedido)
          // puede estar esperandolo otro pedido: se aparta solo.
          cubrirPedidosPendientes(tx, [orden.articuloProducidoId]);

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
    // Finalizar mueve el ledger y puede dejar mercaderia reservada: stock y
    // pedidos tienen que refrescarse solos, sin que nadie apriete nada.
    emitir('maestros:cambio');
    emitir('pedidos:cambio');
    return resultado;
  },
};
