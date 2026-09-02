/**
 * Constantes transversales del producto.
 *
 * Este modulo lo comparten el proceso main, el servidor y el RENDERER, por lo
 * que debe ser puro: nada de `process`, `fs` ni APIs de Node. La lectura de
 * variables de entorno vive en `src/server/config.ts`, que solo corre en Node.
 */

/**
 * Nombre COMERCIAL del producto: lo unico que ve el usuario (ventana, barra
 * lateral, menu del sistema, nombre del .app).
 */
export const NOMBRE_PRODUCTO = 'Alpha Gestión';

/**
 * Identificador INTERNO. Define la carpeta de userData donde vive la base de
 * datos, y por eso no debe cambiar cuando cambia el nombre comercial: renombrarlo
 * equivale a mudar la base de datos de todas las instalaciones existentes.
 */
export const NOMBRE_APP = 'alfajores-erp';

/** Nombre del archivo SQLite dentro de userData. */
export const NOMBRE_ARCHIVO_DB = 'alfajores.db';

/** Puerto por defecto del servidor Fastify embebido. Configurable por entorno. */
export const PUERTO_SERVIDOR_DEFAULT = 4600;

/**
 * Host de escucha. 0.0.0.0 para que el celular llegue por la LAN a la PWA de
 * pedidos (y mas adelante, para que el tunel de Cloudflare conecte localmente).
 * Antes de exponer a internet: configurar ALFAJORES_PIN_PEDIDOS.
 */
export const HOST_SERVIDOR_DEFAULT = '0.0.0.0';

/** Puerto del dev server de Vite (renderer en modo desarrollo). */
export const PUERTO_VITE_DEV = 5173;

/**
 * Repositorio de GitHub del que salen las actualizaciones.
 * Debe coincidir con el bloque `publish` de electron-builder.yml.
 */
export const REPO_GITHUB = {
  owner: 'brunomartinpasquetta-dot',
  repo: 'alpha-gestion-desktop',
} as const;

/** Version del producto. */
export const VERSION_APP = '1.9.5';

/* ------------------------- Barra de titulo propia ------------------------- */

/**
 * La barra marron ES la barra de titulo de la ventana: el sistema no dibuja
 * ninguna (`titleBarStyle: 'hidden'`). Estas constantes son la UNICA fuente de
 * verdad y las comparten el proceso main (opciones de BrowserWindow) y el
 * renderer (el div de la barra).
 *
 * Si el alto de aca y el del div se separan, en Windows los botones del sistema
 * quedan desalineados con la franja marron; si se separan los colores, aparece
 * un rectangulo de otro color detras de esos botones (el fondo del div NO pinta
 * debajo del overlay nativo).
 */
export const ALTO_BARRA_TITULO = 32;

/** dulce-600 de tailwind.config.cjs. Cambiar los dos juntos, siempre. */
export const COLOR_BARRA_TITULO = '#9a5c28';

/** Simbolos de minimizar/maximizar/cerrar en Windows. 5.34:1 sobre el marron. */
export const COLOR_SIMBOLOS_BARRA = '#ffffff';
