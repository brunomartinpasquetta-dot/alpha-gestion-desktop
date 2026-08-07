/**
 * Tipos del dominio, independientes de Drizzle y de HTTP.
 *
 * Existen porque los conceptos que maneja el negocio no coinciden 1:1 con las
 * filas de la base: el stock de un articulo NO es una columna, es el resultado
 * de agregar el ledger `movimientos_stock`. Estos tipos representan esas
 * proyecciones derivadas para que servicios y rutas hablen el mismo idioma.
 */

import type { TipoEntidadCc, TipoDocumentoStock } from '../db/schema';

/**
 * Las proyecciones que VIAJAN al renderer se definen una sola vez, en el
 * contrato compartido, y se reexportan aca. Tenerlas duplicadas hacia que
 * agregar un campo compilara de un lado y fallara del otro, o peor: que el
 * servidor lo devolviera y el renderer no supiera que existe.
 */
export type {
  ArticuloConStock,
  GrupoStock,
  SaldoStock,
} from '../../compartido/contratos';

import type { GrupoStock, TipoArticulo } from '../../compartido/contratos';

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
