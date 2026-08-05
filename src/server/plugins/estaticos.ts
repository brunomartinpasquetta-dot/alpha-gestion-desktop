/**
 * Servido de archivos estaticos del renderer compilado (dist/renderer).
 *
 * No usamos @fastify/static a proposito: no sumamos dependencias para algo que
 * son treinta lineas de `node:fs`. El handler es un comodin al final de la
 * cadena de ruteo, asi que las rutas declaradas (/health, /api/...) siempre
 * ganan porque find-my-way prioriza las rutas estaticas sobre los wildcards.
 *
 * NOTA PARA EL FUTURO: sobre este mismo handler se va a montar la ruta
 * `/pedidos` para el celular (la PWA de toma de pedidos). Cuando llegue ese
 * momento, alcanza con agregar su carpeta compilada y un fallback propio a
 * `pedidos/index.html`, reutilizando la resolucion segura de rutas de abajo.
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

    // Fallback SPA: el ruteo del renderer resuelve la pantalla del lado del cliente.
    if (esArchivoExistente(rutaIndex)) return enviarArchivo(reply, rutaIndex);

    return reply.callNotFound();
  });
}

/** Envia el archivo por stream: nunca cargamos el bundle entero en memoria. */
function enviarArchivo(reply: FastifyReply, rutaArchivo: string): FastifyReply {
  const esIndex = path.basename(rutaArchivo) === 'index.html';
  reply.header('Content-Type', tipoContenidoDe(rutaArchivo));
  // El index nunca se cachea: es el que trae los nombres con hash del resto.
  reply.header('Cache-Control', esIndex ? 'no-cache' : 'public, max-age=3600');
  return reply.send(fs.createReadStream(rutaArchivo));
}
