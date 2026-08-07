/**
 * Actualizacion masiva de precios y generador de compras.
 *
 * Los dos resuelven la misma clase de problema: cosas que hoy se hacen articulo
 * por articulo y que en una fabrica real se hacen de a decenas. Con inflacion,
 * actualizar precios de a uno no es viable; y saber que falta comprar
 * revisando la lista a ojo tampoco.
 *
 * La actualizacion NUNCA aplica a ciegas: primero devuelve la vista previa con
 * el precio viejo y el nuevo de cada articulo, y recien despues se confirma.
 * Un porcentaje mal tipeado sobre toda la lista es muy caro de revertir.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';

import type {
  EntradaActualizacionPrecios,
  LineaReposicion,
  VistaPreviaPrecio,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { articulos, listasPrecio, lotesPrecio, precios, proveedores } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';

/**
 * Aplica el redondeo comercial pedido. Trabaja en CENTAVOS, por eso los
 * multiplos van por 1000 (=$10), 5000 (=$50) y 10000 (=$100).
 */
function redondearComercial(centavos: number, modo: string): number {
  switch (modo) {
    case 'multiplo_10':
      return Math.ceil(centavos / 1000) * 1000;
    case 'multiplo_50':
      return Math.ceil(centavos / 5000) * 5000;
    case 'multiplo_100':
      return Math.ceil(centavos / 10000) * 10000;
    case 'terminado_99': {
      // Al peso superior terminado en ,99: 1234 -> 1299; 1299 -> 1299.
      const pesos = Math.ceil(centavos / 100);
      return pesos * 100 - 1;
    }
    default:
      return Math.round(centavos);
  }
}

/** Precio resultante segun la regla, antes de redondear. */
function aplicarRegla(actual: number, entrada: EntradaActualizacionPrecios): number {
  switch (entrada.modo) {
    case 'porcentaje':
      return actual * (1 + entrada.valor / 100);
    case 'monto_fijo':
      return actual + entrada.valor;
    case 'valor_exacto':
      return entrada.valor;
    default:
      return actual;
  }
}

/** Precio vigente de un articulo en una lista, o null si no tiene. */
function precioVigente(articuloId: number, listaPrecioId: number): number | null {
  const fila = obtenerDb()
    .select({ precio: precios.precio })
    .from(precios)
    .where(and(eq(precios.articuloId, articuloId), eq(precios.listaPrecioId, listaPrecioId)))
    .orderBy(sql`vigente_desde DESC, id DESC`)
    .limit(1)
    .get();
  return fila?.precio ?? null;
}

/** Texto legible del cambio, para el historial. */
function describirCambio(entrada: EntradaActualizacionPrecios): string {
  const que =
    entrada.modo === 'porcentaje'
      ? `${entrada.valor > 0 ? '+' : ''}${entrada.valor}%`
      : entrada.modo === 'monto_fijo'
        ? `${entrada.valor > 0 ? '+' : ''}$${(entrada.valor / 100).toFixed(2)}`
        : `fijar en $${(entrada.valor / 100).toFixed(2)}`;
  const redondeo =
    entrada.redondeo === undefined || entrada.redondeo === 'ninguno'
      ? ''
      : `, redondeo ${entrada.redondeo.replace('multiplo_', 'a multiplo de $').replace('terminado_99', 'a ,99')}`;
  return `${que} sobre ${entrada.articuloIds.length} articulo(s)${redondeo}`;
}

export const preciosMasivoServicio = {
  /**
   * Que quedaria si se aplicara. No escribe nada: es la pantalla que evita que
   * un 500% mal tipeado se aplique sobre toda la lista.
   */
  vistaPrevia(entrada: EntradaActualizacionPrecios): VistaPreviaPrecio[] {
    if (entrada.articuloIds.length === 0) {
      throw new ErrorValidacion('Elegi al menos un articulo para actualizar.');
    }
    if (!Number.isFinite(entrada.valor)) {
      throw new ErrorValidacion('El valor de la actualizacion no es un numero.');
    }
    if (entrada.modo === 'porcentaje' && entrada.valor <= -100) {
      throw new ErrorValidacion('Un descuento de 100% o mas dejaria los precios en cero o negativos.');
    }

    return ejecutarSeguro('calcular la vista previa de precios', () => {
      const db = obtenerDb();
      const lista = db
        .select({ id: listasPrecio.id, nombre: listasPrecio.nombre })
        .from(listasPrecio)
        .where(eq(listasPrecio.id, entrada.listaPrecioId))
        .get();
      if (!lista) throw new ErrorNoEncontrado('lista de precios', entrada.listaPrecioId);

      const filas = db
        .select({
          id: articulos.id,
          codigo: articulos.codigo,
          nombre: articulos.nombre,
          costoActual: articulos.costoActual,
        })
        .from(articulos)
        .where(inArray(articulos.id, [...entrada.articuloIds]))
        .all();

      return filas.map((a) => {
        // Sobre el costo se actualiza el costo; sobre una lista, su precio.
        const base = entrada.sobreCosto ? (a.costoActual ?? 0) : (precioVigente(a.id, lista.id) ?? 0);
        const calculado = aplicarRegla(base, entrada);
        const nuevo = Math.max(0, redondearComercial(calculado, entrada.redondeo ?? 'ninguno'));
        return {
          articuloId: a.id,
          codigo: a.codigo,
          nombre: a.nombre,
          precioActual: base,
          precioNuevo: nuevo,
          // Sin precio previo no hay variacion que mostrar: es una carga inicial.
          variacionPct: base > 0 ? Number((((nuevo - base) / base) * 100).toFixed(2)) : null,
        };
      });
    });
  },

  /** Aplica lo que mostro la vista previa, en un LOTE que se puede deshacer. */
  aplicar(entrada: EntradaActualizacionPrecios): { actualizados: number; loteId: number | null } {
    const previa = preciosMasivoServicio.vistaPrevia(entrada);

    const resultado = ejecutarSeguro('actualizar los precios', () =>
      obtenerDb().transaction((tx) => {
        const hoy = new Date().toISOString().slice(0, 10);
        let actualizados = 0;

        // El lote agrupa el cambio para poder deshacerlo entero. El costo no
        // lleva lote: no tiene historial de vigencias donde volver.
        const lote = entrada.sobreCosto
          ? null
          : tx
              .insert(lotesPrecio)
              .values({
                fecha: new Date().toISOString(),
                descripcion: describirCambio(entrada),
                cantidadArticulos: previa.length,
              })
              .returning({ id: lotesPrecio.id })
              .all()[0];

        for (const linea of previa) {
          if (linea.precioNuevo === linea.precioActual) continue;

          if (entrada.sobreCosto) {
            tx.update(articulos)
              .set({ costoActual: linea.precioNuevo })
              .where(eq(articulos.id, linea.articuloId))
              .run();
          } else {
            // A diferencia del alta puntual, la actualizacion masiva NO pisa el
            // precio del mismo dia: agrega una fila nueva. Si la pisara, deshacer
            // el lote borraria tambien el precio que habia antes y los precios
            // saltarian al de un dia anterior. Dos filas del mismo dia son
            // correctas: fueron dos cambios reales, y el vigente es el ultimo.
            tx.insert(precios)
              .values({
                listaPrecioId: entrada.listaPrecioId,
                articuloId: linea.articuloId,
                precio: linea.precioNuevo,
                vigenteDesde: hoy,
                loteId: lote?.id ?? null,
              })
              .run();
          }
          actualizados += 1;
        }

        if (lote !== null && lote !== undefined && actualizados !== previa.length) {
          tx.update(lotesPrecio)
            .set({ cantidadArticulos: actualizados })
            .where(eq(lotesPrecio.id, lote.id))
            .run();
        }

        return { actualizados, loteId: lote?.id ?? null };
      }),
    );

    emitir('maestros:cambio');
    return resultado;
  },

  /** Las actualizaciones masivas hechas, de la mas reciente a la mas vieja. */
  listarLotes(): {
    id: number;
    fecha: string;
    descripcion: string;
    cantidadArticulos: number;
    revertido: boolean;
  }[] {
    return ejecutarSeguro('listar los lotes de precios', () =>
      obtenerDb()
        .select()
        .from(lotesPrecio)
        .orderBy(sql`fecha DESC, id DESC`)
        .limit(50)
        .all(),
    );
  },

  /**
   * Deshace una actualizacion masiva: borra los precios que creo, con lo que
   * vuelve a regir el que estaba antes. El lote queda marcado como revertido en
   * vez de borrarse, para que se vea que existio.
   */
  revertirLote(loteId: number): { revertidos: number } {
    const resultado = ejecutarSeguro('revertir la actualizacion de precios', () =>
      obtenerDb().transaction((tx) => {
        const lote = tx.select().from(lotesPrecio).where(eq(lotesPrecio.id, loteId)).get();
        if (!lote) throw new ErrorNoEncontrado('lote de precios', loteId);
        if (lote.revertido) throw new ErrorValidacion('Esa actualizacion ya se habia deshecho.');

        const afectados = tx
          .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
          .from(precios)
          .where(eq(precios.loteId, loteId))
          .get();

        tx.delete(precios).where(eq(precios.loteId, loteId)).run();
        tx.update(lotesPrecio).set({ revertido: true }).where(eq(lotesPrecio.id, loteId)).run();

        return { revertidos: afectados?.n ?? 0 };
      }),
    );
    emitir('maestros:cambio');
    return resultado;
  },

  /**
   * Que falta reponer. Sale de comparar el stock contra el minimo o el ideal.
   *
   * Distingue COMO se repone cada cosa, que no es lo mismo: una materia prima
   * que falta se le compra a un proveedor, pero un alfajor que falta se PRODUCE
   * —no se compra a nadie—. Mezclarlos daba una "orden de compra" con alfajores
   * adentro, que no se le puede mandar a ningun proveedor.
   */
  sugerenciaDeCompra(criterio: 'minimo' | 'ideal'): LineaReposicion[] {
    return ejecutarSeguro('calcular la sugerencia de compra', () => {
      const filas = obtenerDb()
        .select({
          articuloId: articulos.id,
          codigo: articulos.codigo,
          nombre: articulos.nombre,
          unidadAbreviatura: sql<string>`(SELECT abreviatura FROM unidades_medida WHERE id = ${articulos.unidadBaseId})`,
          stockMin: articulos.stockMin,
          stockIdeal: articulos.stockIdeal,
          costoActual: articulos.costoActual,
          proveedorId: articulos.proveedorHabitualId,
          proveedorNombre: proveedores.nombre,
          tipo: articulos.tipo,
          stock: sql<number>`COALESCE((
            SELECT SUM(cantidad) FROM movimientos_stock WHERE articulo_id = ${articulos.id}
          ), 0)`.mapWith(Number),
        })
        .from(articulos)
        .leftJoin(proveedores, eq(proveedores.id, articulos.proveedorHabitualId))
        .where(eq(articulos.activo, true))
        .all();

      return filas
        .map((f) => {
          const objetivo = criterio === 'ideal' ? f.stockIdeal : f.stockMin;
          if (objetivo === null || objetivo <= 0) return null;
          const stock = redondearCantidad(f.stock);
          if (stock >= objetivo) return null;
          const aPedir = redondearCantidad(objetivo - stock);
          return {
            articuloId: f.articuloId,
            codigo: f.codigo,
            nombre: f.nombre,
            // Un producto terminado se repone produciendolo; el resto, comprando.
            comoSeRepone: f.tipo === 'producto_terminado' ? ('producir' as const) : ('comprar' as const),
            unidadAbreviatura: f.unidadAbreviatura,
            stock,
            objetivo,
            aPedir,
            costoUnitario: f.costoActual,
            // Lo que va a salir, para poder decidir antes de mandar la orden.
            costoEstimado: f.costoActual === null ? null : Math.round(f.costoActual * aPedir),
            proveedorId: f.proveedorId,
            proveedorNombre: f.proveedorNombre,
          };
        })
        .filter((l): l is LineaReposicion => l !== null)
        .sort((a, b) => {
          // Primero los que tienen proveedor, agrupados; despues el resto.
          const provA = a.proveedorNombre ?? 'zzz';
          const provB = b.proveedorNombre ?? 'zzz';
          return provA === provB ? a.nombre.localeCompare(b.nombre) : provA.localeCompare(provB);
        });
    });
  },
};
