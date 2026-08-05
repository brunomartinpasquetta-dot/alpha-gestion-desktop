/**
 * Repositorio de LECTURA del tablero de inicio.
 *
 * Cada indicador es un COUNT o un SUM agregado en SQL. Se resuelven en consultas
 * chicas e independientes en vez de un unico monstruo con subselects: es mas
 * legible, y en SQLite local el costo de varias consultas indexadas es
 * despreciable frente al de mantener ese SQL.
 *
 * Los indicadores "del mes" usan el mes calendario en curso segun el reloj de la
 * base (`strftime('%Y-%m','now')`), asi el corte no depende de la zona horaria
 * del proceso.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  cajaMovimientos,
  cajas,
  compras,
  movimientosStock,
  ordenesProduccion,
  pedidos,
  ventas,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Mismo mes calendario que "ahora", evaluado por la base. */
const ES_MES_EN_CURSO = (columnaFecha: ReturnType<typeof sql>) =>
  sql`strftime('%Y-%m', ${columnaFecha}) = strftime('%Y-%m','now')`;

export interface ConteosArticulos {
  total: number;
  insumos: number;
  productos: number;
  bajoMinimo: number;
}

export interface CajaAbiertaResumen {
  cajaId: number;
  saldoEstimado: number;
}

/**
 * Conteos del maestro de articulos. `bajoMinimo` compara el saldo del ledger
 * contra `stock_min`, asi que necesita el LEFT JOIN agregado: es la misma
 * definicion de stock que usa el resto del sistema, no un campo guardado.
 */
export function contarArticulos(): ConteosArticulos {
  return ejecutarSeguro('contar articulos para el resumen', () => {
    const filas = obtenerDb()
      .select({
        tipo: articulos.tipo,
        stockMin: articulos.stockMin,
        stock: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number),
      })
      .from(articulos)
      .leftJoin(movimientosStock, eq(movimientosStock.articuloId, articulos.id))
      .where(eq(articulos.activo, true))
      .groupBy(articulos.id)
      .all();

    let insumos = 0;
    let productos = 0;
    let bajoMinimo = 0;
    for (const fila of filas) {
      if (fila.tipo === 'producto_terminado') productos += 1;
      else insumos += 1;
      if (fila.stockMin !== null && fila.stock < fila.stockMin) bajoMinimo += 1;
    }
    return { total: filas.length, insumos, productos, bajoMinimo };
  });
}

/** Cantidad de pedidos por estado, solo los estados que interesan al tablero. */
export function contarPedidosPorEstado(): { pendientes: number; enProduccion: number; listos: number } {
  return ejecutarSeguro('contar pedidos por estado', () => {
    const filas = obtenerDb()
      .select({ estado: pedidos.estado, cantidad: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(pedidos)
      .groupBy(pedidos.estado)
      .all();

    const porEstado = new Map(filas.map((f) => [f.estado, f.cantidad]));
    return {
      pendientes: porEstado.get('pendiente') ?? 0,
      enProduccion: porEstado.get('en_produccion') ?? 0,
      listos: porEstado.get('listo') ?? 0,
    };
  });
}

/** Cantidad de ordenes de produccion abiertas, por estado. */
export function contarOrdenesPorEstado(): { planificadas: number; enProceso: number } {
  return ejecutarSeguro('contar ordenes de produccion', () => {
    const filas = obtenerDb()
      .select({
        estado: ordenesProduccion.estado,
        cantidad: sql<number>`COUNT(*)`.mapWith(Number),
      })
      .from(ordenesProduccion)
      .groupBy(ordenesProduccion.estado)
      .all();

    const porEstado = new Map(filas.map((f) => [f.estado, f.cantidad]));
    return {
      planificadas: porEstado.get('planificada') ?? 0,
      enProceso: porEstado.get('en_proceso') ?? 0,
    };
  });
}

/** Compras pendientes de recibir y total comprado en el mes en curso (centavos). */
export function resumirCompras(): { pendientes: number; totalMes: number } {
  return ejecutarSeguro('resumir compras', () => {
    const db = obtenerDb();
    const pendientes =
      db
        .select({ cantidad: sql<number>`COUNT(*)`.mapWith(Number) })
        .from(compras)
        .where(eq(compras.estado, 'pendiente'))
        .get()?.cantidad ?? 0;

    const totalMes =
      db
        .select({ total: sql<number>`COALESCE(SUM(${compras.total}), 0)`.mapWith(Number) })
        .from(compras)
        .where(ES_MES_EN_CURSO(sql`${compras.fecha}`))
        .get()?.total ?? 0;

    return { pendientes, totalMes };
  });
}

/** Cantidad y total de ventas no anuladas del mes en curso (centavos). */
export function resumirVentas(): { cantidadMes: number; totalMes: number } {
  return ejecutarSeguro('resumir ventas', () => {
    const fila = obtenerDb()
      .select({
        cantidad: sql<number>`COUNT(*)`.mapWith(Number),
        total: sql<number>`COALESCE(SUM(${ventas.total}), 0)`.mapWith(Number),
      })
      .from(ventas)
      .where(and(ES_MES_EN_CURSO(sql`${ventas.fecha}`), sql`${ventas.estado} <> 'anulada'`))
      .get();

    return { cantidadMes: fila?.cantidad ?? 0, totalMes: fila?.total ?? 0 };
  });
}

/**
 * Caja abierta y su saldo estimado: monto de apertura + ingresos - egresos.
 * Devuelve null si no hay ninguna caja abierta.
 */
export function resumirCajaAbierta(): CajaAbiertaResumen | null {
  return ejecutarSeguro('resumir la caja abierta', () => {
    const db = obtenerDb();
    const caja = db
      .select({ id: cajas.id, montoApertura: cajas.montoApertura })
      .from(cajas)
      .where(and(eq(cajas.estado, 'abierta'), isNull(cajas.fechaCierre)))
      .orderBy(sql`${cajas.fechaApertura} DESC`)
      .get();

    if (!caja) return null;

    const neto =
      db
        .select({
          neto: sql<number>`COALESCE(SUM(
            CASE WHEN ${cajaMovimientos.tipo} = 'ingreso' THEN ${cajaMovimientos.monto}
                 ELSE -${cajaMovimientos.monto} END
          ), 0)`.mapWith(Number),
        })
        .from(cajaMovimientos)
        .where(eq(cajaMovimientos.cajaId, caja.id))
        .get()?.neto ?? 0;

    return { cajaId: caja.id, saldoEstimado: caja.montoApertura + neto };
  });
}
