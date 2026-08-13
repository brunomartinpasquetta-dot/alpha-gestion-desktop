/**
 * Reservas de stock: separar lo que HAY de lo que se puede PROMETER.
 *
 * El ledger dice cuanto hay en el deposito. No dice de quien es. Cuando la
 * fabrica elabora una tanda contra el pedido de un cliente, esa mercaderia esta
 * fisicamente en el deposito pero ya no se le puede vender a otro: es del que la
 * encargo. Sin esa distincion, dos vendedores prometen la misma tanda y uno de
 * los dos clientes se queda esperando.
 *
 * De ahi los tres numeros:
 *   fisico     = SUM(movimientos_stock)
 *   reservado  = SUM(reservas activas)
 *   disponible = fisico - reservado
 *
 * La reserva NO mueve el ledger. La mercaderia sale del deposito recien con la
 * venta; ahi la reserva pasa a `entregada` y deja de descontar disponible, que
 * es justo cuando el movimiento negativo de la venta lo descuenta del fisico.
 * Si en cambio el pedido se cancela, la reserva pasa a `liberada` y la
 * mercaderia vuelve a estar a la venta.
 *
 * TRAZABILIDAD. Cada reserva guarda de que tanda salio (`ordenId` + lote). Si se
 * elaboro para el pedido, es la tanda que se elaboro. Si se tomo de lo que ya
 * habia, se reparte por lote en orden de antiguedad —lo mas viejo primero, que
 * es como se despacha un producto con vencimiento— y puede quedar mas de una
 * reserva para el mismo item si hizo falta juntar dos tandas.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import {
  articulos,
  movimientosStock,
  ordenesProduccion,
  pedidoItems,
  pedidos,
  recetas,
  reservasStock,
  type OrigenReserva,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

/** Una tanda (o ingreso sin tanda) con lo que todavia queda de ella. */
export interface LoteConSaldo {
  ordenId: number | null;
  numeroLote: string | null;
  fecha: string;
  /** Lo que entro con ese ingreso. */
  ingresado: number;
  /** Lo que queda sin vender ni reservar, atribuido por antiguedad. */
  disponible: number;
}

/* -------------------------------------------------------------------------- */
/* Consultas basicas                                                          */
/* -------------------------------------------------------------------------- */

/** Lo que hay fisicamente, segun el ledger. */
export function stockFisico(tx: Tx, articuloId: number): number {
  const fila = tx
    .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
    .from(movimientosStock)
    .where(eq(movimientosStock.articuloId, articuloId))
    .get();
  return redondearCantidad(fila?.s ?? 0);
}

/** Lo que ya tiene dueño: reservas activas. */
export function stockReservado(tx: Tx, articuloId: number): number {
  const fila = tx
    .select({ s: sql<number>`COALESCE(SUM(${reservasStock.cantidad}), 0)`.mapWith(Number) })
    .from(reservasStock)
    .where(and(eq(reservasStock.articuloId, articuloId), eq(reservasStock.estado, 'activa')))
    .get();
  return redondearCantidad(fila?.s ?? 0);
}

/** Lo que se puede prometer hoy a un cliente nuevo. Nunca menos de cero. */
export function stockDisponible(tx: Tx, articuloId: number): number {
  return redondearCantidad(Math.max(0, stockFisico(tx, articuloId) - stockReservado(tx, articuloId)));
}

/**
 * Reparte el saldo fisico entre las tandas que lo originaron, de la mas vieja a
 * la mas nueva.
 *
 * El ledger no ata cada egreso a un lote: una venta descuenta del articulo, no
 * de una tanda. Asi que la atribucion se hace por antiguedad (lo que entro
 * primero sale primero), que ademas de ser la convencion contable es como se
 * despacha de verdad un producto con fecha de vencimiento. El resultado es
 * exacto en el total —la suma de los lotes es el saldo fisico— y es la mejor
 * atribucion posible por lote sin pedirle al operador que elija tanda en cada
 * venta.
 */
export function lotesConSaldo(tx: Tx, articuloId: number): LoteConSaldo[] {
  const ingresos = tx
    .select({
      cantidad: movimientosStock.cantidad,
      fecha: movimientosStock.fecha,
      documentoTipo: movimientosStock.documentoTipo,
      documentoId: movimientosStock.documentoId,
    })
    .from(movimientosStock)
    .where(and(eq(movimientosStock.articuloId, articuloId), sql`${movimientosStock.cantidad} > 0`))
    .orderBy(asc(movimientosStock.fecha), asc(movimientosStock.id))
    .all();
  if (ingresos.length === 0) return [];

  const idsOrden = ingresos
    .filter((i) => i.documentoTipo === 'orden_produccion' && i.documentoId !== null)
    .map((i) => i.documentoId as number);
  const lotePorOrden = new Map<number, string | null>();
  if (idsOrden.length > 0) {
    for (const fila of tx
      .select({ id: ordenesProduccion.id, numeroLote: ordenesProduccion.numeroLote })
      .from(ordenesProduccion)
      .where(inArray(ordenesProduccion.id, idsOrden))
      .all()) {
      lotePorOrden.set(fila.id, fila.numeroLote);
    }
  }

  // Todo lo que salio del articulo, sin importar por que puerta.
  const egresos = Math.abs(
    tx
      .select({
        s: sql<number>`COALESCE(SUM(CASE WHEN ${movimientosStock.cantidad} < 0 THEN ${movimientosStock.cantidad} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      })
      .from(movimientosStock)
      .where(eq(movimientosStock.articuloId, articuloId))
      .get()?.s ?? 0,
  );

  // Lo que salio se le imputa a las tandas mas viejas primero.
  let porImputar = egresos;
  const lotes: LoteConSaldo[] = [];
  for (const ingreso of ingresos) {
    const consumido = Math.min(porImputar, ingreso.cantidad);
    porImputar -= consumido;
    const esOrden = ingreso.documentoTipo === 'orden_produccion' && ingreso.documentoId !== null;
    lotes.push({
      ordenId: esOrden ? (ingreso.documentoId as number) : null,
      numeroLote: esOrden ? (lotePorOrden.get(ingreso.documentoId as number) ?? null) : null,
      fecha: ingreso.fecha,
      ingresado: redondearCantidad(ingreso.cantidad),
      disponible: redondearCantidad(ingreso.cantidad - consumido),
    });
  }

  // Y lo ya reservado se descuenta de la tanda de la que se reservo, para no
  // volver a prometer lo mismo. Lo que no tiene tanda identificada se va
  // descontando de lo mas viejo, igual que los egresos.
  const reservas = tx
    .select({ ordenId: reservasStock.ordenId, cantidad: reservasStock.cantidad })
    .from(reservasStock)
    .where(and(eq(reservasStock.articuloId, articuloId), eq(reservasStock.estado, 'activa')))
    .all();

  let sinTanda = 0;
  for (const reserva of reservas) {
    if (reserva.ordenId === null) {
      sinTanda += reserva.cantidad;
      continue;
    }
    const lote = lotes.find((l) => l.ordenId === reserva.ordenId);
    if (lote === undefined) {
      sinTanda += reserva.cantidad;
      continue;
    }
    const baja = Math.min(lote.disponible, reserva.cantidad);
    lote.disponible = redondearCantidad(lote.disponible - baja);
    sinTanda += reserva.cantidad - baja;
  }
  for (const lote of lotes) {
    if (sinTanda <= 0) break;
    const baja = Math.min(lote.disponible, sinTanda);
    lote.disponible = redondearCantidad(lote.disponible - baja);
    sinTanda = redondearCantidad(sinTanda - baja);
  }

  return lotes.filter((l) => l.disponible > 0);
}

/* -------------------------------------------------------------------------- */
/* Altas de reserva                                                           */
/* -------------------------------------------------------------------------- */

/** Cuanto de este articulo ya esta reservado para este pedido. */
export function reservadoParaPedido(tx: Tx, pedidoId: number, articuloId: number): number {
  const fila = tx
    .select({ s: sql<number>`COALESCE(SUM(${reservasStock.cantidad}), 0)`.mapWith(Number) })
    .from(reservasStock)
    .where(
      and(
        eq(reservasStock.pedidoId, pedidoId),
        eq(reservasStock.articuloId, articuloId),
        eq(reservasStock.estado, 'activa'),
      ),
    )
    .get();
  return redondearCantidad(fila?.s ?? 0);
}

/** Cuanto falta cubrir de un articulo en un pedido: lo pedido menos lo ya reservado. */
export function faltaCubrir(tx: Tx, pedidoId: number, articuloId: number): number {
  const pedido = tx
    .select({ s: sql<number>`COALESCE(SUM(${pedidoItems.cantidad}), 0)`.mapWith(Number) })
    .from(pedidoItems)
    .where(and(eq(pedidoItems.pedidoId, pedidoId), eq(pedidoItems.articuloId, articuloId)))
    .get();
  return redondearCantidad(
    Math.max(0, (pedido?.s ?? 0) - reservadoParaPedido(tx, pedidoId, articuloId)),
  );
}

export interface AltaReserva {
  pedidoId: number;
  articuloId: number;
  cantidad: number;
  origen: OrigenReserva;
  ordenId?: number | null;
  numeroLote?: string | null;
  notas?: string | null;
}

/** Asienta una reserva. El cliente se toma del pedido, no se pasa por afuera. */
export function reservar(tx: Tx, alta: AltaReserva): void {
  const cantidad = redondearCantidad(alta.cantidad);
  if (cantidad <= 0) return;

  const pedido = tx
    .select({ id: pedidos.id, clienteId: pedidos.clienteId })
    .from(pedidos)
    .where(eq(pedidos.id, alta.pedidoId))
    .get();
  if (!pedido) throw new ErrorNoEncontrado('pedido', alta.pedidoId);

  tx.insert(reservasStock)
    .values({
      articuloId: alta.articuloId,
      pedidoId: alta.pedidoId,
      clienteId: pedido.clienteId,
      cantidad,
      origen: alta.origen,
      ordenId: alta.ordenId ?? null,
      numeroLote: alta.numeroLote ?? null,
      estado: 'activa',
      fecha: new Date().toISOString(),
      notas: alta.notas ?? null,
    })
    .run();
}

/**
 * Si todo lo que el pedido necesita ya esta apartado, el pedido pasa SOLO a
 * LISTO. Antes ese pase era un boton, y un boton que hay que acordarse de
 * apretar es un pedido que el cliente viene a buscar y nadie preparo.
 *
 * Escribe el estado directo (sin la maquina de transiciones): la maquina
 * protege las acciones del OPERADOR; esta es una consecuencia del sistema y
 * puede saltar de pendiente a listo si el stock alcanzaba desde el principio.
 */
export function promoverSiCubierto(tx: Tx, pedidoId: number): boolean {
  const pedido = tx
    .select({ estado: pedidos.estado })
    .from(pedidos)
    .where(eq(pedidos.id, pedidoId))
    .get();
  if (!pedido) return false;
  if (pedido.estado !== 'pendiente' && pedido.estado !== 'confirmado' && pedido.estado !== 'en_produccion') {
    return false;
  }

  const items = tx
    .select({ articuloId: pedidoItems.articuloId })
    .from(pedidoItems)
    .where(eq(pedidoItems.pedidoId, pedidoId))
    .all();
  if (items.length === 0) return false;

  for (const item of items) {
    if (faltaCubrir(tx, pedidoId, item.articuloId) > 0) return false;
  }

  tx.update(pedidos).set({ estado: 'listo' }).where(eq(pedidos.id, pedidoId)).run();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                              */
/* -------------------------------------------------------------------------- */

/**
 * La venta se llevo la mercaderia: las reservas del pedido dejan de retener
 * stock. No se borran —quedan con la venta que las consumio— porque son la
 * unica prueba de que tanda se le entrego a que cliente.
 */
export function entregarReservasDePedido(tx: Tx, pedidoId: number, ventaId: number): void {
  tx.update(reservasStock)
    .set({ estado: 'entregada', ventaId })
    .where(and(eq(reservasStock.pedidoId, pedidoId), eq(reservasStock.estado, 'activa')))
    .run();
}

/**
 * Consume reservas del pedido por lo efectivamente VENDIDO, de la mas vieja a
 * la mas nueva (mismo criterio que el despacho fisico: lo primero que entro es
 * lo primero que sale). Si una reserva es mas grande que lo que falta consumir,
 * se parte en dos: la porcion vendida queda 'entregada' con su venta y su lote,
 * y el resto sigue 'activa' apartado para el cliente. Asi una entrega parcial
 * no pierde ni la trazabilidad ni el saldo apartado.
 */
export function entregarReservasParciales(
  tx: Tx,
  pedidoId: number,
  articuloId: number,
  cantidad: number,
  ventaId: number,
): void {
  let porEntregar = redondearCantidad(cantidad);
  if (porEntregar <= 0) return;

  const activas = tx
    .select()
    .from(reservasStock)
    .where(
      and(
        eq(reservasStock.pedidoId, pedidoId),
        eq(reservasStock.articuloId, articuloId),
        eq(reservasStock.estado, 'activa'),
      ),
    )
    .orderBy(asc(reservasStock.fecha), asc(reservasStock.id))
    .all();

  for (const reserva of activas) {
    if (porEntregar <= 0) break;

    if (reserva.cantidad <= porEntregar) {
      // La reserva entera se va con esta venta.
      tx.update(reservasStock)
        .set({ estado: 'entregada', ventaId })
        .where(eq(reservasStock.id, reserva.id))
        .run();
      porEntregar = redondearCantidad(porEntregar - reserva.cantidad);
    } else {
      // Se parte: lo vendido sale, el saldo sigue apartado con el mismo lote.
      tx.update(reservasStock)
        .set({ cantidad: redondearCantidad(reserva.cantidad - porEntregar) })
        .where(eq(reservasStock.id, reserva.id))
        .run();
      tx.insert(reservasStock)
        .values({
          articuloId: reserva.articuloId,
          pedidoId: reserva.pedidoId,
          clienteId: reserva.clienteId,
          cantidad: porEntregar,
          origen: reserva.origen,
          ordenId: reserva.ordenId,
          numeroLote: reserva.numeroLote,
          estado: 'entregada',
          ventaId,
          fecha: reserva.fecha,
          notas: reserva.notas,
        })
        .run();
      porEntregar = 0;
    }
  }
}

/**
 * Suelta reservas del pedido hasta que lo apartado no supere lo pedido.
 *
 * Existe por el caso real: el cliente pidio 50, se aparto 50, y despues baja el
 * pedido a 30. Sin esto las 20 de mas quedaban apartadas para siempre —y peor:
 * la venta precargaba 50 y se le cobraba de mas—. Se libera de la reserva MAS
 * NUEVA hacia atras, para que lo que quede apartado sea lo mas viejo (el lote
 * que corresponde despachar primero).
 */
export function liberarExceso(
  tx: Tx,
  pedidoId: number,
  articuloId: number,
  cantidadPedida: number,
): number {
  let exceso = redondearCantidad(reservadoParaPedido(tx, pedidoId, articuloId) - cantidadPedida);
  if (exceso <= 0) return 0;
  const liberado = exceso;

  const activas = tx
    .select()
    .from(reservasStock)
    .where(
      and(
        eq(reservasStock.pedidoId, pedidoId),
        eq(reservasStock.articuloId, articuloId),
        eq(reservasStock.estado, 'activa'),
      ),
    )
    .orderBy(sql`${reservasStock.fecha} DESC`, sql`${reservasStock.id} DESC`)
    .all();

  for (const reserva of activas) {
    if (exceso <= 0) break;
    if (reserva.cantidad <= exceso) {
      tx.update(reservasStock)
        .set({ estado: 'liberada', notas: 'El pedido se redujo: vuelve a disponible' })
        .where(eq(reservasStock.id, reserva.id))
        .run();
      exceso = redondearCantidad(exceso - reserva.cantidad);
    } else {
      // Se achica la reserva y el sobrante queda registrado como liberado.
      tx.update(reservasStock)
        .set({ cantidad: redondearCantidad(reserva.cantidad - exceso) })
        .where(eq(reservasStock.id, reserva.id))
        .run();
      tx.insert(reservasStock)
        .values({
          articuloId: reserva.articuloId,
          pedidoId: reserva.pedidoId,
          clienteId: reserva.clienteId,
          cantidad: exceso,
          origen: reserva.origen,
          ordenId: reserva.ordenId,
          numeroLote: reserva.numeroLote,
          estado: 'liberada',
          fecha: reserva.fecha,
          notas: 'El pedido se redujo: vuelve a disponible',
        })
        .run();
      exceso = 0;
    }
  }
  return liberado;
}

/** El pedido se cayo: lo reservado vuelve a estar disponible para vender. */
export function liberarReservasDePedido(tx: Tx, pedidoId: number, motivo: string): void {
  const articulosLiberados = tx
    .selectDistinct({ articuloId: reservasStock.articuloId })
    .from(reservasStock)
    .where(and(eq(reservasStock.pedidoId, pedidoId), eq(reservasStock.estado, 'activa')))
    .all()
    .map((fila) => fila.articuloId);
  tx.update(reservasStock)
    .set({ estado: 'liberada', notas: motivo })
    .where(and(eq(reservasStock.pedidoId, pedidoId), eq(reservasStock.estado, 'activa')))
    .run();
  // Lo liberado puede estar esperandolo otro pedido: se reparte ya, mirando
  // SOLO los articulos que se soltaron.
  if (articulosLiberados.length > 0) cubrirPedidosPendientes(tx, articulosLiberados);
}

/**
 * Barrido de pedidos pendientes: cuando aparece stock libre (se cancelo un
 * pedido, una venta parcial libero el resto, una tanda interna rindio de mas),
 * se les aparta a los pedidos que siguen esperando, del mas viejo al mas nuevo.
 *
 * Reemplaza al boton "Cubrir con stock": la pantalla de pedidos muestra SOLO
 * lo que compete al pedido, y el apartado es una consecuencia del sistema, no
 * una tarea que alguien tiene que acordarse de hacer.
 *
 * `articuloIds` acota el barrido a los articulos que ACABAN de liberarse: sin
 * el filtro, cada venta o cancelacion recorria todos los pedidos abiertos con
 * todos sus articulos contra el ledger entero, dentro de la transaccion de
 * escritura — un costo que crece con la historia.
 */
export function cubrirPedidosPendientes(tx: Tx, articuloIds?: readonly number[]): void {
  const filtro = articuloIds !== undefined && articuloIds.length > 0 ? new Set(articuloIds) : null;

  const abiertos = tx
    .select({ id: pedidos.id })
    .from(pedidos)
    .where(inArray(pedidos.estado, ['pendiente', 'confirmado', 'en_produccion']))
    .orderBy(asc(pedidos.fechaPedido), asc(pedidos.id))
    .all();

  for (const pedido of abiertos) {
    const items = tx
      .select({ articuloId: pedidoItems.articuloId })
      .from(pedidoItems)
      .where(eq(pedidoItems.pedidoId, pedido.id))
      .all()
      .filter((item) => filtro === null || filtro.has(item.articuloId));
    if (items.length === 0) continue;

    for (const item of items) {
      let porCubrir = faltaCubrir(tx, pedido.id, item.articuloId);
      if (porCubrir <= 0) continue;
      porCubrir = Math.min(porCubrir, stockDisponible(tx, item.articuloId));

      for (const lote of lotesConSaldo(tx, item.articuloId)) {
        if (porCubrir <= 0) break;
        const toma = redondearCantidad(Math.min(lote.disponible, porCubrir));
        if (toma <= 0) continue;
        reservar(tx, {
          pedidoId: pedido.id,
          articuloId: item.articuloId,
          cantidad: toma,
          origen: 'stock',
          ordenId: lote.ordenId,
          numeroLote: lote.numeroLote,
          notas: 'Apartado automatico al liberarse stock',
        });
        porCubrir = redondearCantidad(porCubrir - toma);
      }
      // La orden pendiente de ese pedido se achica por lo recien apartado.
      ajustarOrdenesPlanificadas(tx, pedido.id, item.articuloId, faltaCubrir(tx, pedido.id, item.articuloId));
    }
    promoverSiCubierto(tx, pedido.id);
  }
}

/* -------------------------------------------------------------------------- */
/* Operacion de usuario: cubrir un pedido con lo que ya hay                   */
/* -------------------------------------------------------------------------- */

/**
 * Deja las ordenes todavia sin arrancar de ese pedido produciendo solo lo que
 * falta. Si no falta nada, se cancelan: el trabajo ya esta cubierto con lo que
 * habia en el deposito y elaborarlo de nuevo seria tirar insumos.
 */
function ajustarOrdenesPlanificadas(
  tx: Tx,
  pedidoId: number,
  articuloId: number,
  cantidadPendiente: number,
): void {
  const abiertas = tx
    .select({
      id: ordenesProduccion.id,
      recetaId: ordenesProduccion.recetaId,
      cantidadPlanificada: ordenesProduccion.cantidadPlanificada,
    })
    .from(ordenesProduccion)
    .where(
      and(
        eq(ordenesProduccion.pedidoId, pedidoId),
        eq(ordenesProduccion.articuloProducidoId, articuloId),
        eq(ordenesProduccion.estado, 'planificada'),
      ),
    )
    .orderBy(asc(ordenesProduccion.id))
    .all();
  if (abiertas.length === 0) return;

  let restante = cantidadPendiente;
  for (const orden of abiertas) {
    if (restante <= 0) {
      tx.update(ordenesProduccion)
        .set({
          estado: 'cancelada',
          notas: `Cubierto con stock ya elaborado para el pedido #${pedidoId}`,
        })
        .where(eq(ordenesProduccion.id, orden.id))
        .run();
      continue;
    }
    const nueva = redondearCantidad(Math.min(restante, orden.cantidadPlanificada));
    restante = redondearCantidad(restante - nueva);
    if (nueva === orden.cantidadPlanificada) continue;

    const rinde = tx
      .select({ rindeCantidad: recetas.rindeCantidad })
      .from(recetas)
      .where(eq(recetas.id, orden.recetaId))
      .get()?.rindeCantidad;
    tx.update(ordenesProduccion)
      .set({
        cantidadPlanificada: nueva,
        factorEscala: rinde !== undefined && rinde > 0 ? redondearCantidad(nueva / rinde) : 1,
        notas: `Reducida: ${redondearCantidad(orden.cantidadPlanificada - nueva)} salieron de stock ya elaborado`,
      })
      .where(eq(ordenesProduccion.id, orden.id))
      .run();
  }
}

export interface ResultadoCobertura {
  pedidoId: number;
  /** Lo que se pudo reservar, por articulo y por tanda. */
  reservado: {
    articuloId: number;
    articuloNombre: string;
    cantidad: number;
    numeroLote: string | null;
  }[];
  /** Lo que no alcanzo a cubrirse y sigue dependiendo de que se elabore. */
  faltante: { articuloId: number; articuloNombre: string; cantidad: number }[];
  /** true si con esta cobertura el pedido quedo LISTO para entregar. */
  quedoListo: boolean;
}

export const reservasServicio = {
  /**
   * Toma del stock disponible lo que haga falta para cubrir el pedido y se lo
   * reserva al cliente, anotando de que tandas sale.
   *
   * Es una operacion PARCIAL a proposito: si hay 30 docenas y el pedido pide 50,
   * reserva las 30 y avisa que faltan 20. Bloquear la operacion entera por lo
   * que falta obligaria al vendedor a no hacer nada, cuando lo util es asegurar
   * lo que hay y elaborar solo la diferencia.
   */
  cubrirConStock(pedidoId: number): ResultadoCobertura {
    const resultado = ejecutarSeguro('cubrir un pedido con stock disponible', () =>
      obtenerDb().transaction((tx) => {
        const pedido = tx
          .select({ id: pedidos.id, estado: pedidos.estado })
          .from(pedidos)
          .where(eq(pedidos.id, pedidoId))
          .get();
        if (!pedido) throw new ErrorNoEncontrado('pedido', pedidoId);
        if (pedido.estado === 'cancelado' || pedido.estado === 'entregado') {
          throw new ErrorReglaNegocio(
            `El pedido #${pedidoId} esta ${pedido.estado}: no tiene sentido reservarle mercaderia.`,
          );
        }

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

        const reservado: ResultadoCobertura['reservado'] = [];
        const faltante: ResultadoCobertura['faltante'] = [];

        for (const item of items) {
          let porCubrir = faltaCubrir(tx, pedidoId, item.articuloId);
          if (porCubrir <= 0) continue;

          // El tope es el disponible real: nunca se promete dos veces lo mismo.
          porCubrir = Math.min(porCubrir, stockDisponible(tx, item.articuloId));

          for (const lote of lotesConSaldo(tx, item.articuloId)) {
            if (porCubrir <= 0) break;
            const toma = redondearCantidad(Math.min(lote.disponible, porCubrir));
            if (toma <= 0) continue;
            reservar(tx, {
              pedidoId,
              articuloId: item.articuloId,
              cantidad: toma,
              origen: 'stock',
              ordenId: lote.ordenId,
              numeroLote: lote.numeroLote,
              notas: `Tomado de stock ya elaborado${lote.numeroLote !== null ? ` (lote ${lote.numeroLote})` : ''}`,
            });
            reservado.push({
              articuloId: item.articuloId,
              articuloNombre: item.nombre,
              cantidad: toma,
              numeroLote: lote.numeroLote,
            });
            porCubrir = redondearCantidad(porCubrir - toma);
          }

          const sigueFaltando = faltaCubrir(tx, pedidoId, item.articuloId);
          if (sigueFaltando > 0) {
            faltante.push({
              articuloId: item.articuloId,
              articuloNombre: item.nombre,
              cantidad: sigueFaltando,
            });
          }

          // La orden que el pedido habia abierto sola ya no tiene que elaborar
          // todo: solo la diferencia. Sin esto, el que produce hace la tanda
          // entera y la fabrica termina con el doble de lo que se encargo.
          // Solo se tocan las que no arrancaron: una tanda en curso no se
          // modifica por atras.
          ajustarOrdenesPlanificadas(tx, pedidoId, item.articuloId, sigueFaltando);
        }

        const quedoListo = promoverSiCubierto(tx, pedidoId);
        return { pedidoId, reservado, faltante, quedoListo };
      }),
    );

    emitir('pedidos:cambio');
    emitir('maestros:cambio');
    // Cubrir con stock reduce o cancela ordenes: la pantalla de fabrica tiene
    // que verlo sin que nadie la refresque.
    emitir('ordenes:cambio');
    return resultado;
  },

  /** Suelta todo lo reservado para un pedido, sin cancelar el pedido. */
  liberar(pedidoId: number): { pedidoId: number } {
    ejecutarSeguro('liberar las reservas de un pedido', () =>
      obtenerDb().transaction((tx) => {
        liberarReservasDePedido(tx, pedidoId, 'Liberada a mano desde el pedido');
        return true;
      }),
    );
    emitir('pedidos:cambio');
    emitir('maestros:cambio');
    return { pedidoId };
  },
};
