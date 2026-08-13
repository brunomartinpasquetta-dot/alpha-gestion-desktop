/**
 * Presentaciones y resolucion de precios de la capa comercial.
 *
 * La regla de liquidacion viene del negocio real (Anyulin) y queda como
 * SISTEMA, no como formula copiada:
 *
 *  1. Presentacion SIN precio propio: el renglon vale unidades x precio
 *     unitario del articulo en la lista del cliente. Para una surtida, la suma
 *     de sus componentes (cada uno a su precio unitario), que en el caso real
 *     da igual que "36 x precio" porque las variedades comparten precio — pero
 *     el sistema soporta que algun dia no lo compartan.
 *  2. Presentacion CON precio propio (cubanitos, almendras, envase): el precio
 *     sale de su propia tabla por lista, con vigencia historica.
 *  3. Lista DERIVADA (Lista 1 + 20%): se resuelve el precio en la lista base y
 *     se aplica el recargo. Cambia la base, cambia la derivada sola.
 */

import { desc, eq } from 'drizzle-orm';

import type { PresentacionVista } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  listasPrecio,
  precios,
  preciosPresentacion,
  presentacionComponentes,
  presentaciones,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorReglaNegocio } from '../dominio/errores';

/** Precio unitario VIGENTE de un articulo en una lista: el mas reciente. */
function precioUnitarioEnLista(articuloId: number, listaId: number): number | null {
  const filas = obtenerDb()
    .select({ precio: precios.precio, listaPrecioId: precios.listaPrecioId })
    .from(precios)
    .where(eq(precios.articuloId, articuloId))
    .orderBy(desc(precios.vigenteDesde), desc(precios.id))
    .all();
  return filas.find((fila) => fila.listaPrecioId === listaId)?.precio ?? null;
}

/** Resuelve la lista efectiva: si es derivada devuelve la base + recargo. */
function resolverLista(listaId: number): { listaEfectivaId: number; factor: number } {
  const lista = obtenerDb().select().from(listasPrecio).where(eq(listasPrecio.id, listaId)).get();
  if (!lista) throw new ErrorNoEncontrado('lista de precios', listaId);
  if (lista.baseListaId !== null && lista.recargoPct !== null) {
    return { listaEfectivaId: lista.baseListaId, factor: 1 + lista.recargoPct / 100 };
  }
  return { listaEfectivaId: listaId, factor: 1 };
}

export const presentacionesServicio = {
  /** Catalogo activo con componentes, para armar el talonario. */
  listar(): PresentacionVista[] {
    return ejecutarSeguro('listar presentaciones', () => {
      const db = obtenerDb();
      const filas = db
        .select()
        .from(presentaciones)
        .orderBy(presentaciones.orden, presentaciones.id)
        .all();
      const componentes = db
        .select({
          presentacionId: presentacionComponentes.presentacionId,
          articuloId: presentacionComponentes.articuloId,
          articuloCodigo: articulos.codigo,
          articuloNombre: articulos.nombre,
          unidades: presentacionComponentes.unidades,
        })
        .from(presentacionComponentes)
        .innerJoin(articulos, eq(articulos.id, presentacionComponentes.articuloId))
        .all();
      return filas.map((fila) => ({
        id: fila.id,
        codigo: fila.codigo,
        nombre: fila.nombre,
        precioPropio: fila.precioPropio,
        activo: fila.activo,
        orden: fila.orden,
        componentes: componentes
          .filter((c) => c.presentacionId === fila.id)
          .map((c) => ({
            articuloId: c.articuloId,
            articuloCodigo: c.articuloCodigo,
            articuloNombre: c.articuloNombre,
            unidades: c.unidades,
          })),
        unidadesTotales: componentes
          .filter((c) => c.presentacionId === fila.id)
          .reduce((suma, c) => suma + c.unidades, 0),
      }));
    });
  },

  /**
   * Precio del renglon: UNA presentacion en UNA lista, en centavos.
   * Es la unica fuente de verdad de la liquidacion: talonario, venta y
   * remito llaman aca, nunca calculan por su cuenta.
   */
  precioDeRenglon(presentacionId: number, listaId: number): number {
    return ejecutarSeguro('resolver el precio de una presentacion', () => {
      const db = obtenerDb();
      const presentacion = db
        .select()
        .from(presentaciones)
        .where(eq(presentaciones.id, presentacionId))
        .get();
      if (!presentacion) throw new ErrorNoEncontrado('presentacion', presentacionId);

      const { listaEfectivaId, factor } = resolverLista(listaId);

      if (presentacion.precioPropio) {
        const filas = db
          .select()
          .from(preciosPresentacion)
          .where(eq(preciosPresentacion.presentacionId, presentacionId))
          .orderBy(desc(preciosPresentacion.vigenteDesde), desc(preciosPresentacion.id))
          .all();
        const vigente = filas.find((p) => p.listaPrecioId === listaEfectivaId);
        if (!vigente) {
          throw new ErrorReglaNegocio(
            `${presentacion.nombre} no tiene precio cargado en esa lista. Cargalo en Listas de precio.`,
          );
        }
        return Math.round(vigente.precio * factor);
      }

      // Sin precio propio: suma de componentes a precio unitario de la lista.
      const componentes = db
        .select()
        .from(presentacionComponentes)
        .where(eq(presentacionComponentes.presentacionId, presentacionId))
        .all();
      if (componentes.length === 0) {
        throw new ErrorReglaNegocio(`${presentacion.nombre} no tiene composicion cargada.`);
      }
      let total = 0;
      for (const componente of componentes) {
        const unitario = precioUnitarioEnLista(componente.articuloId, listaEfectivaId);
        if (unitario === null) {
          const articulo = db
            .select({ nombre: articulos.nombre })
            .from(articulos)
            .where(eq(articulos.id, componente.articuloId))
            .get();
          throw new ErrorReglaNegocio(
            `${articulo?.nombre ?? 'un componente'} no tiene precio en esa lista: no se puede liquidar ${presentacion.nombre}.`,
          );
        }
        total += Math.round(unitario * componente.unidades);
      }
      return Math.round(total * factor);
    });
  },
};
