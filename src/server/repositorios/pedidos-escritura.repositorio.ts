/**
 * Repositorio de ESCRITURA de pedidos.
 *
 * Primera pieza de escritura del sistema despues del ledger. La cabecera y sus
 * items se insertan en UNA transaccion: un pedido sin items o items sin pedido
 * son estados que no deben existir ni un instante.
 */

import { and, eq, inArray } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import { articulos, pedidoItems, pedidos, type EstadoPedido, type Pedido } from '../db/schema';
import { ejecutarSeguro } from '../dominio/errores';

export interface ValoresNuevoPedido {
  readonly clienteId: number | null;
  readonly vendedorId?: number | null;
  readonly listaPrecioId?: number | null;
  readonly origen: 'celular' | 'mostrador' | 'sistema';
  readonly fechaEntregaEstimada: string | null;
  readonly cargadoPor: string | null;
  readonly notas: string | null;
  readonly claveIdempotencia: string | null;
  readonly items: ReadonlyArray<{
    readonly articuloId: number;
    readonly cantidad: number;
    readonly notas: string | null;
  }>;
}

/** Inserta cabecera + items y devuelve la cabecera creada. */
export function insertarPedido(valores: ValoresNuevoPedido): Pedido {
  return ejecutarSeguro('crear un pedido', () =>
    obtenerDb().transaction((tx) => {
      const cabecera = tx
        .insert(pedidos)
        .values({
          clienteId: valores.clienteId,
          vendedorId: valores.vendedorId ?? null,
          listaPrecioId: valores.listaPrecioId ?? null,
          origen: valores.origen,
          estado: 'pendiente',
          fechaEntregaEstimada: valores.fechaEntregaEstimada,
          cargadoPor: valores.cargadoPor,
          notas: valores.notas,
          claveIdempotencia: valores.claveIdempotencia,
        })
        .returning()
        .all()[0];

      if (!cabecera) throw new Error('La base no devolvio el pedido insertado.');

      for (const item of valores.items) {
        tx.insert(pedidoItems)
          .values({
            pedidoId: cabecera.id,
            articuloId: item.articuloId,
            cantidad: item.cantidad,
            notas: item.notas,
          })
          .run();
      }

      return cabecera;
    }),
  );
}

/** Estado actual de un pedido, o undefined si no existe. */
export function buscarEstado(pedidoId: number): EstadoPedido | undefined {
  return ejecutarSeguro('leer el estado de un pedido', () =>
    obtenerDb()
      .select({ estado: pedidos.estado })
      .from(pedidos)
      .where(eq(pedidos.id, pedidoId))
      .get()?.estado,
  );
}

/** Cambia el estado. La validacion de la transicion vive en el servicio. */
export function actualizarEstado(pedidoId: number, estado: EstadoPedido): void {
  ejecutarSeguro('actualizar el estado de un pedido', () =>
    obtenerDb().update(pedidos).set({ estado }).where(eq(pedidos.id, pedidoId)).run(),
  );
}

/**
 * De los ids recibidos, devuelve los que existen como producto terminado activo.
 * El servicio compara contra lo pedido para armar un error con nombres propios.
 */
export function filtrarProductosVendibles(ids: readonly number[]): number[] {
  if (ids.length === 0) return [];
  return ejecutarSeguro('verificar articulos vendibles', () =>
    obtenerDb()
      .select({ id: articulos.id })
      .from(articulos)
      .where(
        and(
          inArray(articulos.id, [...ids]),
          eq(articulos.tipo, 'producto_terminado'),
          eq(articulos.activo, true),
        ),
      )
      .all()
      .map((fila) => fila.id),
  );
}
