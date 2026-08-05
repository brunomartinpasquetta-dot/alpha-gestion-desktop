/**
 * Tipos del dominio, independientes de Drizzle y de HTTP.
 *
 * Existen porque los conceptos que maneja el negocio no coinciden 1:1 con las
 * filas de la base: el stock de un articulo NO es una columna, es el resultado
 * de agregar el ledger `movimientos_stock`. Estos tipos representan esas
 * proyecciones derivadas para que servicios y rutas hablen el mismo idioma.
 */

import type { TipoArticulo, TipoEntidadCc, TipoDocumentoStock } from '../db/schema';

/** Agrupación derivada del campo `tipo` del artículo. */
export type GrupoStock = 'insumos' | 'productos';

/** Saldo de stock de un artículo, calculado desde el ledger. */
export interface SaldoStock {
  articuloId: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadAbreviatura: string;
  stock: number;
  stockMin: number | null;
  /** Unidades por caja cerrada. null = no se comercializa por caja. */
  unidadesPorCaja: number | null;
  bajoMinimo: boolean;
}

/** Artículo con su saldo de stock resuelto, para listados. */
export interface ArticuloConStock {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadBaseId: number;
  unidadAbreviatura: string;
  stockMin: number | null;
  unidadesPorCaja: number | null;
  costoActual: number | null;
  activo: boolean;
  stock: number;
  bajoMinimo: boolean;
}

/** Documento que origina un movimiento de stock. */
export interface ReferenciaDocumento {
  tipo: TipoDocumentoStock;
  id: number | null;
}

/** Saldo de cuenta corriente de una entidad. */
export interface SaldoCuentaCorriente {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  debe: number; // centavos
  haber: number; // centavos
  saldo: number; // centavos, debe - haber (puede ser negativo)
}

/**
 * Tipos de artículo que integran cada grupo de stock.
 *
 * Es el UNICO lugar donde vive la equivalencia grupo -> tipos. La pantalla
 * "Stock de Insumos" y la de "Stock de Productos" son vistas derivadas de la
 * misma tabla `articulos`: si mañana aparece un tipo nuevo, se agrega acá y
 * ninguna consulta necesita cambiar.
 */
export const TIPOS_POR_GRUPO: Readonly<Record<GrupoStock, readonly TipoArticulo[]>> = {
  insumos: ['materia_prima', 'pre_elaborado'],
  productos: ['producto_terminado'],
};

/** Grupos de stock validos, para validar entrada externa sin repetir literales. */
export const GRUPOS_STOCK = ['insumos', 'productos'] as const;

/** Type guard para validar un `grupo` recibido desde afuera del dominio. */
export function esGrupoStock(valor: unknown): valor is GrupoStock {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(TIPOS_POR_GRUPO, valor);
}

/**
 * Regla unica de "bajo minimo": sin `stockMin` definido no hay minimo que violar.
 * Se centraliza para que listados, detalle y alertas no diverjan.
 */
export function estaBajoMinimo(stock: number, stockMin: number | null): boolean {
  return stockMin !== null && stock < stockMin;
}
