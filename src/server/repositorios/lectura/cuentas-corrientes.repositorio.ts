/**
 * Repositorio de LECTURA del ledger de cuentas corrientes.
 *
 * El ledger es polimorfico: `(entidad_tipo, entidad_id)` apunta a `clientes` o a
 * `proveedores` sin FK fisica. Para resolver el nombre en una sola consulta se
 * usan dos LEFT JOIN condicionados por `entidad_tipo`: cada fila engancha como
 * mucho con uno de los dos, y el otro queda en NULL. Alternativa descartada:
 * traer los ids y resolver nombres con dos queries mas y un merge en memoria,
 * que es mas codigo para el mismo resultado.
 *
 * El nombre puede venir NULL si la entidad fue borrada (justamente porque no hay
 * FK que lo impida). El repositorio lo reporta como tal y el servicio decide que
 * mostrar: inventar una etiqueta acá seria meter presentacion en la capa de datos.
 */

import { and, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  clientes,
  cuentasCorrientes,
  proveedores,
  type TipoEntidadCc,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Una fila por entidad CON movimientos. Las entidades sin ledger no aparecen. */
export interface FilaResumenCuentaCorriente {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  entidadNombre: string | null;
  debe: number;
  haber: number;
  cantidadMovimientos: number;
  ultimoMovimiento: string | null;
}

/** Saldos globales por tipo de entidad, para el tablero. En centavos. */
export interface SaldosGlobalesCc {
  saldoClientes: number;
  saldoProveedores: number;
}

/** Expresion reutilizable: el aporte con signo de un asiento al saldo (debe - haber). */
const APORTE_CON_SIGNO = sql`CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE -${cuentasCorrientes.monto} END`;

/**
 * Resumen del ledger agrupado por entidad.
 *
 * Se agrupa por el par completo porque `entidad_id` solo no identifica nada: el
 * cliente 3 y el proveedor 3 son entidades distintas que conviven en la tabla.
 */
export function listarResumenPorEntidad(): FilaResumenCuentaCorriente[] {
  return ejecutarSeguro('listar resumen de cuentas corrientes', () =>
    obtenerDb()
      .select({
        entidadTipo: cuentasCorrientes.entidadTipo,
        entidadId: cuentasCorrientes.entidadId,
        entidadNombre: sql<
          string | null
        >`COALESCE(MAX(${clientes.nombre}), MAX(${proveedores.nombre}))`,
        debe: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
        haber: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'haber' THEN ${cuentasCorrientes.monto} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
        cantidadMovimientos: sql<number>`COUNT(${cuentasCorrientes.id})`.mapWith(Number),
        ultimoMovimiento: sql<string | null>`MAX(${cuentasCorrientes.fecha})`,
      })
      .from(cuentasCorrientes)
      .leftJoin(
        clientes,
        and(
          eq(cuentasCorrientes.entidadTipo, 'cliente'),
          eq(clientes.id, cuentasCorrientes.entidadId),
        ),
      )
      .leftJoin(
        proveedores,
        and(
          eq(cuentasCorrientes.entidadTipo, 'proveedor'),
          eq(proveedores.id, cuentasCorrientes.entidadId),
        ),
      )
      .groupBy(cuentasCorrientes.entidadTipo, cuentasCorrientes.entidadId)
      .all(),
  );
}

/** Saldo total de clientes y de proveedores en una sola pasada de la tabla. */
export function agregarSaldosGlobales(): SaldosGlobalesCc {
  return ejecutarSeguro('agregar saldos globales de cuentas corrientes', () => {
    const fila = obtenerDb()
      .select({
        saldoClientes: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.entidadTipo} = 'cliente' THEN ${APORTE_CON_SIGNO} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
        saldoProveedores: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.entidadTipo} = 'proveedor' THEN ${APORTE_CON_SIGNO} ELSE 0 END), 0)`.mapWith(
          Number,
        ),
      })
      .from(cuentasCorrientes)
      .all()[0];

    return {
      saldoClientes: fila?.saldoClientes ?? 0,
      saldoProveedores: fila?.saldoProveedores ?? 0,
    };
  });
}
