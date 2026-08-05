#!/usr/bin/env node
/**
 * Compila, empaqueta e INSTALA la app en /Applications.
 *
 *   npm run instalar:mac
 *
 * Es el camino de actualizacion mientras no haya auto-updater: cada vez que se
 * corre, reemplaza la version instalada por la recien compilada. La base de
 * datos NO se toca — vive en userData, fuera del bundle — asi que los datos
 * sobreviven a cualquier reinstalacion.
 *
 * Si la app esta abierta, la cierra antes de reemplazarla: macOS no permite
 * pisar un .app en ejecucion y el resultado seria un bundle corrupto.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');

const NOMBRE_APP = 'Alpha Gestion.app';
const ORIGEN = join(raiz, 'release', 'mac-arm64', NOMBRE_APP);
const DESTINO = join('/Applications', NOMBRE_APP);

function paso(texto) {
  console.log(`\n[1m▸ ${texto}[0m`);
}

function correr(comando, argumentos, opciones = {}) {
  // ELECTRON_RUN_AS_NODE rompe cualquier arranque de Electron aguas abajo.
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;

  const resultado = spawnSync(comando, argumentos, {
    cwd: raiz,
    stdio: 'inherit',
    env: entorno,
    ...opciones,
  });

  if (resultado.status !== 0) {
    console.error(`\n✗ Fallo: ${comando} ${argumentos.join(' ')}\n`);
    process.exit(resultado.status ?? 1);
  }
}

if (process.platform !== 'darwin') {
  console.error('\n✗ Este script instala en macOS. Para Windows: npm run build:win\n');
  process.exit(1);
}

paso('Cerrando la app si esta abierta');
// `pkill` devuelve 1 cuando no encontro nada: no es un error, es lo esperado.
spawnSync('pkill', ['-f', '/Applications/Alpha Gestion.app'], { stdio: 'ignore' });

paso('Compilando (tsc + vite)');
correr('npm', ['run', 'build']);

paso('Empaquetando con electron-builder');
correr('npx', ['electron-builder', '--mac', '--arm64', '--dir']);

if (!existsSync(ORIGEN)) {
  console.error(`\n✗ No se genero el bundle esperado en:\n  ${ORIGEN}\n`);
  process.exit(1);
}

paso('Instalando en /Applications');
if (existsSync(DESTINO)) rmSync(DESTINO, { recursive: true, force: true });
correr('cp', ['-R', ORIGEN, DESTINO]);

// Sin firma, macOS puede marcar el bundle como no confiable. Limpiar los
// atributos de cuarentena evita el cartel de "aplicacion danada".
paso('Limpiando atributos de cuarentena');
spawnSync('xattr', ['-cr', DESTINO], { stdio: 'ignore' });

console.log(`\n[32m✓ Instalada en ${DESTINO}[0m`);
console.log('  Abrila desde Launchpad, Spotlight o el Finder.');
console.log('  La base de datos vive en ~/Library/Application Support/alfajores-erp/ y no se toco.\n');
