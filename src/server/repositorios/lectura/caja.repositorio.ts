/**
 * Repositorio de LECTURA de caja.
 *
 * Los totales de ingresos y egresos se agregan con `SUM(CASE WHEN ...)` en la
 * misma consulta que la caja: el monto siempre es positivo en la tabla y el
 * signo lo da `tipo`, asi que separar los dos totales es una decision de lectura
 * y no un dato guardado. Se resuelve en SQL para no traer el detalle completo de
 * movimientos solo para sumarlo.
 */

import { and, desc, eq, sql, type SQL } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  cajaMovimientos,
  cajas,
  type CajaMovimiento,
  type EstadoCaja,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Caja con sus totales de movimientos ya agregados. Todos los importes en centavos. */
export interface FilaCaja {
  id: number;
  fechaApertura: string;
  fechaCierre: string | null;
  montoApertura: number;
  montoCierreTeorico: number | null;
  montoCierreReal: number | null;
  diferencia: number | null;
  estado: EstadoCaja;
  usuario: string | null;
  totalIngresos: number;
  totalEgresos: number;
}

/** Proyeccion unica: la comparten el listado y la busqueda de la caja abierta. */
const COLUMNAS_CAJA = {
  id: cajas.id,
  fechaApertura: cajas.fechaApertura,
  fechaCierre: cajas.fechaCierre,
  montoApertura: cajas.montoApertura,
  montoCierreTeorico: cajas.montoCierreTeorico,
  montoCierreReal: cajas.montoCierreReal,
  diferencia: cajas.diferencia,
  estado: cajas.estado,
  usuario: cajas.usuario,
  totalIngresos:
    sql<number>`COALESCE(SUM(CASE WHEN ${cajaMovimientos.tipo} = 'ingreso' THEN ${cajaMovimientos.monto} ELSE 0 END), 0)`.mapWith(
      Number,
    ),
  totalEgresos:
    sql<number>`COALESCE(SUM(CASE WHEN ${cajaMovimientos.tipo} = 'egreso' THEN ${cajaMovimientos.monto} ELSE 0 END), 0)`.mapWith(
      Number,
    ),
};

/** Consulta base: LEFT JOIN para que una caja recien abierta aparezca con ceros. */
function consultaCajas(condicion: SQL | undefined) {
  return obtenerDb()
    .select(COLUMNAS_CAJA)
    .from(cajas)
    .leftJoin(cajaMovimientos, eq(cajaMovimientos.cajaId, cajas.id))
    .where(condicion)
    .groupBy(cajas.id)
    .orderBy(desc(cajas.fechaApertura), desc(cajas.id));
}

/** Listado de cajas, de la apertura mas reciente a la mas antigua. */
export function listarCajas(): FilaCaja[] {
  return ejecutarSeguro('listar cajas', () => consultaCajas(undefined).all());
}

/**
 * Caja abierta actual, si hay alguna.
 *
 * El modelo no impide que queden dos abiertas (un cierre olvidado), asi que se
 * toma la de apertura mas reciente en vez de asumir que hay exactamente una.
 */
export function obtenerCajaAbierta(): FilaCaja | undefined {
  return ejecutarSeguro('obtener la caja abierta', () =>
    consultaCajas(eq(cajas.estado, 'abierta')).limit(1).all()[0],
  );
}

/**
 * Movimientos de caja, opcionalmente acotados a una caja.
 *
 * El filtro es opcional porque `caja_movimientos.caja_id` admite NULL: un
 * movimiento puede quedar huerfano si se borra la caja, y esos tambien tienen
 * que poder verse.
 */
export function listarMovimientos(cajaId?: number): CajaMovimiento[] {
  return ejecutarSeguro('listar movimientos de caja', () => {
    const condiciones: SQL[] = [];
    if (cajaId !== undefined) condiciones.push(eq(cajaMovimientos.cajaId, cajaId));

    return obtenerDb()
      .select()
      .from(cajaMovimientos)
      .where(and(...condiciones))
      .orderBy(desc(cajaMovimientos.fecha), desc(cajaMovimientos.id))
      .all();
  });
}
