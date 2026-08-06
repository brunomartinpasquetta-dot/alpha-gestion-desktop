/**
 * Ajustes manuales de stock y ABM de recetas y listas de precio.
 *
 * AJUSTES. Son la valvula de escape del ledger: roturas, mermas, recuentos y la
 * carga inicial del stock real. No se edita ningun saldo —eso rompería la
 * premisa del sistema— sino que se asienta un movimiento con su motivo. Por eso
 * el motivo es obligatorio: un ajuste sin explicacion es un agujero contable.
 *
 * RECETAS. Cambian con el tiempo (sube el precio del chocolate, se ajusta la
 * formula) y la orden de produccion guarda su propia copia de los consumos al
 * ejecutarse, asi que editar una receta NO altera las tandas ya producidas.
 */

import { and, eq, sql } from 'drizzle-orm';

import type {
  EntradaAjusteStock,
  EntradaListaPrecio,
  EntradaPrecio,
  EntradaReceta,
  ResultadoAjuste,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  listasPrecio,
  movimientosStock,
  ordenesProduccion,
  precios,
  recetaItems,
  recetas,
} from '../db/schema';
import {
  ejecutarSeguro,
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorReglaNegocio,
  ErrorValidacion,
} from '../dominio/errores';
import { emitir } from '../eventos';
import { esCentavosValido, redondearCantidad } from '../utiles/numeros';

export const ajustesServicio = {
  /* ----------------------------- Ajustes de stock -------------------------- */

  /**
   * Asienta un ajuste. `cantidad` es el DELTA con signo: positivo suma
   * (aparecio mercaderia, carga inicial), negativo resta (rotura, merma).
   */
  ajustarStock(entrada: EntradaAjusteStock): ResultadoAjuste {
    const cantidad = redondearCantidad(entrada.cantidad);
    if (!Number.isFinite(cantidad) || cantidad === 0) {
      throw new ErrorValidacion('El ajuste tiene que ser distinto de cero.');
    }
    const motivo = entrada.motivo.trim();
    if (motivo.length < 3) {
      throw new ErrorValidacion('El motivo del ajuste es obligatorio: explica por que se ajusta.');
    }

    const resultado = ejecutarSeguro('ajustar el stock', () =>
      obtenerDb().transaction((tx) => {
        const articulo = tx
          .select({ id: articulos.id, nombre: articulos.nombre, activo: articulos.activo })
          .from(articulos)
          .where(eq(articulos.id, entrada.articuloId))
          .get();
        if (!articulo) throw new ErrorNoEncontrado('articulo', entrada.articuloId);

        const saldoPrevio =
          tx
            .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
            .from(movimientosStock)
            .where(eq(movimientosStock.articuloId, entrada.articuloId))
            .get()?.s ?? 0;

        const saldoNuevo = redondearCantidad(saldoPrevio + cantidad);
        if (saldoNuevo < 0) {
          throw new ErrorReglaNegocio(
            `El ajuste dejaria a ${articulo.nombre} con stock negativo (${saldoNuevo}). ` +
              `Hoy hay ${saldoPrevio}.`,
          );
        }

        tx.insert(movimientosStock)
          .values({
            articuloId: entrada.articuloId,
            // 'merma' cuando se descarta mercaderia, 'ajuste' para el resto.
            tipo: entrada.esMerma === true ? 'merma' : 'ajuste',
            cantidad,
            costoUnitario: null,
            documentoTipo: 'ajuste',
            documentoId: null,
            fecha: new Date().toISOString(),
            notas: motivo,
          })
          .run();

        return { articuloNombre: articulo.nombre, saldoPrevio, saldoNuevo, advertencias: [] };
      }),
    );

    emitir('maestros:cambio');
    return resultado;
  },

  /* --------------------------------- Recetas ------------------------------- */

  guardarReceta(id: number | null, entrada: EntradaReceta): { id: number } {
    if (entrada.items.length === 0) {
      throw new ErrorValidacion('La receta tiene que tener al menos un insumo.');
    }
    if (!Number.isFinite(entrada.rindeCantidad) || entrada.rindeCantidad <= 0) {
      throw new ErrorValidacion('El rinde tiene que ser mayor a cero.');
    }

    const items = entrada.items.map((item) => {
      const cantidad = redondearCantidad(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new ErrorValidacion(`La cantidad del insumo ${item.articuloInsumoId} tiene que ser mayor a cero.`);
      }
      const merma = item.mermaEsperadaPct ?? 0;
      if (merma < 0 || merma > 100) {
        throw new ErrorValidacion('La merma esperada va de 0 a 100 por ciento.');
      }
      return { articuloInsumoId: item.articuloInsumoId, cantidad, mermaEsperadaPct: merma };
    });

    const resultado = ejecutarSeguro('guardar la receta', () =>
      obtenerDb().transaction((tx) => {
        const producido = tx
          .select({
            id: articulos.id,
            tipo: articulos.tipo,
            nombre: articulos.nombre,
            unidadBaseId: articulos.unidadBaseId,
          })
          .from(articulos)
          .where(eq(articulos.id, entrada.articuloProducidoId))
          .get();
        if (!producido) throw new ErrorNoEncontrado('articulo', entrada.articuloProducidoId);
        if (producido.tipo === 'materia_prima') {
          throw new ErrorReglaNegocio(
            `${producido.nombre} es materia prima: se compra, no se produce. Elegi un producto terminado o pre-elaborado.`,
          );
        }

        for (const item of items) {
          if (item.articuloInsumoId === entrada.articuloProducidoId) {
            throw new ErrorReglaNegocio('Una receta no puede llevarse a si misma como insumo.');
          }
          const insumo = tx
            .select({ id: articulos.id, activo: articulos.activo, nombre: articulos.nombre })
            .from(articulos)
            .where(eq(articulos.id, item.articuloInsumoId))
            .get();
          if (!insumo) throw new ErrorNoEncontrado('articulo', item.articuloInsumoId);
          if (!insumo.activo) {
            throw new ErrorReglaNegocio(`${insumo.nombre} esta dado de baja: no puede ser insumo.`);
          }
        }

        let recetaId: number;
        if (id === null) {
          const fila = tx
            .insert(recetas)
            .values({
              articuloProducidoId: entrada.articuloProducidoId,
              rindeCantidad: entrada.rindeCantidad,
              // El rinde se expresa SIEMPRE en la unidad base del producido: no
              // se le pide al usuario un dato que ya define el articulo.
              rindeUnidadId: producido.unidadBaseId,
              activa: true,
              notas: entrada.notas?.trim() || null,
            })
            .returning({ id: recetas.id })
            .all()[0];
          if (!fila) throw new ErrorValidacion('La base no devolvio la receta insertada.');
          recetaId = fila.id;
        } else {
          const existe = tx.select({ id: recetas.id }).from(recetas).where(eq(recetas.id, id)).get();
          if (!existe) throw new ErrorNoEncontrado('receta', id);
          tx.update(recetas)
            .set({
              articuloProducidoId: entrada.articuloProducidoId,
              rindeCantidad: entrada.rindeCantidad,
              rindeUnidadId: producido.unidadBaseId,
              notas: entrada.notas?.trim() || null,
            })
            .where(eq(recetas.id, id))
            .run();
          // Los items se reemplazan enteros: es mas simple y menos propenso a
          // error que diferenciar altas, bajas y cambios uno por uno.
          tx.delete(recetaItems).where(eq(recetaItems.recetaId, id)).run();
          recetaId = id;
        }

        for (const item of items) {
          tx.insert(recetaItems)
            .values({
              recetaId,
              articuloInsumoId: item.articuloInsumoId,
              cantidad: item.cantidad,
              mermaEsperadaPct: item.mermaEsperadaPct,
            })
            .run();
        }

        return { id: recetaId };
      }),
    );

    emitir('maestros:cambio');
    return resultado;
  },

  cambiarActivaReceta(id: number, activa: boolean): { id: number } {
    const resultado = ejecutarSeguro('cambiar el estado de la receta', () =>
      obtenerDb().transaction((tx) => {
        const receta = tx.select({ id: recetas.id }).from(recetas).where(eq(recetas.id, id)).get();
        if (!receta) throw new ErrorNoEncontrado('receta', id);

        if (!activa) {
          // Una receta con produccion en curso no se puede desactivar: la orden
          // la necesita para calcular los consumos al finalizar.
          const enCurso =
            tx
              .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
              .from(ordenesProduccion)
              .where(and(eq(ordenesProduccion.recetaId, id), eq(ordenesProduccion.estado, 'en_proceso')))
              .get()?.n ?? 0;
          if (enCurso > 0) {
            throw new ErrorReglaNegocio(
              'Hay tandas en proceso con esta receta. Terminalas antes de desactivarla.',
            );
          }
        }

        tx.update(recetas).set({ activa }).where(eq(recetas.id, id)).run();
        return { id };
      }),
    );
    emitir('maestros:cambio');
    return resultado;
  },

  /* ---------------------------- Listas de precio --------------------------- */

  crearListaPrecio(entrada: EntradaListaPrecio): { id: number } {
    return ejecutarSeguro('crear la lista de precios', () => {
      const db = obtenerDb();
      const nombre = entrada.nombre.trim();
      if (nombre.length < 2) throw new ErrorValidacion('El nombre de la lista es obligatorio.');
      const duplicada = db
        .select({ id: listasPrecio.id })
        .from(listasPrecio)
        .where(eq(listasPrecio.nombre, nombre))
        .get();
      if (duplicada) throw new ErrorConflicto(`Ya existe una lista llamada ${nombre}.`);

      const fila = db
        .insert(listasPrecio)
        .values({ nombre, activa: true })
        .returning({ id: listasPrecio.id })
        .all()[0];
      if (!fila) throw new ErrorValidacion('La base no devolvio la lista insertada.');
      emitir('maestros:cambio');
      return { id: fila.id };
    });
  },

  /**
   * Fija el precio de un articulo en una lista. NO actualiza el precio anterior:
   * inserta uno nuevo vigente desde hoy. El historial de precios es parte de la
   * informacion del negocio —cuanto costaba en marzo— y se consulta al facturar
   * una venta vieja.
   */
  fijarPrecio(entrada: EntradaPrecio): { id: number } {
    if (!esCentavosValido(entrada.precio)) {
      throw new ErrorValidacion('El precio tiene que ser un entero de centavos (>= 0).');
    }
    const resultado = ejecutarSeguro('fijar el precio', () =>
      obtenerDb().transaction((tx) => {
        const lista = tx
          .select({ id: listasPrecio.id })
          .from(listasPrecio)
          .where(eq(listasPrecio.id, entrada.listaPrecioId))
          .get();
        if (!lista) throw new ErrorNoEncontrado('lista de precios', entrada.listaPrecioId);

        const articulo = tx
          .select({ id: articulos.id, tipo: articulos.tipo, nombre: articulos.nombre })
          .from(articulos)
          .where(eq(articulos.id, entrada.articuloId))
          .get();
        if (!articulo) throw new ErrorNoEncontrado('articulo', entrada.articuloId);
        if (articulo.tipo !== 'producto_terminado') {
          throw new ErrorReglaNegocio(`${articulo.nombre} no es un producto terminado: no se le pone precio de venta.`);
        }

        const hoy = new Date().toISOString().slice(0, 10);
        // Dos precios el mismo dia para el mismo articulo: se pisa el ultimo, que
        // es una correccion, no un cambio de precio historico.
        tx.delete(precios)
          .where(
            and(
              eq(precios.listaPrecioId, entrada.listaPrecioId),
              eq(precios.articuloId, entrada.articuloId),
              eq(precios.vigenteDesde, hoy),
            ),
          )
          .run();

        const fila = tx
          .insert(precios)
          .values({
            listaPrecioId: entrada.listaPrecioId,
            articuloId: entrada.articuloId,
            precio: entrada.precio,
            vigenteDesde: hoy,
          })
          .returning({ id: precios.id })
          .all()[0];
        if (!fila) throw new ErrorValidacion('La base no devolvio el precio insertado.');
        return { id: fila.id };
      }),
    );
    emitir('maestros:cambio');
    return resultado;
  },
};
