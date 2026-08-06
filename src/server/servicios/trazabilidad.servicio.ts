/**
 * Servicio de trazabilidad por lote.
 *
 * El patron es el de cosecha: se busca por codigo de lote y se reconstruye la
 * historia completa de la tanda. Aca la reconstruccion sale del ledger: el lote
 * lleva a la orden, la orden a sus consumos, y los movimientos con
 * documento_tipo='orden_produccion' son la evidencia contable de que paso.
 */

import { and, eq } from 'drizzle-orm';

import type {
  ConsumoTrazado,
  MovimientoTrazado,
  TrazabilidadLote,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  movimientosStock,
  ordenesProduccion,
  produccionConsumos,
  unidadesMedida,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado } from '../dominio/errores';
import * as repoProduccion from '../repositorios/lectura/produccion.repositorio';
import { stockServicio } from './stock.servicio';
import { redondearCantidad } from '../utiles/numeros';

export const trazabilidadServicio = {
  /** Historia completa de un lote. 404 si el lote no existe. */
  consultarLote(numeroLote: string): TrazabilidadLote {
    const db = obtenerDb();

    const cabecera = ejecutarSeguro('buscar la orden del lote', () =>
      db
        .select({ id: ordenesProduccion.id })
        .from(ordenesProduccion)
        .where(eq(ordenesProduccion.numeroLote, numeroLote))
        .get(),
    );
    if (!cabecera) throw new ErrorNoEncontrado('lote', numeroLote);

    // La vista completa de la orden sale del repositorio de lectura existente.
    const orden = repoProduccion.listarOrdenes().find((o) => o.id === cabecera.id);
    if (!orden) throw new ErrorNoEncontrado('lote', numeroLote);

    const consumos: ConsumoTrazado[] = ejecutarSeguro('leer los consumos del lote', () =>
      db
        .select({
          articuloId: produccionConsumos.articuloInsumoId,
          codigo: articulos.codigo,
          nombre: articulos.nombre,
          unidadAbreviatura: unidadesMedida.abreviatura,
          cantidadTeorica: produccionConsumos.cantidadTeorica,
          cantidadReal: produccionConsumos.cantidadReal,
        })
        .from(produccionConsumos)
        .innerJoin(articulos, eq(articulos.id, produccionConsumos.articuloInsumoId))
        .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
        .where(eq(produccionConsumos.ordenId, cabecera.id))
        .all()
        .map((fila) => ({
          ...fila,
          merma:
            fila.cantidadReal === null
              ? null
              : redondearCantidad(fila.cantidadReal - fila.cantidadTeorica),
        })),
    );

    const movimientos: MovimientoTrazado[] = ejecutarSeguro('leer los movimientos del lote', () =>
      db
        .select({
          id: movimientosStock.id,
          fecha: movimientosStock.fecha,
          tipo: movimientosStock.tipo,
          articuloId: movimientosStock.articuloId,
          articuloNombre: articulos.nombre,
          cantidad: movimientosStock.cantidad,
          unidadAbreviatura: unidadesMedida.abreviatura,
        })
        .from(movimientosStock)
        .innerJoin(articulos, eq(articulos.id, movimientosStock.articuloId))
        .innerJoin(unidadesMedida, eq(unidadesMedida.id, articulos.unidadBaseId))
        .where(
          and(
            eq(movimientosStock.documentoTipo, 'orden_produccion'),
            eq(movimientosStock.documentoId, cabecera.id),
          ),
        )
        .orderBy(movimientosStock.fecha, movimientosStock.id)
        .all(),
    );

    return {
      numeroLote,
      orden,
      consumos,
      movimientos,
      stockActualProducido: stockServicio.saldoActual(orden.articuloProducidoId),
    };
  },
};
