/**
 * Repositorio de LECTURA de ordenes de produccion.
 *
 * `cantidadInsumos` sale de un LEFT JOIN + COUNT contra `produccion_consumos`:
 * una orden recien planificada todavia no tiene consumos cargados y debe
 * aparecer igual, con cero. Con INNER JOIN desapareceria justo la orden que mas
 * interesa ver en el tablero.
 */

import { desc, eq, inArray, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  clientes,
  ordenesProduccion,
  pedidos,
  produccionConsumos,
  recetaItems,
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
  /** Cuantas unidades entran en una caja; 12 = se produce y se vende por docena. */
  unidadesPorCaja: number | null;
  factorEscala: number;
  estado: EstadoOrdenProduccion;
  numeroLote: string | null;
  pedidoId: number | null;
  /** Para quien es la tanda. null = produccion interna, para stock. */
  clienteId: number | null;
  clienteNombre: string | null;
  rindeReal: number | null;
  fechaPlanificada: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  notas: string | null;
  cantidadInsumos: number;
  esperaInsumos: boolean;
  insumosFaltantes: string | null;
}

/**
 * Para cada orden planificada, cuanto le FALTA de cada insumo si se elaborara
 * hoy. "Disponible" descuenta lo que ya comprometieron las tandas en curso
 * (sus consumos todavia no estan en el ledger: se descuentan al finalizar).
 *
 * Es un calculo, no un estado guardado: cuando entra la compra del insumo, el
 * numero cambia solo y la orden deja de estar "en espera" sin que nadie la toque.
 */
function calcularFaltantes(
  filas: readonly { id: number; recetaId: number; factorEscala: number; estado: EstadoOrdenProduccion }[],
): Map<number, string> {
  const db = obtenerDb();
  const planificadas = filas.filter((f) => f.estado === 'planificada');
  const resultado = new Map<number, string>();
  if (planificadas.length === 0) return resultado;

  // Consumos ya cargados de estas ordenes (si los hay, mandan sobre la receta).
  const consumos = db
    .select({
      ordenId: produccionConsumos.ordenId,
      insumoId: produccionConsumos.articuloInsumoId,
      cantidad: sql<number>`COALESCE(${produccionConsumos.cantidadReal}, ${produccionConsumos.cantidadTeorica})`.mapWith(Number),
    })
    .from(produccionConsumos)
    .where(inArray(produccionConsumos.ordenId, planificadas.map((f) => f.id)))
    .all();

  // Items de receta, para las ordenes sin consumos cargados.
  const items = db
    .select({
      recetaId: recetaItems.recetaId,
      insumoId: recetaItems.articuloInsumoId,
      cantidad: recetaItems.cantidad,
    })
    .from(recetaItems)
    .where(inArray(recetaItems.recetaId, [...new Set(planificadas.map((f) => f.recetaId))]))
    .all();

  const insumoIds = new Set<number>();
  for (const c of consumos) insumoIds.add(c.insumoId);
  for (const i of items) insumoIds.add(i.insumoId);
  if (insumoIds.size === 0) return resultado;

  // Stock fisico y nombre/unidad de cada insumo involucrado.
  const fichas = new Map(
    db
      .select({
        id: articulos.id,
        nombre: articulos.nombre,
        abreviatura: unidadesMedida.abreviatura,
        stock: sql<number>`COALESCE((SELECT SUM(cantidad) FROM movimientos_stock WHERE articulo_id = ${articulos.id}), 0)`.mapWith(Number),
      })
      .from(articulos)
      .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
      .where(inArray(articulos.id, [...insumoIds]))
      .all()
      .map((f) => [f.id, f]),
  );

  // Lo que las tandas EN CURSO van a consumir cuando finalicen.
  const comprometidoFilas = db
    .select({
      insumoId: produccionConsumos.articuloInsumoId,
      cantidad: sql<number>`COALESCE(SUM(COALESCE(${produccionConsumos.cantidadReal}, ${produccionConsumos.cantidadTeorica})), 0)`.mapWith(Number),
    })
    .from(produccionConsumos)
    .innerJoin(ordenesProduccion, eq(ordenesProduccion.id, produccionConsumos.ordenId))
    .where(inArray(ordenesProduccion.estado, ['en_proceso', 'pausada']))
    .groupBy(produccionConsumos.articuloInsumoId)
    .all();
  const comprometido = new Map(comprometidoFilas.map((f) => [f.insumoId, f.cantidad]));

  const consumosPorOrden = new Map<number, Map<number, number>>();
  for (const c of consumos) {
    const m = consumosPorOrden.get(c.ordenId) ?? new Map<number, number>();
    m.set(c.insumoId, (m.get(c.insumoId) ?? 0) + c.cantidad);
    consumosPorOrden.set(c.ordenId, m);
  }
  const itemsPorReceta = new Map<number, { insumoId: number; cantidad: number }[]>();
  for (const i of items) {
    const lista = itemsPorReceta.get(i.recetaId) ?? [];
    lista.push({ insumoId: i.insumoId, cantidad: i.cantidad });
    itemsPorReceta.set(i.recetaId, lista);
  }

  for (const orden of planificadas) {
    const necesita =
      consumosPorOrden.get(orden.id) ??
      new Map(
        (itemsPorReceta.get(orden.recetaId) ?? []).map((i) => [
          i.insumoId,
          i.cantidad * orden.factorEscala,
        ]),
      );
    const faltantes: string[] = [];
    for (const [insumoId, cantidad] of necesita) {
      const ficha = fichas.get(insumoId);
      if (!ficha) continue;
      const disponible = ficha.stock - (comprometido.get(insumoId) ?? 0);
      if (disponible < cantidad) {
        const falta = Math.round((cantidad - disponible) * 1000) / 1000;
        faltantes.push(`${ficha.nombre}: faltan ${falta} ${ficha.abreviatura}`);
      }
    }
    if (faltantes.length > 0) resultado.set(orden.id, faltantes.join(' · '));
  }
  return resultado;
}

/** Listado completo de ordenes, de la planificada mas reciente a la mas vieja. */
export function listarOrdenes(): FilaOrdenProduccion[] {
  const filas = ejecutarSeguro('listar ordenes de produccion', () =>
    obtenerDb()
      .select({
        id: ordenesProduccion.id,
        recetaId: ordenesProduccion.recetaId,
        articuloProducidoId: ordenesProduccion.articuloProducidoId,
        articuloProducidoCodigo: articulos.codigo,
        articuloProducidoNombre: articulos.nombre,
        cantidadPlanificada: ordenesProduccion.cantidadPlanificada,
        unidadAbreviatura: unidadesMedida.abreviatura,
        unidadesPorCaja: articulos.unidadesPorCaja,
        factorEscala: ordenesProduccion.factorEscala,
        estado: ordenesProduccion.estado,
        numeroLote: ordenesProduccion.numeroLote,
        pedidoId: ordenesProduccion.pedidoId,
        clienteId: pedidos.clienteId,
        clienteNombre: clientes.nombre,
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
      .leftJoin(pedidos, eq(pedidos.id, ordenesProduccion.pedidoId))
      .leftJoin(clientes, eq(clientes.id, pedidos.clienteId))
      .leftJoin(produccionConsumos, eq(produccionConsumos.ordenId, ordenesProduccion.id))
      .groupBy(ordenesProduccion.id)
      .orderBy(desc(ordenesProduccion.fechaPlanificada), desc(ordenesProduccion.id))
      .all(),
  );

  const faltantes = ejecutarSeguro('calcular insumos faltantes', () => calcularFaltantes(filas));
  return filas.map((fila) => ({
    ...fila,
    esperaInsumos: faltantes.has(fila.id),
    insumosFaltantes: faltantes.get(fila.id) ?? null,
  }));
}
