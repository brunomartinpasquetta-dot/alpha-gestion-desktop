/**
 * Aplicacion automatica de migraciones Drizzle.
 *
 * Se ejecuta al arrancar el proceso main: si la base no existe la crea, y si
 * esta desactualizada aplica solo las migraciones faltantes. Drizzle lleva el
 * control en su tabla interna __drizzle_migrations.
 *
 * POR QUE ESTO NO ES UN `migrate()` PELADO
 * ----------------------------------------
 * SQLite no sabe agregar una columna con CHECK ni cambiar uno existente: para
 * eso hay que RECREAR la tabla (crear la nueva, copiar, DROP de la vieja,
 * renombrar). Es la receta que genera drizzle-kit y la que usan varias de
 * nuestras migraciones.
 *
 * El problema: ese DROP TABLE, con las foreign keys ACTIVAS, dispara un DELETE
 * implicito que CASCADEA A LOS HIJOS. Recrear `ventas` para agregarle una
 * columna se lleva puestos venta_items, venta_pagos y comprobantes, en
 * silencio y sin un solo error.
 *
 * Las migraciones traen `PRAGMA foreign_keys=OFF` para evitarlo, pero ahi NO
 * SIRVE DE NADA: el migrador de drizzle envuelve todo en una transaccion, y
 * SQLite ignora ese pragma si hay una transaccion abierta. O sea que la
 * proteccion que creiamos tener nunca estuvo.
 *
 * Aca se hace lo que corresponde:
 *   1. Checkpoint del WAL y copia de resguardo ANTES de tocar nada.
 *   2. foreign_keys = OFF de verdad, FUERA de toda transaccion.
 *   3. migrate().
 *   4. foreign_key_check: si algo quedo huerfano, se ABORTA y se restaura la
 *      copia. Vale mas no arrancar que arrancar con datos rotos.
 *   5. foreign_keys = ON de vuelta.
 */

import { copyFileSync, existsSync, renameSync, unlinkSync } from 'node:fs';

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';

import { obtenerDb, obtenerRutaDb, obtenerSqlite } from './conexion';
import { resolverCarpetaMigraciones } from './rutas-db';

export interface ResultadoMigracion {
  readonly aplicadas: boolean;
  readonly rutaDb: string;
  readonly carpetaMigraciones: string;
  /** Copia previa a la migracion, si hubo algo que respaldar. */
  readonly resguardo: string | null;
}

/** Vuelca el WAL al archivo principal para que una copia por filesystem sea consistente. */
function consolidarWal(): void {
  try {
    obtenerSqlite().pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Si el checkpoint no se puede hacer (otro proceso leyendo), se sigue: el
    // resguardo puede quedar viejo, pero es mejor tener uno viejo que ninguno.
  }
}

/**
 * Aplica las migraciones pendientes. Es idempotente: si la base ya esta al dia
 * no hace nada. Lanza si las migraciones no se pueden aplicar (error fatal de
 * arranque: sin schema no hay ERP).
 */
export function aplicarMigraciones(): ResultadoMigracion {
  const carpetaMigraciones = resolverCarpetaMigraciones();
  const db = obtenerDb();
  const sqlite = obtenerSqlite();
  const rutaDb = obtenerRutaDb();

  // Resguardo previo. Solo tiene sentido si la base ya existe con contenido:
  // en una instalacion nueva no hay nada que perder.
  let resguardo: string | null = null;
  if (existsSync(rutaDb)) {
    consolidarWal();
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    resguardo = `${rutaDb}.antes-de-migrar-${sello}`;
    try {
      copyFileSync(rutaDb, resguardo);
    } catch {
      resguardo = null; // Sin resguardo se sigue igual, pero se avisa abajo.
    }
  }

  // Las FK se apagan ACA, fuera de cualquier transaccion, que es el unico lugar
  // donde SQLite hace caso. Si no, el DROP de una tabla recreada cascadea.
  const fkEstabanActivas = (sqlite.pragma('foreign_keys', { simple: true }) as number) === 1;
  sqlite.pragma('foreign_keys = OFF');

  try {
    migrate(db, { migrationsFolder: carpetaMigraciones });
  } catch (causa) {
    sqlite.pragma(`foreign_keys = ${fkEstabanActivas ? 'ON' : 'OFF'}`);
    throw causa;
  }

  // Con las FK apagadas, una migracion mal escrita puede dejar hijos apuntando
  // a padres que ya no existen. Se comprueba explicitamente.
  const huerfanos = sqlite.pragma('foreign_key_check') as unknown[];
  sqlite.pragma(`foreign_keys = ${fkEstabanActivas ? 'ON' : 'OFF'}`);

  if (huerfanos.length > 0) {
    // Datos rotos: se vuelve atras. Arrancar igual seria peor, porque el
    // operador facturaria sobre una base inconsistente sin saberlo.
    if (resguardo !== null && existsSync(resguardo)) {
      const sqliteCerrado = sqlite;
      sqliteCerrado.close();
      for (const sufijo of ['-wal', '-shm']) {
        if (existsSync(`${rutaDb}${sufijo}`)) unlinkSync(`${rutaDb}${sufijo}`);
      }
      renameSync(resguardo, rutaDb);
      throw new Error(
        `La migracion dejo ${huerfanos.length} fila(s) huerfana(s): se restauro la base al estado anterior. ` +
          'Revisa la ultima migracion antes de volver a abrir el sistema.',
      );
    }
    throw new Error(
      `La migracion dejo ${huerfanos.length} fila(s) huerfana(s) y no habia resguardo para volver atras. ` +
        'No sigas operando: restaura un respaldo manual.',
    );
  }

  return {
    aplicadas: true,
    rutaDb,
    carpetaMigraciones,
    resguardo,
  };
}
