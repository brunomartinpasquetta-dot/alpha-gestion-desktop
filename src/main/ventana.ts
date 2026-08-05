/**
 * Creacion y endurecimiento de la ventana principal.
 *
 * La ventana no decide QUE carga: recibe la URL ya resuelta por el proceso main
 * (dev server de Vite en desarrollo, servidor Fastify embebido en produccion).
 */

import path from 'node:path';

import { BrowserWindow, shell } from 'electron';

import { NOMBRE_PRODUCTO } from '../compartido/config';

/** Medidas pensadas para una pantalla de trabajo: tablas anchas de produccion y stock. */
const ANCHO_DEFAULT = 1440;
const ALTO_DEFAULT = 900;
const ANCHO_MINIMO = 1024;
const ALTO_MINIMO = 680;

/**
 * Neutro calido sobrio: evita el flash blanco puro mientras el renderer monta y
 * combina con la paleta de la UI (tonos tierra, no gris frio).
 */
const COLOR_FONDO = '#faf7f2';

export interface OpcionesVentana {
  /** URL a cargar (Vite en desarrollo, Fastify en produccion). */
  readonly url: string;
  /** Habilita DevTools automaticas. */
  readonly esDesarrollo: boolean;
}

/** Hosts considerados "propios": el renderer siempre vive en loopback. */
const HOSTS_PROPIOS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Decide si una URL pertenece al propio producto. Solo se permite navegar a
 * loopback (Vite/Fastify) o a archivos locales; cualquier otro origen se trata
 * como link externo y se abre en el navegador del sistema.
 */
function esOrigenPropio(url: string): boolean {
  try {
    const destino = new URL(url);
    if (destino.protocol === 'file:') return true;
    if (destino.protocol !== 'http:' && destino.protocol !== 'https:') return false;
    return HOSTS_PROPIOS.has(destino.hostname);
  } catch {
    return false;
  }
}

/** Abre en el navegador del sistema solo esquemas web; ignora el resto (seguridad). */
function abrirEnNavegadorDelSistema(url: string): void {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    void shell.openExternal(url);
  }
}

/**
 * Aplica el endurecimiento de seguridad sobre los webContents:
 *  - ninguna ventana nueva de Electron (los links externos van al navegador),
 *  - ninguna navegacion fuera del origen propio (evita que un link o un redirect
 *    convierta la ventana del ERP en un browser sin barra de direcciones).
 */
function endurecerVentana(ventana: BrowserWindow): void {
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    abrirEnNavegadorDelSistema(url);
    return { action: 'deny' };
  });

  ventana.webContents.on('will-navigate', (evento, url) => {
    if (esOrigenPropio(url)) return;
    evento.preventDefault();
    abrirEnNavegadorDelSistema(url);
  });

  // Un webview embebido seria un agujero: no se usan en este producto.
  ventana.webContents.on('will-attach-webview', (evento) => {
    evento.preventDefault();
  });
}

/** Crea la ventana principal del ERP, ya endurecida y con la URL cargada. */
export function crearVentanaPrincipal(opciones: OpcionesVentana): BrowserWindow {
  const ventana = new BrowserWindow({
    width: ANCHO_DEFAULT,
    height: ALTO_DEFAULT,
    minWidth: ANCHO_MINIMO,
    minHeight: ALTO_MINIMO,
    title: NOMBRE_PRODUCTO,
    backgroundColor: COLOR_FONDO,
    // Se muestra recien en 'ready-to-show': evita el flash blanco del arranque.
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // El renderer es codigo no privilegiado: sin Node, aislado y en sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // El preload compilado queda al lado de este archivo dentro de dist/main.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  endurecerVentana(ventana);

  ventana.once('ready-to-show', () => {
    ventana.show();
    if (opciones.esDesarrollo) {
      ventana.webContents.openDevTools({ mode: 'detach' });
    }
  });

  void ventana.loadURL(opciones.url);

  return ventana;
}
