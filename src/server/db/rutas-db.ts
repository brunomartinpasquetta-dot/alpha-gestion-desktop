/**
 * Resolucion de rutas del almacenamiento persistente.
 *
 * La base de datos NUNCA vive dentro del bundle de la app: vive en la carpeta
 * userData de Electron, para que sobreviva a actualizaciones y reinstalaciones.
 *
 * Este modulo funciona tanto dentro de Electron (usa app.getPath('userData'))
 * como en procesos Node sueltos (migraciones, seed, tests), donde replica
 * exactamente la convencion de Electron por sistema operativo.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { NOMBRE_APP, NOMBRE_ARCHIVO_DB } from '../../compartido/config';

/** Carpeta userData equivalente a la de Electron, calculada sin depender de Electron. */
function carpetaUserDataFallback(): string {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', NOMBRE_APP);
    case 'win32':
      return path.join(process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), NOMBRE_APP);
    default:
      return path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), NOMBRE_APP);
  }
}

/**
 * Devuelve la carpeta userData. Dentro de Electron delega en app.getPath para
 * respetar cualquier override del runtime; fuera de Electron usa el fallback.
 */
export function resolverCarpetaUserData(): string {
  try {
    // require dinamico: en procesos Node puros el modulo 'electron' no esta disponible.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as { app?: { getPath(nombre: string): string } };
    if (electron?.app?.getPath) return electron.app.getPath('userData');
  } catch {
    // Sin Electron: seguimos con el fallback.
  }
  return carpetaUserDataFallback();
}

/**
 * Ruta absoluta al archivo SQLite. Se puede forzar con ALFAJORES_DB_PATH
 * (util para tests o para apuntar a una base de prueba).
 */
export function resolverRutaDb(): string {
  const forzada = process.env.ALFAJORES_DB_PATH?.trim();
  if (forzada) return path.resolve(forzada);

  const carpeta = resolverCarpetaUserData();
  fs.mkdirSync(carpeta, { recursive: true });
  return path.join(carpeta, NOMBRE_ARCHIVO_DB);
}

/**
 * Carpeta con las migraciones SQL generadas por drizzle-kit.
 * En desarrollo cuelga de la raiz del repo; empaquetada viaja en resources/.
 */
export function resolverCarpetaMigraciones(): string {
  const candidatas = [
    process.env.ALFAJORES_MIGRACIONES_PATH?.trim(),
    // Empaquetado: extraResources copia ./drizzle a process.resourcesPath/drizzle
    process.resourcesPath ? path.join(process.resourcesPath, 'drizzle') : undefined,
    // Desde dist/server/db -> raiz del proyecto
    path.resolve(__dirname, '..', '..', '..', 'drizzle'),
    path.resolve(process.cwd(), 'drizzle'),
  ].filter((c): c is string => typeof c === 'string' && c.length > 0);

  for (const candidata of candidatas) {
    if (fs.existsSync(path.join(candidata, 'meta', '_journal.json'))) return candidata;
  }

  throw new Error(
    `No se encontro la carpeta de migraciones. Corre "npm run db:generar". Rutas probadas: ${candidatas.join(', ')}`,
  );
}
