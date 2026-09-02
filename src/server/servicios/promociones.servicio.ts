/**
 * Promociones (combos).
 *
 * Portado del modulo de StockFlow, con una diferencia de fondo: alla una promo
 * es un articulo ESPEJO con marca PROMO y una tabla propia; aca es una
 * PRESENTACION con precio propio y ventana de vigencia.
 *
 * Por que no se copio la tabla aparte: Alpha ya tiene `presentaciones` +
 * `presentacion_componentes` + `precios_presentacion`, que es exactamente lo
 * mismo que hace `promotions` + `promotion_items` en StockFlow —composicion de
 * articulos que descuentan stock y precio de renglon por lista con historia—
 * pero ademas resuelve las listas derivadas y la vigencia de precios, que alla
 * no existen. Duplicarlo habria dejado dos motores de liquidacion: el dia que
 * se toca uno, el otro queda viejo y nadie se entera hasta que un pedido sale
 * mal facturado.
 *
 * Lo unico que agrega la promo es la ventana de fechas, y el corte por fecha
 * vive en `presentacionesServicio.precioDeRenglon`: es el unico camino por el
 * que pasan talonario, pedido del celular, venta y remito.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';

import type { EntradaPromocion, PromocionVista } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  listasPrecio,
  preciosPresentacion,
  presentacionComponentes,
  presentaciones,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Por que una promo no esta liquidando hoy. Se devuelve el motivo y no un
 * booleano pelado para que la pantalla lo muestre tal cual: "vencio el 30/09"
 * le dice al vendedor que hacer, "no vigente" lo deja adivinando.
 */
function motivoNoVigente(fila: {
  activo: boolean;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}): string | null {
  const hoy = hoyIso();
  if (!fila.activo) return 'Desactivada';
  if (fila.vigenciaDesde !== null && hoy < fila.vigenciaDesde) return `Arranca el ${fila.vigenciaDesde}`;
  if (fila.vigenciaHasta !== null && hoy > fila.vigenciaHasta) return `Vencio el ${fila.vigenciaHasta}`;
  return null;
}

function validarEntrada(entrada: EntradaPromocion): void {
  if (entrada.nombre.trim().length < 2) {
    throw new ErrorValidacion('El nombre de la promocion es obligatorio.');
  }
  if (entrada.codigo.trim() === '') {
    throw new ErrorValidacion('El codigo de la promocion es obligatorio.');
  }
  if (entrada.componentes.length === 0) {
    throw new ErrorValidacion('La promocion necesita al menos un articulo.');
  }
  for (const componente of entrada.componentes) {
    if (!Number.isFinite(componente.unidades) || componente.unidades <= 0) {
      throw new ErrorValidacion('Las unidades de cada articulo tienen que ser mayores a cero.');
    }
  }
  const repetidos = new Set<number>();
  for (const componente of entrada.componentes) {
    if (repetidos.has(componente.articuloId)) {
      throw new ErrorValidacion('Un mismo articulo no puede ir dos veces: sumá las unidades en un renglon.');
    }
    repetidos.add(componente.articuloId);
  }
  if (entrada.precios.length === 0) {
    throw new ErrorValidacion('La promocion necesita precio en al menos una lista.');
  }
  for (const precio of entrada.precios) {
    if (!Number.isInteger(precio.precio) || precio.precio <= 0) {
      throw new ErrorValidacion('El precio de la promocion tiene que ser un entero de centavos mayor a cero.');
    }
  }
  const { vigenciaDesde, vigenciaHasta } = entrada;
  if (
    vigenciaDesde !== undefined &&
    vigenciaDesde !== null &&
    vigenciaHasta !== undefined &&
    vigenciaHasta !== null &&
    vigenciaHasta < vigenciaDesde
  ) {
    throw new ErrorValidacion('La promocion no puede terminar antes de empezar.');
  }
}

/** Reescribe composicion y precios. Se usa en el alta y en la edicion. */
function escribirComposicionYPrecios(tx: Tx, presentacionId: number, entrada: EntradaPromocion): void {
  tx.delete(presentacionComponentes)
    .where(eq(presentacionComponentes.presentacionId, presentacionId))
    .run();
  for (const componente of entrada.componentes) {
    tx.insert(presentacionComponentes)
      .values({
        presentacionId,
        articuloId: componente.articuloId,
        unidades: componente.unidades,
      })
      .run();
  }

  // Los precios se APILAN por vigencia (no se borran): el precio viejo tiene
  // que seguir explicando lo que ya se facturo. Mismo criterio que `precios`.
  const ahora = new Date().toISOString();
  for (const precio of entrada.precios) {
    tx.insert(preciosPresentacion)
      .values({
        presentacionId,
        listaPrecioId: precio.listaPrecioId,
        precio: precio.precio,
        vigenteDesde: ahora,
      })
      .run();
  }
}

export const promocionesServicio = {
  listar(): PromocionVista[] {
    return ejecutarSeguro('listar promociones', () => {
      const db = obtenerDb();
      const filas = db
        .select()
        .from(presentaciones)
        .where(eq(presentaciones.esPromocion, true))
        .orderBy(presentaciones.orden, presentaciones.id)
        .all();
      if (filas.length === 0) return [];

      const ids = filas.map((f) => f.id);
      const componentes = db
        .select({
          presentacionId: presentacionComponentes.presentacionId,
          articuloId: presentacionComponentes.articuloId,
          articuloCodigo: articulos.codigo,
          articuloNombre: articulos.nombre,
          costoActual: articulos.costoActual,
          unidades: presentacionComponentes.unidades,
        })
        .from(presentacionComponentes)
        .innerJoin(articulos, eq(articulos.id, presentacionComponentes.articuloId))
        .where(inArray(presentacionComponentes.presentacionId, ids))
        .all();

      // Precio VIGENTE por lista: el mas reciente de cada (promo, lista).
      const listas = db.select().from(listasPrecio).all();
      const preciosFilas = db
        .select()
        .from(preciosPresentacion)
        .where(inArray(preciosPresentacion.presentacionId, ids))
        .orderBy(desc(preciosPresentacion.vigenteDesde), desc(preciosPresentacion.id))
        .all();

      return filas.map((fila) => {
        const propios = componentes.filter((c) => c.presentacionId === fila.id);
        const vistos = new Set<number>();
        const precios: PromocionVista['precios'] = [];
        for (const precio of preciosFilas) {
          if (precio.presentacionId !== fila.id || vistos.has(precio.listaPrecioId)) continue;
          vistos.add(precio.listaPrecioId);
          precios.push({
            listaPrecioId: precio.listaPrecioId,
            listaNombre: listas.find((l) => l.id === precio.listaPrecioId)?.nombre ?? '—',
            precio: precio.precio,
          });
        }
        const motivo = motivoNoVigente(fila);
        return {
          id: fila.id,
          codigo: fila.codigo,
          nombre: fila.nombre,
          precioPropio: fila.precioPropio,
          activo: fila.activo,
          orden: fila.orden,
          componentes: propios.map((c) => ({
            articuloId: c.articuloId,
            articuloCodigo: c.articuloCodigo,
            articuloNombre: c.articuloNombre,
            unidades: c.unidades,
          })),
          unidadesTotales: propios.reduce((suma, c) => suma + c.unidades, 0),
          esPromocion: true,
          vigenciaDesde: fila.vigenciaDesde,
          vigenciaHasta: fila.vigenciaHasta,
          vigenteHoy: motivo === null,
          motivoNoVigente: motivo,
          precios,
          costoComponentes: propios.reduce(
            (suma, c) => suma + Math.round((c.costoActual ?? 0) * c.unidades),
            0,
          ),
        };
      });
    });
  },

  crear(entrada: EntradaPromocion): { id: number } {
    validarEntrada(entrada);
    const resultado = ejecutarSeguro('crear una promocion', () =>
      obtenerDb().transaction((tx) => {
        const codigo = entrada.codigo.trim().toUpperCase();
        const repetido = tx
          .select({ id: presentaciones.id })
          .from(presentaciones)
          .where(eq(presentaciones.codigo, codigo))
          .get();
        if (repetido) {
          throw new ErrorValidacion(`Ya existe una presentacion o promocion con el codigo ${codigo}.`);
        }
        const fila = tx
          .insert(presentaciones)
          .values({
            nombre: entrada.nombre.trim(),
            codigo,
            // Una promo SIEMPRE tiene precio propio: el suyo, no la suma de
            // sus partes. Si valiera la suma no seria una promo.
            precioPropio: true,
            activo: entrada.activo ?? true,
            orden: 0,
            esPromocion: true,
            vigenciaDesde: entrada.vigenciaDesde ?? null,
            vigenciaHasta: entrada.vigenciaHasta ?? null,
          })
          .returning({ id: presentaciones.id })
          .all()[0];
        if (!fila) throw new ErrorValidacion('La base no devolvio la promocion insertada.');
        escribirComposicionYPrecios(tx, fila.id, entrada);
        return { id: fila.id };
      }),
    );
    emitir('promociones:cambio');
    return resultado;
  },

  actualizar(id: number, entrada: EntradaPromocion): { id: number } {
    validarEntrada(entrada);
    const resultado = ejecutarSeguro('actualizar una promocion', () =>
      obtenerDb().transaction((tx) => {
        const actual = tx
          .select()
          .from(presentaciones)
          .where(and(eq(presentaciones.id, id), eq(presentaciones.esPromocion, true)))
          .get();
        if (!actual) throw new ErrorNoEncontrado('promocion', id);

        const codigo = entrada.codigo.trim().toUpperCase();
        const repetido = tx
          .select({ id: presentaciones.id })
          .from(presentaciones)
          .where(eq(presentaciones.codigo, codigo))
          .get();
        if (repetido && repetido.id !== id) {
          throw new ErrorValidacion(`Ya existe una presentacion o promocion con el codigo ${codigo}.`);
        }

        tx.update(presentaciones)
          .set({
            nombre: entrada.nombre.trim(),
            codigo,
            activo: entrada.activo ?? actual.activo,
            vigenciaDesde: entrada.vigenciaDesde ?? null,
            vigenciaHasta: entrada.vigenciaHasta ?? null,
          })
          .where(eq(presentaciones.id, id))
          .run();
        escribirComposicionYPrecios(tx, id, entrada);
        return { id };
      }),
    );
    emitir('promociones:cambio');
    return resultado;
  },

  /**
   * Activar/desactivar. Desactivar NO borra: la promo deja de liquidar y de
   * aparecer en el talonario, pero lo que ya se vendio con ella se sigue
   * explicando.
   */
  cambiarActivo(id: number, activo: boolean): { id: number; activo: boolean } {
    const resultado = ejecutarSeguro('activar o desactivar una promocion', () =>
      obtenerDb().transaction((tx) => {
        const actual = tx
          .select({ id: presentaciones.id })
          .from(presentaciones)
          .where(and(eq(presentaciones.id, id), eq(presentaciones.esPromocion, true)))
          .get();
        if (!actual) throw new ErrorNoEncontrado('promocion', id);
        tx.update(presentaciones).set({ activo }).where(eq(presentaciones.id, id)).run();
        return { id, activo };
      }),
    );
    emitir('promociones:cambio');
    return resultado;
  },
};
