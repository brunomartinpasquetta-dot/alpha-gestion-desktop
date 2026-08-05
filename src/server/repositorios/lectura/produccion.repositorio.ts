/**
 * Repositorio de LECTURA de ordenes de produccion.
 *
 * `cantidadInsumos` sale de un LEFT JOIN + COUNT contra `produccion_consumos`:
 * una orden recien planificada todavia no tiene consumos cargados y debe
 * aparecer igual, con cero. Con INNER JOIN desapareceria justo la orden que mas
 * interesa ver en el tablero.
 */

import { desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  ordenesProduccion,
  produccionConsumos,
  unidadesMedida,
  type EstadoOrdenProduccion,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Orden de produccion con el articulo producido y el recuento de consumos resueltos. */
export interface FilaOrdenProduccion {
  id: number;
  recetaId: number;
  articuloProducidoId: number;
  articuloProducidoCodigo: string;
  articuloProducidoNombre: string;
  cantidadPlanificada: number;
  unidadAbreviatura: string;
  factorEscala: number;
  estado: EstadoOrdenProduccion;
  pedidoId: number | null;
  rindeReal: number | null;
  fechaPlanificada: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  notas: string | null;
  cantidadInsumos: number;
}

/** Listado completo de ordenes, de la planificada mas reciente a la mas vieja. */
export function listarOrdenes(): FilaOrdenProduccion[] {
  return ejecutarSeguro('listar ordenes de produccion', () =>
    obtenerDb()
      .select({
        id: ordenesProduccion.id,
        recetaId: ordenesProduccion.recetaId,
        articuloProducidoId: ordenesProduccion.articuloProducidoId,
        articuloProducidoCodigo: articulos.codigo,
        articuloProducidoNombre: articulos.nombre,
        cantidadPlanificada: ordenesProduccion.cantidadPlanificada,
        unidadAbreviatura: unidadesMedida.abreviatura,
        factorEscala: ordenesProduccion.factorEscala,
        estado: ordenesProduccion.estado,
        pedidoId: ordenesProduccion.pedidoId,
        rindeReal: ordenesProduccion.rindeReal,
        fechaPlanificada: ordenesProduccion.fechaPlanificada,
        fechaInicio: ordenesProduccion.fechaInicio,
        fechaFin: ordenesProduccion.fechaFin,
        notas: ordenesProduccion.notas,
        cantidadInsumos: sql<number>`COUNT(${produccionConsumos.id})`.mapWith(Number),
      })
      .from(ordenesProduccion)
      .innerJoin(articulos, eq(articulos.id, ordenesProduccion.articuloProducidoId))
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
      .leftJoin(produccionConsumos, eq(produccionConsumos.ordenId, ordenesProduccion.id))
      .groupBy(ordenesProduccion.id)
      .orderBy(desc(ordenesProduccion.fechaPlanificada), desc(ordenesProduccion.id))
      .all(),
  );
}
