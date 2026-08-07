/**
 * Gestor de ventanas de modulo.
 *
 * Cada modulo del ERP (Stock, Pedidos, Produccion...) abre como una
 * `BrowserWindow` NATIVA del sistema operativo, no como una ruta dentro de la
 * ventana principal. Eso permite tener varios modulos abiertos a la vez, moverlos
 * entre monitores y usarlos en paralelo, que es como se trabaja de verdad en una
 * fabrica: el encargado deja Pedidos abierto mientras carga una compra.
 *
 * La ventana principal conserva el chrome (menu, accesos, estado, barra de
 * tareas). Las de modulo cargan `#/embedded/<clave>`, que monta la pantalla sola,
 * sin chrome.
 *
 * El gestor mantiene el registro y avisa a la ventana principal cada vez que algo
 * cambia, para que la barra de tareas se mantenga sincronizada.
 */

import path from 'node:path';

import { BrowserWindow, shell } from 'electron';

/** Lo que la barra de tareas necesita saber de cada ventana abierta. */
export interface DescriptorVentana {
  readonly id: number;
  readonly clave: string;
  readonly titulo: string;
  readonly icono: string;
  readonly minimizada: boolean;
  readonly enfocada: boolean;
}

export interface SolicitudApertura {
  readonly clave: string;
  readonly titulo: string;
  readonly icono: string;
  /** Parametros opcionales que viajan en el querystring de la ruta embebida. */
  readonly params?: Readonly<Record<string, string>> | undefined;
}

interface VentanaModulo {
  readonly ventana: BrowserWindow;
  readonly clave: string;
  /** Clave + parametros: distingue dos comprobantes distintos. Ver identidadDe. */
  readonly identidad: string;
  readonly titulo: string;
  readonly icono: string;
}

const ANCHO_DEFAULT = 1180;
const ALTO_DEFAULT = 760;
/** Cada ventana nueva se corre un poco, para que no se tapen entre si. */
const DESPLAZAMIENTO = 26;

const abiertas = new Map<number, VentanaModulo>();

let urlBase = '';
let obtenerVentanaPrincipal: () => BrowserWindow | null = () => null;
let esDesarrollo = false;
let contadorAperturas = 0;

/** Configura el gestor. Se llama una vez, al terminar de arrancar el servidor. */
export function configurarGestorVentanas(opciones: {
  urlBase: string;
  esDesarrollo: boolean;
  obtenerPrincipal: () => BrowserWindow | null;
}): void {
  urlBase = opciones.urlBase;
  esDesarrollo = opciones.esDesarrollo;
  obtenerVentanaPrincipal = opciones.obtenerPrincipal;
}

export function listarVentanas(): DescriptorVentana[] {
  const descriptores: DescriptorVentana[] = [];
  for (const [id, registro] of abiertas) {
    if (registro.ventana.isDestroyed()) continue;
    descriptores.push({
      id,
      clave: registro.clave,
      titulo: registro.titulo,
      icono: registro.icono,
      minimizada: registro.ventana.isMinimized(),
      enfocada: registro.ventana.isFocused(),
    });
  }
  return descriptores;
}

/** Avisa a la ventana principal para que redibuje la barra de tareas. */
function notificarCambio(): void {
  const principal = obtenerVentanaPrincipal();
  if (principal && !principal.isDestroyed()) {
    principal.webContents.send('ventanas:cambio', listarVentanas());
  }
}

function construirUrl(clave: string, params?: Readonly<Record<string, string>>): string {
  const busqueda = new URLSearchParams(params ?? {}).toString();
  const sufijo = busqueda === '' ? '' : `?${busqueda}`;
  return `${urlBase}#/embedded/${encodeURIComponent(clave)}${sufijo}`;
}

/**
 * Identidad de una ventana a los efectos de no duplicarla. Para un modulo es su
 * clave; para una ventana que muestra UN documento (el comprobante de una venta)
 * es la clave MAS sus parametros, porque dos comprobantes distintos son dos
 * ventanas distintas: sin esto, imprimir una segunda venta reusaria la ventana
 * de la primera y mostraria el documento equivocado.
 */
function identidadDe(clave: string, params?: Readonly<Record<string, string>>): string {
  const entradas = Object.entries(params ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return entradas.length === 0 ? clave : `${clave}?${new URLSearchParams(entradas).toString()}`;
}

/**
 * Abre el modulo pedido. Si ya hay una ventana con la misma identidad, la trae
 * al frente en vez de duplicarla: dos ventanas del mismo modulo escribiendo lo
 * mismo solo genera confusion.
 */
export function abrirVentana(solicitud: SolicitudApertura): number {
  const identidad = identidadDe(solicitud.clave, solicitud.params);
  for (const [id, registro] of abiertas) {
    if (registro.identidad === identidad && !registro.ventana.isDestroyed()) {
      if (registro.ventana.isMinimized()) registro.ventana.restore();
      registro.ventana.focus();
      return id;
    }
  }

  const principal = obtenerVentanaPrincipal();
  const corrimiento = (contadorAperturas % 6) * DESPLAZAMIENTO;
  contadorAperturas += 1;

  const posicion = principal && !principal.isDestroyed() ? principal.getBounds() : null;

  const ventana = new BrowserWindow({
    // Ver Menu.setApplicationMenu(null) en index.ts: ademas se pide por ventana
    // porque en Windows la barra nativa se dibuja por ventana, no por app.
    autoHideMenuBar: true,
    width: ANCHO_DEFAULT,
    height: ALTO_DEFAULT,
    minWidth: 900,
    minHeight: 560,
    ...(posicion
      ? { x: posicion.x + 48 + corrimiento, y: posicion.y + 48 + corrimiento }
      : {}),
    title: solicitud.titulo,
    show: false,
    backgroundColor: '#faf7f2',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  ventana.once('ready-to-show', () => ventana.show());

  // Mismo endurecimiento que la ventana principal: los links externos van al
  // navegador del sistema y no se permite navegar fuera del propio origen.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const id = ventana.id;
  abiertas.set(id, {
    ventana,
    clave: solicitud.clave,
    identidad,
    titulo: solicitud.titulo,
    icono: solicitud.icono,
  });

  // Cada uno por separado: la firma de `on` es un overload por evento, asi que
  // un bucle sobre una union de nombres no tipa.
  ventana.on('focus', notificarCambio);
  ventana.on('blur', notificarCambio);
  ventana.on('minimize', notificarCambio);
  ventana.on('restore', notificarCambio);
  ventana.on('closed', () => {
    abiertas.delete(id);
    notificarCambio();
  });

  void ventana.loadURL(construirUrl(solicitud.clave, solicitud.params));
  if (esDesarrollo) ventana.webContents.openDevTools({ mode: 'detach' });

  notificarCambio();
  return id;
}

export function cerrarVentana(id: number): void {
  const registro = abiertas.get(id);
  if (registro && !registro.ventana.isDestroyed()) registro.ventana.close();
}

export function minimizarVentana(id: number): void {
  const registro = abiertas.get(id);
  if (!registro || registro.ventana.isDestroyed()) return;
  if (registro.ventana.isMinimized()) registro.ventana.restore();
  else registro.ventana.minimize();
  notificarCambio();
}

/** Trae la ventana al frente; si estaba minimizada, la restaura. */
export function enfocarVentana(id: number): void {
  const registro = abiertas.get(id);
  if (!registro || registro.ventana.isDestroyed()) return;
  if (registro.ventana.isMinimized()) registro.ventana.restore();
  registro.ventana.focus();
  notificarCambio();
}

/** Cierra todas las ventanas de modulo. Se usa al salir de la aplicacion. */
export function cerrarTodas(): void {
  for (const registro of abiertas.values()) {
    if (!registro.ventana.isDestroyed()) registro.ventana.destroy();
  }
  abiertas.clear();
}
