/**
 * Aplicacion automatica de migraciones Drizzle.
 *
 * Se ejecuta al arrancar el proceso main: si la base no existe la crea, y si
 * esta desactualizada aplica solo las migraciones faltantes. Drizzle lleva el
 * control en su tabla interna __drizzle_migrations.
 */

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { obtenerDb, obtenerRutaDb } from './conexion';
import { resolverCarpetaMigraciones } from './rutas-db';

export interface ResultadoMigracion {
  readonly aplicadas: boolean;
  readonly rutaDb: string;
  readonly carpetaMigraciones: string;
}

/**
 * Aplica las migraciones pendientes. Es idempotente: si la base ya esta al dia
 * no hace nada. Lanza si las migraciones no se pueden aplicar (error fatal de
 * arranque: sin schema no hay ERP).
 */
export function aplicarMigraciones(): ResultadoMigracion {
  const carpetaMigraciones = resolverCarpetaMigraciones();
  const db = obtenerDb();

  migrate(db, { migrationsFolder: carpetaMigraciones });

  return {
    aplicadas: true,
    rutaDb: obtenerRutaDb(),
    carpetaMigraciones,
  };
}
