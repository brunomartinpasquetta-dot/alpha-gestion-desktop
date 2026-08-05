/**
 * Repositorio de LECTURA de pedidos.
 *
 * Mismo patron de dos consultas que las recetas: cabeceras primero, items de
 * todas esas cabeceras despues. El pedido es la pantalla que mas se refresca del
 * sistema (entra por el celular), asi que no puede costar una query por fila.
 */

import { asc, desc, eq, inArray } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  clientes,
  pedidoItems,
  pedidos,
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
  notas: string | null;
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
      })
      .from(pedidos)
      .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
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
        notas: pedidoItems.notas,
      })
      .from(pedidoItems)
      .innerJoin(articulos, eq(articulos.id, pedidoItems.articuloId))
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
      .where(inArray(pedidoItems.pedidoId, [...pedidoIds]))
      .orderBy(asc(pedidoItems.pedidoId), asc(pedidoItems.id))
      .all(),
  );
}
