#!/usr/bin/env node
/**
 * Orquestador de desarrollo del ERP.
 *
 * Hace, en orden: compila el codigo Node (main + server + seed), levanta Vite,
 * espera a que el puerto del dev server responda, y recien ahi arranca Electron.
 * Cuando Electron termina (o se hace Ctrl+C) mata a Vite: nada de procesos
 * huerfanos ocupando el 5173.
 *
 * Sin dependencias extra a proposito (ni concurrently, ni wait-on, ni nodemon):
 * solo modulos nativos de Node.
 */

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// --- Constantes (espejo de src/compartido/config.ts, que no se puede importar desde .mjs) ---
const HOST_DEV = '127.0.0.1';
const PUERTO_VITE = 5173;
const PUERTO_SERVIDOR = 4600;
const URL_VITE = `http://${HOST_DEV}:${PUERTO_VITE}`;

/** Tiempo maximo de espera a que Vite acepte conexiones. */
const MS_ESPERA_VITE = 30_000;
const MS_ENTRE_INTENTOS = 300;

/** Raiz del repo: este archivo vive en <raiz>/scripts/dev.mjs. */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** En Windows los binarios de npm son .cmd. */
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// --- Utilidades de consola ---------------------------------------------------

function log(mensaje) {
  console.log(`\x1b[36m[dev]\x1b[0m ${mensaje}`);
}

function error(mensaje) {
  console.error(`\x1b[31m[dev]\x1b[0m ${mensaje}`);
}

function encabezado() {
  console.log('');
  console.log('\x1b[1m  Alpha Gestion - entorno de desarrollo\x1b[0m');
  console.log(`  Renderer (Vite):  ${URL_VITE}`);
  console.log(`  API (Fastify):    http://${HOST_DEV}:${PUERTO_SERVIDOR}`);
  console.log('  Ctrl+C para cortar todo.');
  console.log('');
}

// --- Manejo de procesos hijos ------------------------------------------------

/** @type {import('node:child_process').ChildProcess | null} */
let procesoVite = null;
/** @type {import('node:child_process').ChildProcess | null} */
let procesoElectron = null;
let cerrando = false;

/** Mata un hijo con SIGTERM y, si se resiste, lo remata con SIGKILL. */
function matarProceso(hijo, nombre) {
  if (!hijo || hijo.exitCode !== null || hijo.signalCode !== null) return;
  log(`Cerrando ${nombre}...`);
  hijo.kill('SIGTERM');
  const remate = setTimeout(() => {
    if (hijo.exitCode === null && hijo.signalCode === null) hijo.kill('SIGKILL');
  }, 3000);
  // No mantener vivo el event loop solo por el temporizador de remate.
  remate.unref();
}

/** Corta todo y sale con el codigo indicado. */
function terminar(codigo) {
  if (cerrando) return;
  cerrando = true;
  matarProceso(procesoElectron, 'Electron');
  matarProceso(procesoVite, 'Vite');
  // Pequeño margen para que los hijos cierren antes de que muera el padre.
  setTimeout(() => process.exit(codigo), 150);
}

// --- Pasos -------------------------------------------------------------------

/** Paso 1: compilar main + server + seed a dist/ (Electron consume JS, no TS). */
function compilarNode() {
  log('Compilando TypeScript (main + server + seed)...');
  const resultado = spawnSync(NPX, ['tsc', '-p', 'tsconfig.node.json'], {
    cwd: RAIZ,
    stdio: 'inherit',
    env: process.env,
  });

  if (resultado.error) {
    error(`No se pudo ejecutar tsc: ${resultado.error.message}`);
    process.exit(1);
  }
  if (resultado.status !== 0) {
    error('La compilacion de TypeScript fallo. Corregi los errores de arriba y volve a intentar.');
    process.exit(1);
  }
  log('Compilacion lista.');
}

/** Paso 2: arrancar el dev server de Vite. */
function arrancarVite() {
  log('Levantando Vite...');
  procesoVite = spawn(NPX, ['vite'], {
    cwd: RAIZ,
    stdio: 'inherit',
    env: process.env,
  });

  procesoVite.on('error', (err) => {
    error(`No se pudo ejecutar Vite: ${err.message}`);
    terminar(1);
  });

  procesoVite.on('exit', (codigo, senal) => {
    procesoVite = null;
    if (cerrando) return;
    error(`Vite se cerro inesperadamente (codigo ${codigo ?? senal}).`);
    terminar(typeof codigo === 'number' ? codigo : 1);
  });
}

/** Un intento de conexion TCP al puerto: resuelve true si alguien atiende. */
function puertoResponde(puerto, host) {
  return new Promise((resolver) => {
    const socket = net.connect({ port: puerto, host });
    const cerrar = (respuesta) => {
      socket.removeAllListeners();
      socket.destroy();
      resolver(respuesta);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => cerrar(true));
    socket.once('timeout', () => cerrar(false));
    socket.once('error', () => cerrar(false));
  });
}

const dormir = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** Paso 3: esperar a que Vite acepte conexiones (o rendirse). */
async function esperarVite() {
  log(`Esperando a que ${URL_VITE} responda...`);
  const limite = Date.now() + MS_ESPERA_VITE;

  while (Date.now() < limite) {
    if (cerrando) return false;
    if (await puertoResponde(PUERTO_VITE, HOST_DEV)) {
      log('Vite listo.');
      return true;
    }
    await dormir(MS_ENTRE_INTENTOS);
  }

  error(`Vite no respondio en ${MS_ESPERA_VITE / 1000} segundos. Se cancela el arranque.`);
  return false;
}

/** Paso 4: arrancar Electron apuntando al dev server. */
function arrancarElectron() {
  log('Arrancando Electron...');

  // Algunos entornos (terminales integradas de editores basados en Electron,
  // como VSCode) exportan ELECTRON_RUN_AS_NODE=1 a los procesos hijos. Si esa
  // variable llega hasta aca, Electron arranca como Node puro: `require('electron')`
  // no devuelve el modulo nativo y el proceso main muere con
  // "Cannot read properties of undefined (reading 'setName')". La sacamos siempre.
  const entorno = { ...process.env };
  delete entorno.ELECTRON_RUN_AS_NODE;

  procesoElectron = spawn(NPX, ['electron', '.'], {
    cwd: RAIZ,
    stdio: 'inherit',
    env: {
      ...entorno,
      NODE_ENV: 'development',
      ALFAJORES_VITE_URL: URL_VITE,
      ALFAJORES_PUERTO: String(PUERTO_SERVIDOR),
    },
  });

  procesoElectron.on('error', (err) => {
    error(`No se pudo ejecutar Electron: ${err.message}`);
    terminar(1);
  });

  procesoElectron.on('exit', (codigo, senal) => {
    procesoElectron = null;
    log(`Electron termino (codigo ${codigo ?? senal}).`);
    terminar(typeof codigo === 'number' ? codigo : 0);
  });
}

// --- Señales -----------------------------------------------------------------

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    console.log('');
    log(`Señal ${senal} recibida, cerrando todo...`);
    terminar(0);
  });
}

// --- Main --------------------------------------------------------------------

async function main() {
  encabezado();
  compilarNode();
  arrancarVite();

  if (!(await esperarVite())) {
    terminar(1);
    return;
  }

  arrancarElectron();
}

main().catch((err) => {
  error(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  terminar(1);
});
