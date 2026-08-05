/**
 * Repositorio del ledger de cuentas corrientes.
 *
 * Una sola tabla sirve a clientes y proveedores: la entidad se identifica con el
 * par (`entidad_tipo`, `entidad_id`), una FK polimorfica sin FK fisica. Por eso
 * la existencia de la entidad NO la garantiza SQLite y hay que chequearla acá
 * (`existeEntidad`) antes de asentar cualquier movimiento.
 *
 * Igual que el ledger de stock, es append-only: no se corrige un asiento, se
 * compensa con otro.
 */

import { and, desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import {
  clientes,
  cuentasCorrientes,
  proveedores,
  type CuentaCorriente,
  type NuevaCuentaCorriente,
  type TipoEntidadCc,
} from '../db/schema';
import { ejecutarSeguro, ErrorDatos } from '../dominio/errores';

/** Totales crudos del ledger de una entidad, en centavos. El neto lo arma el servicio. */
export interface AgregadoCuentaCorriente {
  debe: number;
  haber: number;
}

/** Inserta un asiento de cuenta corriente y devuelve la fila persistida. */
export function insertar(valores: NuevaCuentaCorriente): CuentaCorriente {
  return ejecutarSeguro('insertar movimiento de cuenta corriente', () => {
    const fila = obtenerDb().insert(cuentasCorrientes).values(valores).returning().all()[0];
    if (!fila) {
      throw new ErrorDatos('El motor no devolvio la fila del movimiento de cuenta corriente insertado.');
    }
    return fila;
  });
}

/**
 * Debe y haber de una entidad en UNA sola consulta.
 *
 * Se resuelve con `SUM(CASE WHEN ...)` en vez de dos queries (o de traer las
 * filas) porque el saldo se consulta en cada pantalla de cliente/proveedor y
 * debe costar un solo recorrido del indice por entidad. Sin movimientos devuelve
 * ceros, que es el saldo correcto de una cuenta recien abierta.
 */
export function agregarSaldo(
  entidadTipo: TipoEntidadCc,
  entidadId: number,
): AgregadoCuentaCorriente {
  return ejecutarSeguro('agregar saldo de cuenta corriente', () => {
    const fila = obtenerDb()
      .select({
        debe: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
        haber: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'haber' THEN ${cuentasCorrientes.monto} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      })
      .from(cuentasCorrientes)
      .where(
        and(
          eq(cuentasCorrientes.entidadTipo, entidadTipo),
          eq(cuentasCorrientes.entidadId, entidadId),
        ),
      )
      .all()[0];

    return { debe: fila?.debe ?? 0, haber: fila?.haber ?? 0 };
  });
}

/**
 * Verifica que exista el cliente o el proveedor referenciado.
 *
 * Reemplaza a la integridad referencial que la tabla polimorfica no puede tener:
 * sin este chequeo se podrian asentar movimientos huerfanos, imposibles de
 * detectar despues porque no hay FK que los delate.
 */
export function existeEntidad(entidadTipo: TipoEntidadCc, entidadId: number): boolean {
  return ejecutarSeguro('verificar existencia de entidad de cuenta corriente', () => {
    const db = obtenerDb();
    const uno = sql<number>`1`.mapWith(Number);
    const filas =
      entidadTipo === 'cliente'
        ? db.select({ existe: uno }).from(clientes).where(eq(clientes.id, entidadId)).limit(1).all()
        : db
            .select({ existe: uno })
            .from(proveedores)
            .where(eq(proveedores.id, entidadId))
            .limit(1)
            .all();
    return filas.length > 0;
  });
}

/** Historial de la cuenta, del asiento mas reciente al mas antiguo. */
export function listarPorEntidad(
  entidadTipo: TipoEntidadCc,
  entidadId: number,
  limite?: number,
): CuentaCorriente[] {
  return ejecutarSeguro('listar movimientos de cuenta corriente', () => {
    const consulta = obtenerDb()
      .select()
      .from(cuentasCorrientes)
      .where(
        and(
          eq(cuentasCorrientes.entidadTipo, entidadTipo),
          eq(cuentasCorrientes.entidadId, entidadId),
        ),
      )
      .orderBy(desc(cuentasCorrientes.fecha), desc(cuentasCorrientes.id));
    return limite !== undefined && limite > 0 ? consulta.limit(limite).all() : consulta.all();
  });
}
