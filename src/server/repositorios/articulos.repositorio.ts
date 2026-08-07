/**
 * Repositorio de articulos.
 *
 * Es una de las dos unicas capas que conoce Drizzle y el schema (la otra son los
 * demas repositorios). No contiene reglas de negocio: no decide que es "bajo
 * minimo" ni que tipos forman un grupo, solo sabe leer filas y agregar el ledger.
 *
 * Punto clave de arquitectura: `articulos` NO tiene columna `stock`. El saldo se
 * resuelve siempre con un LEFT JOIN contra `movimientos_stock` + GROUP BY, en una
 * sola consulta. El LEFT (y no INNER) es deliberado: un articulo recien creado,
 * sin ningun movimiento, debe aparecer con stock 0 y no desaparecer del listado.
 */

import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import {
  articulos,
  movimientosStock,
  unidadesMedida,
  type Articulo,
  type TipoArticulo,
} from '../db/schema';
import { ejecutarSeguro } from '../dominio/errores';
import { redondearCantidad } from '../utiles/numeros';

/** Filtros de datos puros: el mapeo grupo -> tipos lo resuelve el servicio. */
export interface FiltrosArticulos {
  soloActivos?: boolean;
  tipos?: readonly TipoArticulo[];
}

/**
 * Fila cruda de articulo con su saldo agregado. No incluye `bajoMinimo` porque
 * eso es una regla de negocio y vive en el servicio, no en la capa de datos.
 */
export interface FilaArticuloConStock {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadBaseId: number;
  unidadAbreviatura: string;
  stockMin: number | null;
  stockIdeal: number | null;
  codigoBarras: string | null;
  marca: string | null;
  familiaId: number | null;
  familiaNombre: string | null;
  proveedorHabitualId: number | null;
  proveedorHabitualNombre: string | null;
  alicuotaIva: number;
  porPeso: boolean;
  notas: string | null;
  unidadesPorCaja: number | null;
  costoActual: number | null;
  activo: boolean;
  stock: number;
}

/**
 * Proyeccion compartida por los listados con stock.
 *
 * `COALESCE(SUM(...), 0)` cubre el caso del LEFT JOIN sin coincidencias, y
 * `.mapWith(Number)` evita que SQLite devuelva el agregado como string o null
 * inesperado segun el driver.
 */
const COLUMNAS_CON_STOCK = {
  id: articulos.id,
  codigo: articulos.codigo,
  nombre: articulos.nombre,
  tipo: articulos.tipo,
  unidadBaseId: articulos.unidadBaseId,
  unidadAbreviatura: unidadesMedida.abreviatura,
  stockMin: articulos.stockMin,
  stockIdeal: articulos.stockIdeal,
  codigoBarras: articulos.codigoBarras,
  marca: articulos.marca,
  familiaId: articulos.familiaId,
  // Familia y proveedor por subconsulta: son opcionales y sumar dos LEFT JOIN
  // mas al agregado del ledger complica la lectura sin ganar nada medible.
  familiaNombre: sql<string | null>`(SELECT nombre FROM familias WHERE id = ${articulos.familiaId})`,
  proveedorHabitualId: articulos.proveedorHabitualId,
  proveedorHabitualNombre: sql<string | null>`(SELECT nombre FROM proveedores WHERE id = ${articulos.proveedorHabitualId})`,
  alicuotaIva: articulos.alicuotaIva,
  porPeso: articulos.porPeso,
  notas: articulos.notas,
  unidadesPorCaja: articulos.unidadesPorCaja,
  costoActual: articulos.costoActual,
  activo: articulos.activo,
  stock: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number),
};

/**
 * Normaliza el saldo agregado: la suma de REALs acumula drift binario
 * (0.1 + 0.2 = 0.30000000000000004), asi que se redondea al salir de la base.
 */
function normalizarFila(fila: FilaArticuloConStock): FilaArticuloConStock {
  return { ...fila, stock: redondearCantidad(fila.stock) };
}

/** Consulta base con los dos JOIN: unidad (obligatoria) y ledger (opcional). */
function consultaConStock(condicion: SQL | undefined) {
  return obtenerDb()
    .select(COLUMNAS_CON_STOCK)
    .from(articulos)
    .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
    .leftJoin(movimientosStock, eq(movimientosStock.articuloId, articulos.id))
    .where(condicion)
    .groupBy(articulos.id)
    .orderBy(asc(articulos.nombre))
    .all();
}

/** Devuelve el articulo o `undefined`. El 404 lo decide el servicio. */
export function buscarPorId(id: number): Articulo | undefined {
  return ejecutarSeguro('buscar articulo por id', () =>
    obtenerDb().select().from(articulos).where(eq(articulos.id, id)).limit(1).all()[0],
  );
}

/** Devuelve el articulo por su codigo unico de negocio, o `undefined`. */
export function buscarPorCodigo(codigo: string): Articulo | undefined {
  return ejecutarSeguro('buscar articulo por codigo', () =>
    obtenerDb().select().from(articulos).where(eq(articulos.codigo, codigo)).limit(1).all()[0],
  );
}

/** Chequeo de existencia sin traer la fila entera (lo usa el ledger antes de insertar). */
export function existe(id: number): boolean {
  return ejecutarSeguro('verificar existencia de articulo', () => {
    const filas = obtenerDb()
      .select({ existe: sql<number>`1`.mapWith(Number) })
      .from(articulos)
      .where(eq(articulos.id, id))
      .limit(1)
      .all();
    return filas.length > 0;
  });
}

/**
 * Listado de articulos con su saldo de stock resuelto en UNA sola consulta.
 * Nunca hace N+1: el saldo llega agregado desde SQL junto con la fila.
 */
export function listarConStock(opciones: FiltrosArticulos = {}): FilaArticuloConStock[] {
  return ejecutarSeguro('listar articulos con stock', () => {
    const { soloActivos, tipos } = opciones;

    // Un filtro de tipos vacio significa "ningun tipo": se resuelve sin ir a la base.
    if (tipos && tipos.length === 0) return [];

    const condiciones: SQL[] = [];
    if (soloActivos === true) condiciones.push(eq(articulos.activo, true));
    if (tipos && tipos.length > 0) condiciones.push(inArray(articulos.tipo, [...tipos]));

    return consultaConStock(and(...condiciones)).map(normalizarFila);
  });
}

/** Misma proyeccion que el listado, para un unico articulo. `undefined` si no existe. */
export function obtenerConStockPorId(id: number): FilaArticuloConStock | undefined {
  return ejecutarSeguro('obtener articulo con stock por id', () => {
    const fila = consultaConStock(eq(articulos.id, id))[0];
    return fila ? normalizarFila(fila) : undefined;
  });
}
