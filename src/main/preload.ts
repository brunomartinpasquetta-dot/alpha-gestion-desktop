/**
 * Preload del proceso renderer.
 *
 * Corre con `sandbox: true` y `contextIsolation: true`, asi que solo puede usar
 * el modulo `electron` y el subconjunto de `process` que Electron expone en el
 * sandbox (platform, versions, env). NO se puede hacer require de archivos del
 * proyecto (por eso no se importa nada de src/compartido) ni de `fs`.
 *
 * Regla que no se rompe: NUNCA se expone `ipcRenderer` crudo al renderer. Cada
 * canal se declara uno por uno, con su firma explicita, y los argumentos se
 * normalizan aca antes de cruzar el puente.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Fallback de version por si el proceso main no llego a publicar la variable de
 * entorno. Debe coincidir con VERSION_APP de src/compartido/config.ts (no se
 * puede importar desde un preload sandboxeado).
 */
const VERSION_FALLBACK = '0.1.0';

function leerVersion(): string {
  const desdeEntorno = process.env?.['ALFAJORES_VERSION'];
  if (typeof desdeEntorno === 'string' && desdeEntorno.trim() !== '') return desdeEntorno.trim();
  return VERSION_FALLBACK;
}

/** Descriptor de una ventana de modulo abierta, tal como lo ve la barra de tareas. */
export interface DescriptorVentana {
  readonly id: number;
  readonly clave: string;
  readonly titulo: string;
  readonly icono: string;
  readonly minimizada: boolean;
  readonly enfocada: boolean;
}

/** Solo se dejan pasar strings: nada de objetos arbitrarios cruzando el puente. */
function normalizarParams(params: unknown): Record<string, string> {
  if (typeof params !== 'object' || params === null) return {};
  const limpio: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(params as Record<string, unknown>)) {
    if (typeof valor === 'string') limpio[clave] = valor;
    else if (typeof valor === 'number' && Number.isFinite(valor)) limpio[clave] = String(valor);
  }
  return limpio;
}

function comoEntero(valor: unknown): number {
  return typeof valor === 'number' && Number.isInteger(valor) ? valor : -1;
}

const ventanas = {
  abrir(clave: string, titulo: string, icono: string, params?: unknown): void {
    ipcRenderer.send('ventanas:abrir', {
      clave: String(clave),
      titulo: String(titulo),
      icono: String(icono),
      params: normalizarParams(params),
    });
  },
  cerrar(id: number): void {
    ipcRenderer.send('ventanas:cerrar', comoEntero(id));
  },
  minimizar(id: number): void {
    ipcRenderer.send('ventanas:minimizar', comoEntero(id));
  },
  enfocar(id: number): void {
    ipcRenderer.send('ventanas:enfocar', comoEntero(id));
  },
  listar(): Promise<DescriptorVentana[]> {
    return ipcRenderer.invoke('ventanas:listar') as Promise<DescriptorVentana[]>;
  },
  /** Se suscribe a los cambios. Devuelve la funcion para desuscribirse. */
  alCambiar(callback: (lista: DescriptorVentana[]) => void): () => void {
    const manejador = (_evento: unknown, lista: DescriptorVentana[]): void => callback(lista);
    ipcRenderer.on('ventanas:cambio', manejador);
    return () => {
      ipcRenderer.removeListener('ventanas:cambio', manejador);
    };
  },
  /** Cierra la ventana de modulo en la que corre este renderer. */
  cerrarme(): void {
    ipcRenderer.send('ventanas:cerrarme');
  },
} as const;

/**
 * Abre el selector de archivo del sistema. `extensiones` sin punto ('crt', 'key').
 * Devuelve la ruta absoluta elegida, o null si el usuario cancelo.
 */
const archivos = {
  elegir(titulo: string, extensiones: readonly string[]): Promise<string | null> {
    return ipcRenderer.invoke('archivo:elegir', {
      titulo: String(titulo),
      extensiones: extensiones.map((e) => String(e)),
    }) as Promise<string | null>;
  },
} as const;

/** API disponible en el renderer como `window.alfajores`. */
export interface ApiAlfajores {
  readonly version: string;
  readonly plataforma: string;
  readonly ventanas: typeof ventanas;
  readonly archivos: typeof archivos;
}

const api: ApiAlfajores = Object.freeze({
  version: leerVersion(),
  plataforma: process.platform,
  ventanas,
  archivos,
});

contextBridge.exposeInMainWorld('alfajores', api);
