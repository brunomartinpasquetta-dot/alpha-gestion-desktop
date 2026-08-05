/**
 * Ciclo de vida de la aplicacion y apagado limpio.
 *
 * Concentra acá toda la interaccion con los eventos de `app` para que el
 * arranque (index.ts) quede legible y para tener un unico lugar donde
 * garantizar que al cerrar se libera el servidor HTTP y el archivo SQLite
 * (los .db-wal / .db-shm quedan huerfanos si no se cierra la conexion).
 */

import { app, BrowserWindow } from 'electron';

import { cerrarDb } from '../server/db/conexion';
import type { ServidorEnMarcha } from '../server/servidor';

/** Tiempo maximo que se espera al cierre del servidor antes de salir igual. */
const MS_TIMEOUT_APAGADO = 5000;

/** Banderas para que `before-quit` no entre en loop: el evento se dispara de nuevo al salir. */
let apagadoEnCurso = false;
let apagadoCompletado = false;

function registrar(mensaje: string): void {
  console.info(`[ciclo-vida] ${mensaje}`);
}

function describirError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Corre una promesa con techo de tiempo: un cierre colgado no puede trabar la salida. */
async function conTimeout(promesa: Promise<void>, ms: number, etiqueta: string): Promise<void> {
  let temporizador: NodeJS.Timeout | undefined;
  const limite = new Promise<void>((resolver) => {
    temporizador = setTimeout(() => {
      registrar(`${etiqueta}: se agoto el tiempo de espera (${ms} ms), se continua igual.`);
      resolver();
    }, ms);
  });
  try {
    await Promise.race([promesa, limite]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/** Apagado ordenado: primero se deja de atender HTTP, despues se suelta la base. */
async function apagar(obtenerServidor: () => ServidorEnMarcha | null): Promise<void> {
  const servidor = obtenerServidor();
  if (servidor) {
    try {
      await conTimeout(servidor.cerrar(), MS_TIMEOUT_APAGADO, 'cierre del servidor');
      registrar('Servidor HTTP cerrado.');
    } catch (error) {
      registrar(`No se pudo cerrar el servidor HTTP: ${describirError(error)}`);
    }
  }

  try {
    cerrarDb();
    registrar('Base de datos cerrada (WAL liberado).');
  } catch (error) {
    registrar(`No se pudo cerrar la base de datos: ${describirError(error)}`);
  }
}

/**
 * Handlers globales de errores: un error de query, un timeout o una promesa sin
 * catch NUNCA deben tumbar el proceso main (se llevarian puesta la ventana y la
 * sesion del operario). Se loguea y se sigue.
 */
function registrarGuardiasDeError(): void {
  process.on('uncaughtException', (error) => {
    console.error(`[main] Excepcion no capturada (la app sigue en pie): ${describirError(error)}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
  });

  process.on('unhandledRejection', (motivo) => {
    console.error(`[main] Promesa rechazada sin manejar (la app sigue en pie): ${describirError(motivo)}`);
  });
}

/**
 * Registra los eventos del ciclo de vida.
 *
 * @param obtenerServidor Devuelve el servidor en marcha (o null si todavia no arranco).
 * @param recrearVentana  Vuelve a crear la ventana principal; lo usa `activate` en macOS.
 */
export function registrarCicloVida(
  obtenerServidor: () => ServidorEnMarcha | null,
  recrearVentana?: () => void,
): void {
  registrarGuardiasDeError();

  // En macOS la convencion es que la app sigue viva sin ventanas (queda en el Dock).
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // macOS: click en el icono del Dock con la app abierta y sin ventanas.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) recrearVentana?.();
  });

  // `before-quit` es sincrono, pero el apagado es asincrono: se cancela la salida,
  // se limpia, y recien ahi se fuerza `app.exit()`.
  app.on('before-quit', (evento) => {
    if (apagadoCompletado) return;
    evento.preventDefault();
    if (apagadoEnCurso) return;

    apagadoEnCurso = true;
    registrar('Cerrando la aplicacion...');
    void apagar(obtenerServidor).finally(() => {
      apagadoCompletado = true;
      app.exit(0);
    });
  });

  // Señales del sistema (por ejemplo el orquestador de desarrollo al hacer Ctrl+C).
  const alRecibirSenal = (senal: string): void => {
    registrar(`Señal ${senal} recibida.`);
    app.quit();
  };
  process.on('SIGINT', () => alRecibirSenal('SIGINT'));
  process.on('SIGTERM', () => alRecibirSenal('SIGTERM'));
}
