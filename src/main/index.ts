/**
 * Proceso main de Electron: orquestador del arranque del ERP.
 *
 * Secuencia (cada paso puede abortar el arranque con un cartel en español):
 *   1. Nombre de la app  -> define la carpeta userData donde vive la base.
 *   2. Instancia unica   -> una sola copia del ERP tocando el mismo SQLite.
 *   3. app.whenReady()
 *   4. Migraciones       -> sin schema no hay ERP.
 *   5. Servidor Fastify  -> la API (y en produccion tambien el renderer).
 *   6. Ventana principal.
 */

import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';

import { NOMBRE_APP, NOMBRE_PRODUCTO, VERSION_APP } from '../compartido/config';
import { leerConfig } from '../server/config';
import { aplicarMigraciones } from '../server/db/migraciones';
import { suscribirLocal } from '../server/eventos';
import { iniciarServidor, type ServidorEnMarcha } from '../server/servidor';
import {
  abrirPaginaDeDescarga,
  iniciarActualizador,
  instalarYReiniciar,
  verificarActualizacionesAhora,
} from './actualizador';
import {
  abrirVentana,
  cerrarTodas,
  cerrarVentana,
  configurarGestorVentanas,
  enfocarVentana,
  listarVentanas,
  minimizarVentana,
  type SolicitudApertura,
} from './gestor-ventanas';
import { registrarCicloVida } from './ciclo-vida';
import { crearVentanaPrincipal } from './ventana';

// El nombre visible (menu del sistema, dialogos) es el comercial.
app.setName(NOMBRE_PRODUCTO);

// Pero la carpeta de datos NO sigue al nombre comercial: se fija al identificador
// interno. Por defecto Electron derivaria userData de app.getName(), asi que
// renombrar el producto mudaria la base de datos de todas las instalaciones ya
// hechas. Fijandola explicitamente, el nombre puede cambiar sin tocar los datos.
// Tiene que ir ANTES de cualquier lectura de userData: migraciones, seed y
// servidor dependen de que apunten todos al mismo archivo.
app.setPath('userData', path.join(app.getPath('appData'), NOMBRE_APP));

// El preload corre en sandbox y no puede importar src/compartido: se le pasa la
// version por entorno (los procesos hijos heredan el env del main).
process.env['ALFAJORES_VERSION'] = VERSION_APP;

/** true cuando corremos desde el repo (dev), false en la app empaquetada. */
const esDesarrollo = !app.isPackaged;

// En la app instalada no hay nadie que exporte NODE_ENV, y sin esto el servidor
// se creeria en desarrollo: logs verbosos y /health informando el entorno
// equivocado. Se respeta un valor explicito si alguien lo forzo a proposito.
if (!esDesarrollo && process.env['NODE_ENV'] === undefined) {
  process.env['NODE_ENV'] = 'production';
}

/** URL del dev server de Vite, inyectada por scripts/dev.mjs. */
const urlVite = process.env['ALFAJORES_VITE_URL']?.trim() ?? '';

let servidorActual: ServidorEnMarcha | null = null;
let ventanaPrincipal: BrowserWindow | null = null;

function registrar(mensaje: string): void {
  console.info(`[main] ${mensaje}`);
}

function describirError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Muestra un cartel de error fatal en español y termina el proceso. */
function abortarConError(titulo: string, mensaje: string): void {
  console.error(`[main] ${titulo}\n${mensaje}`);
  dialog.showErrorBox(titulo, mensaje);
  app.exit(1);
}

/**
 * Carpeta con el renderer compilado, servida por Fastify en produccion.
 * Este archivo vive en dist/main/, el build de Vite en dist/renderer/.
 */
function resolverCarpetaRenderer(): string {
  return path.join(__dirname, '..', 'renderer');
}

/** Crea la ventana principal si todavia no hay ninguna. Reusable desde 'activate'. */
function crearVentana(): void {
  if (ventanaPrincipal && !ventanaPrincipal.isDestroyed()) {
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
    ventanaPrincipal.focus();
    return;
  }

  const servidor = servidorActual;
  if (!servidor) {
    registrar('No se puede crear la ventana: el servidor todavia no esta en marcha.');
    return;
  }

  // DECISION DE ARQUITECTURA (renderer y API en el mismo origen):
  //  - En desarrollo la ventana carga el dev server de Vite (HMR). Vite proxea
  //    /health y /api al Fastify de 4600, asi que el renderer siempre usa rutas
  //    relativas y no necesita saber donde vive la API.
  //  - En produccion la ventana carga la URL del propio Fastify, que ademas sirve
  //    el renderer compilado. Renderer y API quedan same-origin: no hace falta
  //    CORS, no hay preflights, y las cookies/headers de sesion viajan solas.
  //    (Por eso NO se usa file:// para cargar el build.)
  const url = esDesarrollo && urlVite !== '' ? urlVite : servidor.url;
  registrar(`Cargando la interfaz desde ${url}`);

  const ventana = crearVentanaPrincipal({ url, esDesarrollo });
  ventana.on('closed', () => {
    ventanaPrincipal = null;
  });
  ventanaPrincipal = ventana;
}

/** Paso 4: migraciones. Devuelve false si el arranque debe abortarse. */
function prepararBaseDeDatos(): boolean {
  try {
    const resultado = aplicarMigraciones();
    registrar(`Base de datos lista en ${resultado.rutaDb}`);
    registrar(`Migraciones aplicadas desde ${resultado.carpetaMigraciones}`);
    return true;
  } catch (error) {
    abortarConError(
      'No se pudo preparar la base de datos',
      [
        'El ERP no puede arrancar porque falló la actualización de la base de datos.',
        '',
        `Detalle: ${describirError(error)}`,
        '',
        'Verificá que el archivo de la base no esté abierto por otro programa y que',
        'la carpeta de datos tenga permisos de escritura.',
      ].join('\n'),
    );
    return false;
  }
}

/** Paso 5: servidor Fastify embebido. Devuelve null si el arranque debe abortarse. */
async function prepararServidor(): Promise<ServidorEnMarcha | null> {
  const config = leerConfig();

  // En desarrollo el renderer lo sirve Vite (null); en produccion lo sirve Fastify.
  const carpetaEstaticos = esDesarrollo && urlVite !== '' ? null : resolverCarpetaRenderer();

  try {
    const servidor = await iniciarServidor({
      puerto: config.puerto,
      host: config.host,
      carpetaEstaticos,
    });
    registrar(`Servidor escuchando en ${servidor.url}`);

    // El servidor se corre de puerto si el elegido esta ocupado. En desarrollo eso
    // rompe el proxy de Vite (que apunta fijo al puerto por defecto): avisamos.
    if (servidor.puerto !== config.puerto && esDesarrollo && urlVite !== '') {
      registrar(
        `ATENCION: el puerto ${config.puerto} estaba ocupado y el servidor quedo en ${servidor.puerto}. ` +
          'El proxy de Vite apunta al puerto por defecto: cerra el proceso que lo ocupa y volve a arrancar.',
      );
    }

    return servidor;
  } catch (error) {
    abortarConError(
      'No se pudo iniciar el servidor interno',
      [
        'El ERP no puede arrancar porque el servidor interno no pudo levantar.',
        '',
        `Detalle: ${describirError(error)}`,
        '',
        `Puede que el puerto ${config.puerto} esté ocupado por otro programa`,
        '(o por otra copia del ERP que quedó abierta).',
      ].join('\n'),
    );
    return null;
  }
}

/** Secuencia completa de arranque. */
/**
 * Canales IPC de ventanas. Se registran una sola vez. Los argumentos ya vienen
 * normalizados desde el preload, pero igual se validan: el proceso main no
 * confia en lo que llega del renderer.
 */
function registrarCanalesDeVentanas(): void {
  ipcMain.on('ventanas:abrir', (_evento, solicitud: unknown) => {
    if (typeof solicitud !== 'object' || solicitud === null) return;
    const { clave, titulo, icono, params } = solicitud as Partial<SolicitudApertura>;
    if (typeof clave !== 'string' || clave === '') return;
    abrirVentana({
      clave,
      titulo: typeof titulo === 'string' && titulo !== '' ? titulo : clave,
      icono: typeof icono === 'string' ? icono : 'ventana',
      params: typeof params === 'object' && params !== null ? params : undefined,
    });
  });

  ipcMain.on('ventanas:cerrar', (_evento, id: unknown) => {
    if (typeof id === 'number') cerrarVentana(id);
  });
  ipcMain.on('ventanas:minimizar', (_evento, id: unknown) => {
    if (typeof id === 'number') minimizarVentana(id);
  });
  ipcMain.on('ventanas:enfocar', (_evento, id: unknown) => {
    if (typeof id === 'number') enfocarVentana(id);
  });

  // La ventana de modulo se cierra a si misma: el id sale del emisor, no de un
  // argumento, asi una ventana no puede cerrar a otra.
  ipcMain.on('ventanas:cerrarme', (evento) => {
    BrowserWindow.fromWebContents(evento.sender)?.close();
  });

  ipcMain.handle('ventanas:listar', () => listarVentanas());

  // WhatsApp (copiado de StockFlow): cualquier ventana pide abrir el chat de
  // un numero ya normalizado; la principal se trae al frente y el panel
  // embebido navega a esa conversacion.
  // Reiniciar el programa (tras restaurar un respaldo): las migraciones y la
  // conexion arrancan de cero sobre la base restaurada.
  ipcMain.on('app:reiniciar', () => {
    app.relaunch();
    app.exit(0);
  });

  ipcMain.on('whatsapp:abrir-chat', (_evento, telefono: unknown) => {
    if (typeof telefono !== 'string' || telefono === '') return;
    if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) return;
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
    ventanaPrincipal.show();
    ventanaPrincipal.focus();
    ventanaPrincipal.webContents.send('whatsapp:navegar', telefono);
  });

  // Los eventos del negocio viajan por IPC, no por HTTP: ver eventos.ts.
  suscribirLocal((tipo) => {
    for (const ventana of BrowserWindow.getAllWindows()) {
      if (!ventana.isDestroyed()) ventana.webContents.send('eventos:negocio', tipo);
    }
  });

  /**
   * Selector de archivo nativo. Existe por el certificado de ARCA: escribir a
   * mano `C:\\Users\\...\\certificado.crt` es una fuente de errores que despues
   * aparecen como un rechazo incomprensible de ARCA. Devuelve la ruta elegida o
   * null si el usuario cancelo.
   */
  // Chequeo de actualizaciones a pedido, desde el menu de Ayuda.
  ipcMain.handle('actualizador:verificar', () => verificarActualizacionesAhora());
  ipcMain.on('actualizador:abrir-descargas', () => abrirPaginaDeDescarga());
  ipcMain.on('actualizador:instalar', () => instalarYReiniciar());

  ipcMain.handle('archivo:elegir', async (evento, solicitud: unknown) => {
    const { titulo, extensiones } = (solicitud ?? {}) as {
      titulo?: unknown;
      extensiones?: unknown;
    };
    const ventana = BrowserWindow.fromWebContents(evento.sender);
    const filtros =
      Array.isArray(extensiones) && extensiones.every((e) => typeof e === 'string')
        ? [{ name: 'Archivos permitidos', extensions: extensiones as string[] }]
        : [];

    const opciones = {
      title: typeof titulo === 'string' ? titulo : 'Elegir archivo',
      properties: ['openFile' as const],
      filters: [...filtros, { name: 'Todos los archivos', extensions: ['*'] }],
    };
    const resultado =
      ventana === null
        ? await dialog.showOpenDialog(opciones)
        : await dialog.showOpenDialog(ventana, opciones);

    return resultado.canceled ? null : (resultado.filePaths[0] ?? null);
  });
}

async function arrancar(): Promise<void> {
  await app.whenReady();

  // Sin menu de aplicacion. En Windows, Electron dibuja por defecto una barra
  // "File / Edit / View / Window" en CADA ventana: son acciones del navegador
  // que no significan nada en un ERP y ensucian todas las ventanas de modulo.
  // La navegacion del sistema vive en su propia barra, dentro de la ventana.
  Menu.setApplicationMenu(null);

  if (!prepararBaseDeDatos()) return;

  const servidor = await prepararServidor();
  if (!servidor) return;
  servidorActual = servidor;

  // El gestor necesita la URL base para armar las rutas #/embedded de cada modulo.
  configurarGestorVentanas({
    urlBase: esDesarrollo && urlVite !== '' ? urlVite : servidor.url,
    esDesarrollo,
    obtenerPrincipal: () => ventanaPrincipal,
  });
  registrarCanalesDeVentanas();

  crearVentana();

  // Despues de la ventana: si hay una actualizacion, el aviso necesita un
  // renderer vivo al que mandarselo.
  iniciarActualizador();

  registrar(`${NOMBRE_PRODUCTO} ${VERSION_APP} listo (${esDesarrollo ? 'desarrollo' : 'produccion'}).`);
}

// Instancia unica: dos procesos escribiendo el mismo SQLite es pedir problemas.
const obtuvoBloqueo = app.requestSingleInstanceLock();

if (!obtuvoBloqueo) {
  registrar('Ya hay una instancia del ERP abierta. Se cierra esta copia.');
  app.quit();
} else {
  // La segunda copia avisa a esta antes de morir: traemos la ventana al frente.
  app.on('second-instance', () => {
    if (!ventanaPrincipal || ventanaPrincipal.isDestroyed()) {
      crearVentana();
      return;
    }
    if (ventanaPrincipal.isMinimized()) ventanaPrincipal.restore();
    ventanaPrincipal.show();
    ventanaPrincipal.focus();
  });

  // Al salir, las ventanas de modulo se destruyen primero: si quedan vivas,
  // 'window-all-closed' no se dispara nunca y la app queda colgada.
  app.on('before-quit', cerrarTodas);

  registrarCicloVida(() => servidorActual, crearVentana);

  void arrancar().catch((error: unknown) => {
    abortarConError(
      'Error inesperado al iniciar',
      `El ERP no pudo completar el arranque.\n\nDetalle: ${describirError(error)}`,
    );
  });
}
