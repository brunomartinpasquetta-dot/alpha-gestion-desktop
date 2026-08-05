/**
 * Repositorio de LECTURA del ledger de stock.
 *
 * Vive separado de `movimientos-stock.repositorio.ts` (que es el de escritura y
 * consultas simples) porque resuelve una proyeccion distinta: el ledger visible
 * en pantalla, con el saldo que el articulo tenia despues de cada movimiento.
 *
 * El saldo acumulado se calcula con una window function y no en JavaScript: la
 * base ya tiene las filas ordenadas por el indice (articulo_id, fecha) y sumar
 * ahi cuesta un solo recorrido. Ademas la window function se evalua ANTES del
 * LIMIT, asi que el acumulado sigue siendo correcto aunque solo devolvamos las
 * ultimas N filas: cortar la lista no cambia la historia previa.
 */

import { desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  movimientosStock,
  type TipoDocumentoStock,
  type TipoMovimientoStock,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Fila del ledger con el acumulado ya resuelto en SQL. Sin redondear: eso lo hace el servicio. */
export interface FilaMovimientoStockAcumulado {
  id: number;
  fecha: string;
  tipo: TipoMovimientoStock;
  cantidad: number;
  costoUnitario: number | null;
  documentoTipo: TipoDocumentoStock | null;
  documentoId: number | null;
  notas: string | null;
  saldoAcumulado: number;
}

/**
 * Ledger de un articulo, del movimiento mas reciente al mas antiguo (orden de
 * lectura), pero con el acumulado calculado cronologicamente (orden contable).
 *
 * El `id` desempata dentro de la misma fecha en las dos ordenaciones, para que
 * una carga masiva hecha en el mismo instante no produzca un acumulado ambiguo.
 */
export function listarMovimientosConAcumulado(
  articuloId: number,
  limite: number,
): FilaMovimientoStockAcumulado[] {
  return ejecutarSeguro('listar el ledger de stock de un articulo', () =>
    obtenerDb()
      .select({
        id: movimientosStock.id,
        fecha: movimientosStock.fecha,
        tipo: movimientosStock.tipo,
        cantidad: movimientosStock.cantidad,
        costoUnitario: movimientosStock.costoUnitario,
        documentoTipo: movimientosStock.documentoTipo,
        documentoId: movimientosStock.documentoId,
        notas: movimientosStock.notas,
        saldoAcumulado:
          sql<number>`SUM(${movimientosStock.cantidad}) OVER (ORDER BY ${movimientosStock.fecha}, ${movimientosStock.id})`.mapWith(
            Number,
          ),
      })
      .from(movimientosStock)
      .where(eq(movimientosStock.articuloId, articuloId))
      .orderBy(desc(movimientosStock.fecha), desc(movimientosStock.id))
      .limit(limite)
      .all(),
  );
}
