/**
 * Punto de entrada REAL de la app. Existe por una sola razon: que ningun error
 * vuelva a aparecer como el cartel critico "A JavaScript error occurred in the
 * main process".
 *
 * Ese cartel aparece cuando algo falla al CARGAR el codigo (un require de un
 * binario nativo roto, por ejemplo), que es antes de que cualquier try/catch de
 * index.ts pueda correr. Paso real: el instalador de Windows viajo con un bcrypt
 * compilado para Mac, la carga murio y el cliente vio un error indescifrable sin
 * ninguna pista.
 *
 * Este archivo no importa NADA del resto del sistema (si el resto esta roto,
 * el tiene que sobrevivir para contarlo): registra el capturador, y recien
 * despues carga la app de verdad. Todo error termina en un cartel en espanol
 * y en {appData}/alfajores-erp/errores.log, que es lo que se le puede pedir al
 * cliente por telefono.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { app, dialog } from 'electron';

// Copiada de compartido/config a proposito: si ese modulo no carga, este igual.
const CARPETA_DATOS = 'alfajores-erp';

function rutaLog(): string {
  const carpeta = path.join(app.getPath('appData'), CARPETA_DATOS);
  mkdirSync(carpeta, { recursive: true });
  return path.join(carpeta, 'errores.log');
}

function anotarYAvisar(origen: string, error: unknown): void {
  const detalle =
    error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);

  let ruta = '(no se pudo escribir el log)';
  try {
    ruta = rutaLog();
    appendFileSync(ruta, `[${new Date().toISOString()}] ${origen}\n${detalle}\n\n`, 'utf8');
  } catch {
    // Sin log no se pierde el cartel.
  }

  // showErrorBox es la unica ventana permitida antes de app.whenReady().
  dialog.showErrorBox(
    'Alpha Gestion no pudo arrancar',
    [
      'Ocurrio un error al iniciar el programa.',
      '',
      `Detalle tecnico: ${error instanceof Error ? error.message : String(error)}`,
      '',
      `Quedo anotado en: ${ruta}`,
      'Mandale ese archivo (o una foto de este cartel) a BPSG Sistemas.',
    ].join('\n'),
  );
  app.exit(1);
}

/*
 * Este guardia es SOLO PARA EL ARRANQUE. Node ejecuta todos los handlers de
 * uncaughtException registrados, en orden, y este se registra primero: como
 * termina en app.exit(1), se llevaba puesta la aplicacion ante cualquier
 * excepcion no capturada del resto de la sesion —un throw dentro de un listener
 * de ipcMain, un "Object has been destroyed" al escribir en una ventana recien
 * cerrada— y el guardia de ciclo-vida.ts, que existe justamente para que la app
 * NO se caiga por eso, nunca llegaba a correr: era codigo muerto.
 *
 * Una vez que la app esta lista, este handler se hace a un lado. Antes de eso
 * si tiene que matar el proceso: sin ventana ni base no hay nada que sostener,
 * y el cartel es lo unico que le explica al operador que paso.
 */
process.on('uncaughtException', (error) => {
  if (app.isReady()) return;
  anotarYAvisar('uncaughtException', error);
});

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./index');
} catch (error) {
  anotarYAvisar('carga de la aplicacion', error);
}
