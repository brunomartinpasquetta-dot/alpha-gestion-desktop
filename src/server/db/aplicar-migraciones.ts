/**
 * Entrada CLI para aplicar migraciones a mano: `npm run db:migrar`.
 * Util para preparar la base sin levantar Electron.
 */

import { cerrarDb } from './conexion';
import { aplicarMigraciones } from './migraciones';

function main(): void {
  try {
    const resultado = aplicarMigraciones();
    console.log('[migraciones] Base de datos al dia.');
    console.log(`[migraciones] Archivo:     ${resultado.rutaDb}`);
    console.log(`[migraciones] Migraciones: ${resultado.carpetaMigraciones}`);
  } catch (error) {
    console.error('[migraciones] Fallo al aplicar migraciones:');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    cerrarDb();
  }
}

main();
