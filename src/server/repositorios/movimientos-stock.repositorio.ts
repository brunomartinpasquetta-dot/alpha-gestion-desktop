/**
 * Repositorio del ledger de stock.
 *
 * `movimientos_stock` es append-only por diseño: es la unica fuente de verdad del
 * stock, asi que no se expone update ni delete. Corregir un error significa
 * asentar un movimiento de `ajuste` con el signo contrario, no reescribir el
 * pasado. Eso mantiene la trazabilidad completa de como se llego a un saldo.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import {
  movimientosStock,
  type MovimientoStock,
  type NuevoMovimientoStock,
  type TipoDocumentoStock,
} from '../db/schema';
import { ejecutarSeguro, ErrorDatos } from '../dominio/errores';
import { redondearCantidad } from '../utiles/numeros';

/** Inserta un asiento del ledger y devuelve la fila persistida (con id y fecha resueltos). */
export function insertar(valores: NuevoMovimientoStock): MovimientoStock {
  return ejecutarSeguro('insertar movimiento de stock', () => {
    const fila = obtenerDb().insert(movimientosStock).values(valores).returning().all()[0];
    if (!fila) {
      throw new ErrorDatos('El motor no devolvio la fila del movimiento de stock insertado.');
    }
    return fila;
  });
}

/**
 * Saldo de un articulo: `SUM(cantidad)` calculado EN SQL.
 *
 * Se agrega en la base a proposito: traer todas las filas del ledger a memoria
 * para sumarlas escala pesimo y es exactamente el error que este diseño evita.
 * Sin movimientos devuelve 0 (articulo existente pero sin historia).
 */
export function sumarCantidadPorArticulo(articuloId: number): number {
  return ejecutarSeguro('sumar cantidades del ledger de stock', () => {
    const fila = obtenerDb()
      .select({
        total: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number),
      })
      .from(movimientosStock)
      .where(eq(movimientosStock.articuloId, articuloId))
      .all()[0];
    return redondearCantidad(fila?.total ?? 0);
  });
}

/** Historial del articulo, del mas reciente al mas antiguo. `limite` acota la lectura. */
export function listarPorArticulo(articuloId: number, limite?: number): MovimientoStock[] {
  return ejecutarSeguro('listar movimientos de stock por articulo', () => {
    const consulta = obtenerDb()
      .select()
      .from(movimientosStock)
      .where(eq(movimientosStock.articuloId, articuloId))
      // El id desempata movimientos con la misma fecha (carga masiva en el mismo instante).
      .orderBy(desc(movimientosStock.fecha), desc(movimientosStock.id));
    return limite !== undefined && limite > 0 ? consulta.limit(limite).all() : consulta.all();
  });
}

/** Movimientos originados por un documento concreto (para trazar o revertir su impacto). */
export function listarPorDocumento(
  documentoTipo: TipoDocumentoStock,
  documentoId: number,
): MovimientoStock[] {
  return ejecutarSeguro('listar movimientos de stock por documento', () =>
    obtenerDb()
      .select()
      .from(movimientosStock)
      .where(
        and(
          eq(movimientosStock.documentoTipo, documentoTipo),
          eq(movimientosStock.documentoId, documentoId),
        ),
      )
      .orderBy(desc(movimientosStock.fecha), desc(movimientosStock.id))
      .all(),
  );
}
