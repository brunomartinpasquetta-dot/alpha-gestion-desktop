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

const eventos = {
  /** Avisa cuando cambia algo del negocio. Devuelve la funcion de baja. */
  alCambiar(manejador: (tipo: string) => void): () => void {
    const puente = (_evento: unknown, tipo: unknown): void => {
      if (typeof tipo === 'string') manejador(tipo);
    };
    ipcRenderer.on('eventos:negocio', puente);
    return () => {
      ipcRenderer.removeListener('eventos:negocio', puente);
    };
  },
} as const;

const impresion = {
  listar(): Promise<{ nombre: string; descripcion: string; pordefecto: boolean }[]> {
    return ipcRenderer.invoke('impresion:listar') as Promise<
      { nombre: string; descripcion: string; pordefecto: boolean }[]
    >;
  },
  ticket(
    impresora: string,
    lineas: readonly { texto: string; grande?: boolean; negrita?: boolean; centrado?: boolean; separador?: boolean }[],
  ): Promise<{ ok: boolean; error?: string }> {
    return ipcRenderer.invoke('impresion:ticket', { impresora: String(impresora), lineas }) as Promise<{
      ok: boolean;
      error?: string;
    }>;
  },
} as const;

const sistema = {
  /** Cierra y vuelve a abrir el programa (tras restaurar un respaldo). */
  reiniciar(): void {
    ipcRenderer.send('app:reiniciar');
  },
} as const;

const whatsapp = {
  /** Pide abrir el chat de un numero E.164 sin + (ej: 549342...). */
  abrirChat(telefono: string): void {
    ipcRenderer.send('whatsapp:abrir-chat', String(telefono));
  },
  /** El panel de la ventana principal escucha adonde navegar. */
  alNavegar(manejador: (telefono: string) => void): () => void {
    const puente = (_evento: unknown, telefono: unknown): void => {
      if (typeof telefono === 'string') manejador(telefono);
    };
    ipcRenderer.on('whatsapp:navegar', puente);
    return () => {
      ipcRenderer.removeListener('whatsapp:navegar', puente);
    };
  },
} as const;

const actualizaciones = {
  /** Busca actualizaciones ahora y devuelve que paso, para mostrarlo. */
  verificar(): Promise<unknown> {
    return ipcRenderer.invoke('actualizador:verificar');
  },
  /** Abre la pagina de descargas en el navegador del sistema. */
  abrirDescargas(): void {
    ipcRenderer.send('actualizador:abrir-descargas');
  },
  /** Cierra el programa, instala la version descargada y vuelve a abrirlo. */
  instalarAhora(): void {
    ipcRenderer.send('actualizador:instalar');
  },
  /** Avisa cuando hay una version lista para instalar. Devuelve la baja. */
  alHaberActualizacion(manejador: (version: string) => void): () => void {
    const puente = (_e: unknown, carga: unknown): void => {
      const version = (carga as { versionDisponible?: unknown } | null)?.versionDisponible;
      if (typeof version === 'string') manejador(version);
    };
    ipcRenderer.on('actualizador:descargado', puente);
    return () => {
      ipcRenderer.removeListener('actualizador:descargado', puente);
    };
  },
} as const;

/** API disponible en el renderer como `window.alfajores`. */
export interface ApiAlfajores {
  readonly version: string;
  readonly plataforma: string;
  readonly ventanas: typeof ventanas;
  readonly archivos: typeof archivos;
  readonly actualizaciones: typeof actualizaciones;
  readonly eventos: typeof eventos;
  readonly whatsapp: typeof whatsapp;
  readonly sistema: typeof sistema;
  readonly impresion: typeof impresion;
}

const api: ApiAlfajores = Object.freeze({
  version: leerVersion(),
  plataforma: process.platform,
  ventanas,
  archivos,
  actualizaciones,
  eventos,
  whatsapp,
  sistema,
  impresion,
});

contextBridge.exposeInMainWorld('alfajores', api);
