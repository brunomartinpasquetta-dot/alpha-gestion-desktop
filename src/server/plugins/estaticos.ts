/**
 * Servido de archivos estaticos del renderer compilado (dist/renderer).
 *
 * No usamos @fastify/static a proposito: no sumamos dependencias para algo que
 * son treinta lineas de `node:fs`. El handler es un comodin al final de la
 * cadena de ruteo, asi que las rutas declaradas (/health, /api/...) siempre
 * ganan porque find-my-way prioriza las rutas estaticas sobre los wildcards.
 *
 * Dos aplicaciones salen de la misma carpeta compilada:
 *   - `/` y el fallback SPA -> index.html (escritorio, ventanas de modulo)
 *   - `/pedidos`            -> pedidos.html (la PWA del celular)
 *   - `/elaboracion`        -> elaboracion.html (el monitor de la fabrica)
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Content-Type por extension. Lo que no figura se sirve como binario opaco. */
const TIPOS_CONTENIDO: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const TIPO_CONTENIDO_DEFAULT = 'application/octet-stream';

/** Prefijos que jamas caen al fallback de la SPA: si no existen, son 404 de verdad. */
const PREFIJOS_API = ['/api'];
const RUTAS_RESERVADAS = ['/health'];

function tipoContenidoDe(rutaArchivo: string): string {
  const extension = path.extname(rutaArchivo).toLowerCase();
  return TIPOS_CONTENIDO[extension] ?? TIPO_CONTENIDO_DEFAULT;
}

function esArchivoExistente(ruta: string): boolean {
  try {
    return fs.statSync(ruta).isFile();
  } catch {
    return false;
  }
}

function esCarpetaExistente(ruta: string): boolean {
  try {
    return fs.statSync(ruta).isDirectory();
  } catch {
    return false;
  }
}

/** Quita el querystring y decodifica el porcentaje, sin explotar ante URLs rotas. */
function rutaPedida(url: string): string {
  const sinQuery = url.split('?')[0] ?? '/';
  try {
    return decodeURIComponent(sinQuery);
  } catch {
    return sinQuery;
  }
}

function esRutaDeApi(ruta: string): boolean {
  return (
    PREFIJOS_API.some((prefijo) => ruta === prefijo || ruta.startsWith(`${prefijo}/`)) ||
    RUTAS_RESERVADAS.includes(ruta)
  );
}

/**
 * Resuelve la ruta pedida contra la carpeta base y se asegura de que el
 * resultado siga adentro. Devuelve null si el pedido intenta escaparse
 * (`../../etc/passwd`, symlinks hacia afuera, etc).
 */
function resolverDentroDe(carpetaBase: string, ruta: string): string | null {
  const relativo = ruta.replace(/^\/+/, '');
  const destino = path.resolve(carpetaBase, relativo);
  if (destino !== carpetaBase && !destino.startsWith(carpetaBase + path.sep)) return null;
  return destino;
}

/**
 * Monta el servido de estaticos. Si la carpeta no existe (modo desarrollo, donde
 * el renderer lo sirve Vite) no registra nada y lo deja anotado en el log.
 */
export function registrarEstaticos(app: FastifyInstance, carpeta: string): void {
  const carpetaBase = path.resolve(carpeta);

  if (!esCarpetaExistente(carpetaBase)) {
    app.log.info(
      { carpeta: carpetaBase },
      'No hay renderer compilado: en desarrollo lo sirve Vite, no el servidor.',
    );
    return;
  }

  const rutaIndex = path.join(carpetaBase, 'index.html');
  const rutaPedidos = path.join(carpetaBase, 'pedidos.html');
  const rutaElaboracion = path.join(carpetaBase, 'elaboracion.html');
  app.log.info({ carpeta: carpetaBase }, 'Sirviendo el renderer compilado desde disco.');

  app.get('/*', (request: FastifyRequest, reply: FastifyReply) => {
    const pedida = rutaPedida(request.url);
    const destino = resolverDentroDe(carpetaBase, pedida);

    if (destino === null) {
      request.log.warn({ url: request.url }, 'Intento de path traversal bloqueado');
      return reply.status(403).send({
        error: {
          codigo: 'RUTA_PROHIBIDA',
          mensaje: 'La ruta solicitada esta fuera de la carpeta publica.',
        },
      });
    }

    if (esArchivoExistente(destino)) return enviarArchivo(reply, destino);

    // Un /api inexistente es un 404 de API, no la pantalla de la SPA.
    if (esRutaDeApi(pedida)) return reply.callNotFound();

    // La PWA del celular: /pedidos y cualquier subruta sirven su propio shell.
    if (pedida === '/pedidos' || pedida.startsWith('/pedidos/')) {
      if (esArchivoExistente(rutaPedidos)) return enviarArchivo(reply, rutaPedidos);
      return reply.callNotFound();
    }

    // El monitor de elaboracion de la fabrica (tablet/notebook en red).
    if (pedida === '/elaboracion' || pedida.startsWith('/elaboracion/')) {
      if (esArchivoExistente(rutaElaboracion)) return enviarArchivo(reply, rutaElaboracion);
      return reply.callNotFound();
    }

    // El escritorio (la SPA completa) es SOLO de la maquina local: un celular
    // o una tablet que pide "/" va derecho a la pantalla de pedidos. Desde la
    // red solo existen /pedidos y /elaboracion.
    // Misma regla que la guardia de la API: si no es el escritorio de esta
    // maquina (por IP o por el HOST del pedido), solo existe /pedidos.
    const desdeEsteEquipo = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip);
    const hostPedido = (request.headers.host ?? '').toLowerCase().split(':')[0] ?? '';
    const hostEsIpOLocal =
      hostPedido === 'localhost' ||
      hostPedido === '127.0.0.1' ||
      /^\d{1,3}(\.\d{1,3}){3}$/.test(hostPedido);
    const conCabeceraProxy =
      typeof request.headers['cf-connecting-ip'] === 'string' ||
      typeof request.headers['x-forwarded-for'] === 'string' ||
      typeof request.headers['x-real-ip'] === 'string' ||
      typeof request.headers['forwarded'] === 'string';
    if (!desdeEsteEquipo || conCabeceraProxy || !hostEsIpOLocal) {
      return reply.redirect('/pedidos');
    }

    // Fallback SPA: el ruteo del renderer resuelve la pantalla del lado del cliente.
    if (esArchivoExistente(rutaIndex)) return enviarArchivo(reply, rutaIndex);

    return reply.callNotFound();
  });
}

/** Envia el archivo por stream: nunca cargamos el bundle entero en memoria. */
function enviarArchivo(reply: FastifyReply, rutaArchivo: string): FastifyReply {
  const nombre = path.basename(rutaArchivo);
  const esIndex =
    nombre === 'index.html' ||
    nombre === 'pedidos.html' ||
    nombre === 'elaboracion.html' ||
    nombre === 'pedidos-sw.js';
  reply.header('Content-Type', tipoContenidoDe(rutaArchivo));
  // Los shells y el service worker nunca se cachean: son los que traen los
  // nombres con hash del resto y la logica de actualizacion.
  reply.header('Cache-Control', esIndex ? 'no-cache' : 'public, max-age=3600');
  return reply.send(fs.createReadStream(rutaArchivo));
}
