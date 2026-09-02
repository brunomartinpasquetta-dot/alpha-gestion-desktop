/**
 * Creacion y endurecimiento de la ventana principal.
 *
 * La ventana no decide QUE carga: recibe la URL ya resuelta por el proceso main
 * (dev server de Vite en desarrollo, servidor Fastify embebido en produccion).
 */

import path from 'node:path';

import { BrowserWindow, screen, shell, type BrowserWindowConstructorOptions } from 'electron';

import {
  ALTO_BARRA_TITULO,
  COLOR_BARRA_TITULO,
  COLOR_SIMBOLOS_BARRA,
  NOMBRE_PRODUCTO,
} from '../compartido/config';

/** Medidas pensadas para una pantalla de trabajo: tablas anchas de produccion y stock. */
const ANCHO_DEFAULT = 1440;
const ALTO_DEFAULT = 900;
const ANCHO_MINIMO = 1024;
const ALTO_MINIMO = 680;

/**
 * Tamanio que de verdad entra en ESTA pantalla.
 *
 * Los valores de arriba son para un monitor grande. En el de la fabrica
 * (1366x768) una ventana de 1440x900 no entra: Windows la recorta y el sistema
 * se ve cortado por abajo y por la derecha. Se toma el area util —descontando
 * la barra de tareas— y se usa lo que sea mas chico.
 */
function tamanioQueEntra(ancho: number, alto: number): { width: number; height: number } {
  try {
    const util = screen.getPrimaryDisplay().workAreaSize;
    return {
      width: Math.min(ancho, util.width),
      height: Math.min(alto, util.height),
    };
  } catch {
    return { width: ancho, height: alto };
  }
}

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
function endurecerVentana(
  ventana: BrowserWindow,
  opciones?: { readonly permitirWhatsApp?: boolean },
): void {
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    abrirEnNavegadorDelSistema(url);
    return { action: 'deny' };
  });

  ventana.webContents.on('will-navigate', (evento, url) => {
    if (esOrigenPropio(url)) return;
    evento.preventDefault();
    abrirEnNavegadorDelSistema(url);
  });

  // Webviews embebidos: bloqueados, con UNA excepcion controlada. La ventana
  // principal aloja el panel de WhatsApp Web (copiado de StockFlow); ese guest
  // se deja adjuntar SOLO si apunta a web.whatsapp.com, sin preload y aislado.
  ventana.webContents.on('will-attach-webview', (evento, webPreferences, params) => {
    const src = String((params as { src?: unknown }).src ?? '');
    if (opciones?.permitirWhatsApp === true && src.startsWith('https://web.whatsapp.com')) {
      delete (webPreferences as { preload?: string }).preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      return;
    }
    evento.preventDefault();
  });
}

/**
 * Opciones que convierten la barra marron del renderer en LA barra de titulo de
 * la ventana. Se aplican a TODAS las ventanas visibles (principal y modulos):
 * si un modulo abriera con la barra gris del sistema, la app se veria partida
 * en dos identidades.
 *
 *   Mac     -> 'hidden' + titleBarOverlay { height }. Los semaforos siguen
 *              visibles y Electron los CENTRA solo dentro de esos 32px. Por eso
 *              NO se usa `trafficLightPosition`: pasarlo desactiva el centrado.
 *   Windows -> 'hidden' + titleBarOverlay con color: Windows sigue dibujando
 *              minimizar/maximizar/cerrar (con 'hidden' a secas DESAPARECEN) y
 *              nosotros se los pintamos del marron de marca.
 *
 * NO se usa `frame: false`: se perderian los Snap Layouts de Win11, el doble
 * clic para maximizar y el menu del clic derecho.
 */
export function opcionesBarraTitulo(): Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'titleBarOverlay'
> {
  return process.platform === 'darwin'
    ? { titleBarStyle: 'hidden', titleBarOverlay: { height: ALTO_BARRA_TITULO } }
    : {
        titleBarStyle: 'hidden',
        titleBarOverlay: {
          color: COLOR_BARRA_TITULO,
          symbolColor: COLOR_SIMBOLOS_BARRA,
          height: ALTO_BARRA_TITULO,
        },
      };
}

/** Crea la ventana principal del ERP, ya endurecida y con la URL cargada. */
export function crearVentanaPrincipal(opciones: OpcionesVentana): BrowserWindow {
  const ventana = new BrowserWindow({
    ...tamanioQueEntra(ANCHO_DEFAULT, ALTO_DEFAULT),
    minWidth: ANCHO_MINIMO,
    minHeight: ALTO_MINIMO,
    title: NOMBRE_PRODUCTO,
    backgroundColor: COLOR_FONDO,
    // Se muestra recien en 'ready-to-show': evita el flash blanco del arranque.
    show: false,
    autoHideMenuBar: true,
    ...opcionesBarraTitulo(),
    webPreferences: {
      // El renderer es codigo no privilegiado: sin Node, aislado y en sandbox.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // El panel de WhatsApp embebido (copiado de StockFlow) usa <webview> con
      // sesion persistente. Solo la ventana principal lo necesita.
      webviewTag: true,
      // El preload compilado queda al lado de este archivo dentro de dist/main.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  endurecerVentana(ventana, { permitirWhatsApp: true });

  ventana.once('ready-to-show', () => {
    ventana.show();
    if (opciones.esDesarrollo) {
      ventana.webContents.openDevTools({ mode: 'detach' });
    }
  });

  void ventana.loadURL(opciones.url);

  return ventana;
}
