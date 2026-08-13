/**
 * Repositorio de LECTURA de pedidos.
 *
 * Mismo patron de dos consultas que las recetas: cabeceras primero, items de
 * todas esas cabeceras despues. El pedido es la pantalla que mas se refresca del
 * sistema (entra por el celular), asi que no puede costar una query por fila.
 */

import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  clientes,
  listasPrecio,
  vendedores,
  pedidoItems,
  pedidoRenglonComponentes,
  pedidoRenglones,
  pedidos,
  presentaciones,
  unidadesMedida,
  type EstadoPedido,
  type OrigenPedido,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Cabecera de pedido con el cliente resuelto (null = pedido sin cliente asociado). */
export interface FilaPedido {
  id: number;
  clienteId: number | null;
  clienteNombre: string | null;
  vendedorId: number | null;
  vendedorNombre: string | null;
  listaPrecioId: number | null;
  listaPrecioNombre: string | null;
  origen: OrigenPedido;
  estado: EstadoPedido;
  fechaPedido: string;
  fechaEntregaEstimada: string | null;
  cargadoPor: string | null;
  notas: string | null;
}

/** Item de pedido. Incluye `pedidoId` porque es la clave con la que el servicio agrupa. */
export interface FilaPedidoItem {
  id: number;
  pedidoId: number;
  articuloId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  unidadAbreviatura: string;
  unidadesPorCaja: number | null;
  notas: string | null;
  /** De lo pedido, cuanto ya esta apartado para este cliente. */
  reservado: number;
  /** Del deposito, cuanto se puede apartar hoy sin sacarselo a otro pedido. */
  disponible: number;
}

/** Listado de pedidos, del mas reciente al mas antiguo. */
export function listarPedidos(): FilaPedido[] {
  return ejecutarSeguro('listar pedidos', () =>
    obtenerDb()
      .select({
        id: pedidos.id,
        clienteId: pedidos.clienteId,
        clienteNombre: clientes.nombre,
        origen: pedidos.origen,
        estado: pedidos.estado,
        fechaPedido: pedidos.fechaPedido,
        fechaEntregaEstimada: pedidos.fechaEntregaEstimada,
        cargadoPor: pedidos.cargadoPor,
        notas: pedidos.notas,
        vendedorId: pedidos.vendedorId,
        vendedorNombre: vendedores.nombre,
        listaPrecioId: pedidos.listaPrecioId,
        listaPrecioNombre: listasPrecio.nombre,
      })
      .from(pedidos)
      .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
      .leftJoin(vendedores, eq(vendedores.id, pedidos.vendedorId))
      .leftJoin(listasPrecio, eq(listasPrecio.id, pedidos.listaPrecioId))
      .orderBy(desc(pedidos.fechaPedido), desc(pedidos.id))
      .all(),
  );
}

/** Items de varios pedidos en UNA sola consulta. */
export function listarItemsDePedidos(pedidoIds: readonly number[]): FilaPedidoItem[] {
  if (pedidoIds.length === 0) return [];

  return ejecutarSeguro('listar items de pedidos', () =>
    obtenerDb()
      .select({
        id: pedidoItems.id,
        pedidoId: pedidoItems.pedidoId,
        articuloId: pedidoItems.articuloId,
        codigo: articulos.codigo,
        nombre: articulos.nombre,
        cantidad: pedidoItems.cantidad,
        unidadAbreviatura: unidadesMedida.abreviatura,
        unidadesPorCaja: articulos.unidadesPorCaja,
        notas: pedidoItems.notas,
        reservado:
          sql<number>`COALESCE((SELECT SUM(cantidad) FROM reservas_stock WHERE pedido_id = ${pedidoItems.pedidoId} AND articulo_id = ${pedidoItems.articuloId} AND estado = 'activa'), 0)`.mapWith(
            Number,
          ),
        // Lo que hay menos lo que ya tiene dueño. Nunca negativo: si las
        // reservas superan al fisico (produccion sin cargar), lo honesto es
        // decir cero, no un numero rojo que nadie sabe interpretar.
        disponible:
          sql<number>`MAX(0, COALESCE((SELECT SUM(cantidad) FROM movimientos_stock WHERE articulo_id = ${pedidoItems.articuloId}), 0) - COALESCE((SELECT SUM(cantidad) FROM reservas_stock WHERE articulo_id = ${pedidoItems.articuloId} AND estado = 'activa'), 0))`.mapWith(
            Number,
          ),
      })
      .from(pedidoItems)
      .innerJoin(articulos, eq(articulos.id, pedidoItems.articuloId))
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
      .where(inArray(pedidoItems.pedidoId, [...pedidoIds]))
      .orderBy(asc(pedidoItems.pedidoId), asc(pedidoItems.id))
      .all(),
  );
}


/** Renglones del talonario de varios pedidos, en una consulta. */
export interface FilaRenglonPedido {
  id: number;
  pedidoId: number;
  presentacionId: number | null;
  presentacionCodigo: string | null;
  presentacionNombre: string | null;
  descripcion: string | null;
  cantidad: number;
}

export interface FilaComponenteRenglon {
  renglonId: number;
  articuloId: number;
  articuloNombre: string;
  unidades: number;
}

export function listarComponentesDeRenglones(renglonIds: readonly number[]): FilaComponenteRenglon[] {
  if (renglonIds.length === 0) return [];
  return ejecutarSeguro('listar componentes de renglones a medida', () =>
    obtenerDb()
      .select({
        renglonId: pedidoRenglonComponentes.renglonId,
        articuloId: pedidoRenglonComponentes.articuloId,
        articuloNombre: articulos.nombre,
        unidades: pedidoRenglonComponentes.unidades,
      })
      .from(pedidoRenglonComponentes)
      .innerJoin(articulos, eq(articulos.id, pedidoRenglonComponentes.articuloId))
      .where(inArray(pedidoRenglonComponentes.renglonId, [...renglonIds]))
      .all(),
  );
}

export function listarRenglonesDePedidos(pedidoIds: readonly number[]): FilaRenglonPedido[] {
  if (pedidoIds.length === 0) return [];
  return ejecutarSeguro('listar renglones de pedidos', () =>
    obtenerDb()
      .select({
        id: pedidoRenglones.id,
        pedidoId: pedidoRenglones.pedidoId,
        presentacionId: pedidoRenglones.presentacionId,
        presentacionCodigo: presentaciones.codigo,
        presentacionNombre: presentaciones.nombre,
        descripcion: pedidoRenglones.descripcion,
        cantidad: pedidoRenglones.cantidad,
      })
      .from(pedidoRenglones)
      .leftJoin(presentaciones, eq(presentaciones.id, pedidoRenglones.presentacionId))
      .where(inArray(pedidoRenglones.pedidoId, [...pedidoIds]))
      .orderBy(asc(pedidoRenglones.pedidoId), asc(pedidoRenglones.id))
      .all(),
  );
}
