/**
 * Conexion unica a SQLite (better-sqlite3, sincrono) e instancia de Drizzle.
 *
 * La conexion es un singleton por proceso: better-sqlite3 es sincrono y no
 * necesita pool. Se aplican los PRAGMA criticos para un ERP de escritorio:
 *  - journal_mode = WAL   -> lecturas concurrentes sin bloquear escrituras
 *  - foreign_keys = ON    -> SQLite las desactiva por defecto (integridad referencial)
 *  - busy_timeout         -> evita SQLITE_BUSY inmediato ante escrituras simultaneas
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';
import { resolverRutaDb } from './rutas-db';

export type BaseDatos = BetterSQLite3Database<typeof schema>;

interface Contexto {
  readonly sqlite: Database.Database;
  readonly db: BaseDatos;
  readonly rutaDb: string;
}

let contexto: Contexto | undefined;

function aplicarPragmas(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
}

/** Abre (o reutiliza) la conexion a la base de datos del ERP. */
export function obtenerContextoDb(): Contexto {
  if (contexto) return contexto;

  const rutaDb = resolverRutaDb();
  const sqlite = new Database(rutaDb);
  aplicarPragmas(sqlite);

  const db = drizzle(sqlite, { schema });
  contexto = { sqlite, db, rutaDb };
  return contexto;
}

/** Instancia de Drizzle lista para usar. Punto de entrada de la capa de datos. */
export function obtenerDb(): BaseDatos {
  return obtenerContextoDb().db;
}

/** Handle crudo de better-sqlite3, para migraciones y chequeos de bajo nivel. */
export function obtenerSqlite(): Database.Database {
  return obtenerContextoDb().sqlite;
}

/** Ruta absoluta del archivo de base de datos en uso. */
export function obtenerRutaDb(): string {
  return obtenerContextoDb().rutaDb;
}

/** Chequeo de salud: confirma que la base responde y devuelve datos utiles. */
export function verificarSaludDb(): { ok: boolean; rutaDb: string; tablas: number; error?: string } {
  try {
    const { sqlite, rutaDb } = obtenerContextoDb();
    const fila = sqlite
      .prepare<[], { total: number }>(
        "SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
      )
      .get();
    return { ok: true, rutaDb, tablas: fila?.total ?? 0 };
  } catch (error) {
    return {
      ok: false,
      rutaDb: process.env.ALFAJORES_DB_PATH ?? '',
      tablas: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Cierra la conexion. Se llama al cerrar la app para liberar el archivo WAL. */
export function cerrarDb(): void {
  if (!contexto) return;
  contexto.sqlite.close();
  contexto = undefined;
}
