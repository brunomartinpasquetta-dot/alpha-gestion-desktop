import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import {
  HOST_SERVIDOR_DEFAULT,
  PUERTO_SERVIDOR_DEFAULT,
  PUERTO_VITE_DEV,
} from './src/compartido/config';

/**
 * Configuracion del renderer (React + Vite).
 *
 * Puntos clave:
 * - `root` apunta a src/renderer: ahi vive el index.html y todo el codigo de UI.
 * - `base: './'` genera rutas relativas, necesario porque Electron carga el build
 *   con el protocolo file:// y las rutas absolutas no resolverian.
 * - El proxy de /health y /api hacia el Fastify embebido evita CORS en desarrollo:
 *   el renderer siempre hace fetch a rutas relativas, tanto en dev como en produccion.
 */

/** Origen del servidor Fastify embebido al que se proxean las llamadas en desarrollo. */
const ORIGEN_SERVIDOR = `http://${HOST_SERVIDOR_DEFAULT}:${PUERTO_SERVIDOR_DEFAULT}`;

/** Extensiones de modulos que sirve Vite y que NUNCA deben salir hacia la API. */
const EXTENSIONES_DE_MODULO = /\.(?:[cm]?[jt]sx?|css|json|svg|png|jpe?g|woff2?)(?:\?|$)/;

/**
 * Guarda contra colisiones entre rutas de la API y modulos del renderer.
 *
 * El root de Vite es src/renderer, asi que un archivo en src/renderer/api/cliente.ts
 * se pide como /api/cliente.ts y el proxy se lo llevaria a Fastify, que responde 404
 * JSON en vez del modulo transpilado: la pantalla queda en blanco sin ningun error
 * visible en el servidor. Devolver la ruta desde `bypass` le dice a Vite que la
 * atienda el mismo. Aplica a cualquier request con extension de modulo o con los
 * query params que agrega Vite (?import, ?t=, ?v=).
 */
function noProxearModulos(req: { url?: string | undefined }): string | undefined {
  const url = req.url ?? '';
  if (EXTENSIONES_DE_MODULO.test(url)) return url;
  if (/[?&](?:import|t|v)=/.test(url)) return url;
  return undefined;
}

export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react()],
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        // Ventana de escritorio (principal + modulos embebidos).
        principal: path.resolve(__dirname, 'src/renderer/index.html'),
        // PWA del celular: la sirve Fastify en /pedidos.
        pedidos: path.resolve(__dirname, 'src/renderer/pedidos.html'),
      },
    },
  },
  server: {
    host: HOST_SERVIDOR_DEFAULT,
    port: PUERTO_VITE_DEV,
    strictPort: true,
    proxy: {
      '/health': {
        target: ORIGEN_SERVIDOR,
        changeOrigin: true,
        bypass: noProxearModulos,
      },
      '/api': {
        target: ORIGEN_SERVIDOR,
        changeOrigin: true,
        bypass: noProxearModulos,
      },
    },
  },
});
