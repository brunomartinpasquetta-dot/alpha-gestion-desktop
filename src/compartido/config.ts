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
export const VERSION_APP = '0.13.0';
