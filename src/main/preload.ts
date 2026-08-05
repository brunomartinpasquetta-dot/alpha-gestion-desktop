/**
 * Preload del proceso renderer.
 *
 * Corre con `sandbox: true` y `contextIsolation: true`, asi que solo puede usar
 * el modulo `electron` y el subconjunto de `process` que Electron expone en el
 * sandbox (platform, versions, env). NO se puede hacer require de archivos del
 * proyecto (por eso no se importa nada de src/compartido) ni de `fs`.
 *
 * Todo lo que se expone acá es informacion inerte: strings de solo lectura.
 * No se filtra `ipcRenderer` crudo al mundo del renderer bajo ningun concepto.
 *
 * A futuro, cuando se sumen los modulos que necesitan hablar con el proceso main
 * (impresion termica de comandas/remitos y auto-updater), los canales IPC tipados
 * se cuelgan de este mismo objeto: cada canal se declara uno por uno, con su
 * firma explicita y validando los argumentos, nunca exponiendo `invoke` generico.
 */

import { contextBridge } from 'electron';

/**
 * Fallback de version por si el proceso main no llego a publicar la variable de
 * entorno. Debe coincidir con VERSION_APP de src/compartido/config.ts (no se
 * puede importar desde un preload sandboxeado).
 */
const VERSION_FALLBACK = '0.1.0';

/** Lee la version que el proceso main publica en el entorno antes de abrir la ventana. */
function leerVersion(): string {
  const desdeEntorno = process.env?.['ALFAJORES_VERSION'];
  if (typeof desdeEntorno === 'string' && desdeEntorno.trim() !== '') return desdeEntorno.trim();
  return VERSION_FALLBACK;
}

/** API minima disponible en el renderer como `window.alfajores`. */
export interface ApiAlfajores {
  /** Version del producto. */
  readonly version: string;
  /** Plataforma del sistema operativo: 'darwin' | 'win32' | 'linux' | ... */
  readonly plataforma: string;
}

const api: ApiAlfajores = Object.freeze({
  version: leerVersion(),
  plataforma: process.platform,
});

contextBridge.exposeInMainWorld('alfajores', api);
