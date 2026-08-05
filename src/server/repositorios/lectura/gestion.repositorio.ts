/**
 * Repositorio de LECTURA de los modulos de gestion: caja general, estadisticas
 * y usuarios.
 *
 * Todo se resuelve con agregados en SQL. La valorizacion del inventario merece
 * una nota: el stock negativo se pisa en CERO antes de multiplicar por el costo.
 * Valorizar en negativo produce un activo negativo, que no significa nada
 * contablemente y ensucia cualquier reporte que lo consuma.
 */

import { asc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  cajaMovimientos,
  cajas,
  compras,
  movimientosStock,
  usuarios,
  ventaItems,
  ventas,
  type RolUsuario,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/* ------------------------------ Caja general ------------------------------ */

export interface FilaResumenCajaGeneral {
  totalCajas: number;
  cajasAbiertas: number;
  cajasCerradas: number;
  totalAperturas: number;
  totalIngresos: number;
  totalEgresos: number;
  diferenciaAcumulada: number;
}

export function resumirCajaGeneral(): FilaResumenCajaGeneral {
  return ejecutarSeguro('resumir la caja general', () => {
    const db = obtenerDb();

    const porCaja = db
      .select({
        total: sql<number>`COUNT(*)`.mapWith(Number),
        abiertas: sql<number>`SUM(CASE WHEN ${cajas.estado} = 'abierta' THEN 1 ELSE 0 END)`.mapWith(Number),
        aperturas: sql<number>`COALESCE(SUM(${cajas.montoApertura}), 0)`.mapWith(Number),
        diferencias: sql<number>`COALESCE(SUM(COALESCE(${cajas.diferencia}, 0)), 0)`.mapWith(Number),
      })
      .from(cajas)
      .get();

    const porMovimiento = db
      .select({
        ingresos: sql<number>`COALESCE(SUM(CASE WHEN ${cajaMovimientos.tipo} = 'ingreso' THEN ${cajaMovimientos.monto} ELSE 0 END), 0)`.mapWith(Number),
        egresos: sql<number>`COALESCE(SUM(CASE WHEN ${cajaMovimientos.tipo} = 'egreso' THEN ${cajaMovimientos.monto} ELSE 0 END), 0)`.mapWith(Number),
      })
      .from(cajaMovimientos)
      .get();

    const total = porCaja?.total ?? 0;
    const abiertas = porCaja?.abiertas ?? 0;

    return {
      totalCajas: total,
      cajasAbiertas: abiertas,
      cajasCerradas: total - abiertas,
      totalAperturas: porCaja?.aperturas ?? 0,
      totalIngresos: porMovimiento?.ingresos ?? 0,
      totalEgresos: porMovimiento?.egresos ?? 0,
      diferenciaAcumulada: porCaja?.diferencias ?? 0,
    };
  });
}

/* ------------------------------- Estadisticas ----------------------------- */

export interface FilaPeriodo {
  mes: string;
  cantidad: number;
  total: number;
}

/** Ventas no anuladas agrupadas por mes calendario, de la mas vieja a la mas nueva. */
export function ventasPorMes(meses: number): FilaPeriodo[] {
  return ejecutarSeguro('agrupar ventas por mes', () =>
    obtenerDb()
      .select({
        mes: sql<string>`strftime('%Y-%m', ${ventas.fecha})`,
        cantidad: sql<number>`COUNT(*)`.mapWith(Number),
        total: sql<number>`COALESCE(SUM(${ventas.total}), 0)`.mapWith(Number),
      })
      .from(ventas)
      .where(sql`${ventas.estado} <> 'anulada'`)
      .groupBy(sql`strftime('%Y-%m', ${ventas.fecha})`)
      .orderBy(sql`strftime('%Y-%m', ${ventas.fecha}) DESC`)
      .limit(meses)
      .all()
      .reverse(),
  );
}

export function comprasPorMes(meses: number): FilaPeriodo[] {
  return ejecutarSeguro('agrupar compras por mes', () =>
    obtenerDb()
      .select({
        mes: sql<string>`strftime('%Y-%m', ${compras.fecha})`,
        cantidad: sql<number>`COUNT(*)`.mapWith(Number),
        total: sql<number>`COALESCE(SUM(${compras.total}), 0)`.mapWith(Number),
      })
      .from(compras)
      .groupBy(sql`strftime('%Y-%m', ${compras.fecha})`)
      .orderBy(sql`strftime('%Y-%m', ${compras.fecha}) DESC`)
      .limit(meses)
      .all()
      .reverse(),
  );
}

export interface FilaArticuloVendido {
  articuloId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  total: number;
}

/** Ranking de articulos por unidades vendidas, sobre ventas no anuladas. */
export function articulosMasVendidos(limite: number): FilaArticuloVendido[] {
  return ejecutarSeguro('calcular los articulos mas vendidos', () =>
    obtenerDb()
      .select({
        articuloId: articulos.id,
        codigo: articulos.codigo,
        nombre: articulos.nombre,
        cantidad: sql<number>`COALESCE(SUM(${ventaItems.cantidad}), 0)`.mapWith(Number),
        total: sql<number>`COALESCE(SUM(${ventaItems.subtotal}), 0)`.mapWith(Number),
      })
      .from(ventaItems)
      .innerJoin(ventas, eq(ventas.id, ventaItems.ventaId))
      .innerJoin(articulos, eq(articulos.id, ventaItems.articuloId))
      .where(sql`${ventas.estado} <> 'anulada'`)
      .groupBy(articulos.id)
      .orderBy(sql`SUM(${ventaItems.cantidad}) DESC`)
      .limit(limite)
      .all(),
  );
}

export interface FilaValorizacion {
  insumos: number;
  productos: number;
}

/**
 * Valorizacion del inventario: stock x costo actual. El stock negativo se pisa
 * en cero (MAX(stock, 0)): un activo negativo no significa nada.
 */
export function valorizarInventario(): FilaValorizacion {
  return ejecutarSeguro('valorizar el inventario', () => {
    const filas = obtenerDb()
      .select({
        tipo: articulos.tipo,
        costo: articulos.costoActual,
        stock: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number),
      })
      .from(articulos)
      .leftJoin(movimientosStock, eq(movimientosStock.articuloId, articulos.id))
      .where(eq(articulos.activo, true))
      .groupBy(articulos.id)
      .all();

    let insumos = 0;
    let productos = 0;
    for (const fila of filas) {
      if (fila.costo === null) continue;
      const valor = Math.round(Math.max(fila.stock, 0) * fila.costo);
      if (fila.tipo === 'producto_terminado') productos += valor;
      else insumos += valor;
    }
    return { insumos, productos };
  });
}

/* --------------------------------- Usuarios -------------------------------- */

export interface FilaUsuario {
  id: number;
  username: string;
  rol: RolUsuario;
  activo: boolean;
}

/** Usuarios del sistema. El hash de contrasena NUNCA sale del servidor. */
export function listarUsuarios(): FilaUsuario[] {
  return ejecutarSeguro('listar usuarios', () =>
    obtenerDb()
      .select({
        id: usuarios.id,
        username: usuarios.username,
        rol: usuarios.rol,
        activo: usuarios.activo,
      })
      .from(usuarios)
      .orderBy(asc(usuarios.username))
      .all(),
  );
}
