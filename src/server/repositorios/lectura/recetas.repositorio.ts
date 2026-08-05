/**
 * Repositorio de LECTURA de recetas (BOM).
 *
 * La receta y sus items se leen con DOS consultas, nunca con una por receta: se
 * traen todas las cabeceras y despues todos los items de esas cabeceras con un
 * unico `IN (...)`. El armado del arbol lo hace el servicio en memoria. Esto es
 * lo que evita el N+1 clasico de los listados con hijos anidados.
 */

import { asc, eq, inArray } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  recetaItems,
  recetas,
  unidadesMedida,
  type TipoArticulo,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Cabecera de receta con el articulo producido y la unidad del rinde ya resueltos. */
export interface FilaReceta {
  id: number;
  articuloProducidoId: number;
  articuloProducidoCodigo: string;
  articuloProducidoNombre: string;
  articuloProducidoTipo: TipoArticulo;
  rindeCantidad: number;
  rindeUnidadAbreviatura: string;
  activa: boolean;
  notas: string | null;
}

/** Item de receta. Incluye `recetaId` porque es la clave con la que el servicio agrupa. */
export interface FilaRecetaItem {
  id: number;
  recetaId: number;
  articuloInsumoId: number;
  insumoCodigo: string;
  insumoNombre: string;
  insumoTipo: TipoArticulo;
  cantidad: number;
  unidadAbreviatura: string;
  mermaEsperadaPct: number;
}

/** Cabeceras de todas las recetas, ordenadas por el nombre del articulo que producen. */
export function listarRecetas(): FilaReceta[] {
  return ejecutarSeguro('listar recetas', () =>
    obtenerDb()
      .select({
        id: recetas.id,
        articuloProducidoId: recetas.articuloProducidoId,
        articuloProducidoCodigo: articulos.codigo,
        articuloProducidoNombre: articulos.nombre,
        articuloProducidoTipo: articulos.tipo,
        rindeCantidad: recetas.rindeCantidad,
        rindeUnidadAbreviatura: unidadesMedida.abreviatura,
        activa: recetas.activa,
        notas: recetas.notas,
      })
      .from(recetas)
      .innerJoin(articulos, eq(articulos.id, recetas.articuloProducidoId))
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, recetas.rindeUnidadId))
      .orderBy(asc(articulos.nombre), asc(recetas.id))
      .all(),
  );
}

/**
 * Items de varias recetas en UNA sola consulta. La lista vacia se corta antes de
 * ir a la base: un `IN ()` no tiene sentido y ademas no es SQL portable.
 */
export function listarItemsDeRecetas(recetaIds: readonly number[]): FilaRecetaItem[] {
  if (recetaIds.length === 0) return [];

  return ejecutarSeguro('listar items de recetas', () =>
    obtenerDb()
      .select({
        id: recetaItems.id,
        recetaId: recetaItems.recetaId,
        articuloInsumoId: recetaItems.articuloInsumoId,
        insumoCodigo: articulos.codigo,
        insumoNombre: articulos.nombre,
        insumoTipo: articulos.tipo,
        cantidad: recetaItems.cantidad,
        unidadAbreviatura: unidadesMedida.abreviatura,
        mermaEsperadaPct: recetaItems.mermaEsperadaPct,
      })
      .from(recetaItems)
      .innerJoin(articulos, eq(articulos.id, recetaItems.articuloInsumoId))
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
      .where(inArray(recetaItems.recetaId, [...recetaIds]))
      .orderBy(asc(recetaItems.recetaId), asc(articulos.nombre))
      .all(),
  );
}
