/**
 * Manejador central de errores del servidor HTTP.
 *
 * Objetivo declarado: el proceso main de Electron NUNCA se cae por un error de
 * query. Todo lo que sube desde los servicios o desde la capa de datos termina
 * aca, se loguea completo del lado del servidor y sale como un JSON prolijo
 * hacia el renderer, sin filtrar stack traces ni SQL crudo al cliente.
 */

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

import { ESTADO_HTTP_POR_CODIGO, esErrorDominio } from '../dominio/errores';

/** Mensaje generico para errores no previstos: nunca exponemos el detalle tecnico. */
const MENSAJE_ERROR_INTERNO =
  'Ocurrio un error interno al procesar la solicitud. Revise el registro del servidor.';

/** Forma unica de todas las respuestas de error del ERP. */
export interface CuerpoError {
  readonly error: {
    readonly codigo: string;
    readonly mensaje: string;
    readonly detalles?: unknown;
  };
}

/** Detalle legible de un problema de validacion, pensado para mostrar en pantalla. */
export interface DetalleValidacion {
  readonly campo: string;
  readonly mensaje: string;
  readonly codigo: string;
}

/** Issue de zod v4 sin importar el alias deprecado `ZodIssue`. */
type IssueZod = ZodError['issues'][number];

/** Traduce los issues de zod a algo que el renderer pueda mostrar campo por campo. */
export function formatearIssuesZod(issues: readonly IssueZod[]): DetalleValidacion[] {
  return issues.map((issue) => ({
    campo: issue.path.map((tramo) => String(tramo)).join('.') || '(raiz)',
    mensaje: issue.message,
    codigo: issue.code,
  }));
}

function armarCuerpo(codigo: string, mensaje: string, detalles?: unknown): CuerpoError {
  // Omitimos "detalles" cuando no hay nada util que contar.
  if (detalles === undefined) return { error: { codigo, mensaje } };
  return { error: { codigo, mensaje, detalles } };
}

/** Los errores de validacion de Fastify traen la lista en `validation`. */
function esErrorValidacionFastify(error: FastifyError): boolean {
  return Array.isArray(error.validation) && error.validation.length > 0;
}

function registrarEnLog(
  request: FastifyRequest,
  estado: number,
  error: unknown,
  cuerpo: CuerpoError,
): void {
  const contexto = {
    err: error,
    estado,
    metodo: request.method,
    url: request.url,
    codigo: cuerpo.error.codigo,
  };
  // 4xx es culpa del que llama (warn); 5xx es culpa nuestra (error, con todo el detalle).
  if (estado >= 500) request.log.error(contexto, 'Fallo interno al procesar la solicitud');
  else request.log.warn(contexto, 'Solicitud rechazada');
}

/**
 * Registra el error handler y el handler de 404 sobre la instancia recibida.
 * Debe llamarse antes de registrar las rutas.
 */
export function registrarManejadorErrores(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    // Lo tratamos como `unknown` porque Fastify tipa el parametro como FastifyError
    // pero en la practica llega cualquier cosa que hayan lanzado los servicios.
    const crudo: unknown = error;

    if (esErrorDominio(crudo)) {
      const estado = ESTADO_HTTP_POR_CODIGO[crudo.codigo];
      const cuerpo = armarCuerpo(crudo.codigo, crudo.message, crudo.detalles);
      registrarEnLog(request, estado, crudo, cuerpo);
      return reply.status(estado).send(cuerpo);
    }

    if (crudo instanceof ZodError) {
      const cuerpo = armarCuerpo(
        'VALIDACION',
        'Los datos enviados no son validos.',
        formatearIssuesZod(crudo.issues),
      );
      registrarEnLog(request, 400, crudo, cuerpo);
      return reply.status(400).send(cuerpo);
    }

    if (esErrorValidacionFastify(error)) {
      const cuerpo = armarCuerpo('VALIDACION', 'Los datos enviados no son validos.', error.validation);
      registrarEnLog(request, 400, error, cuerpo);
      return reply.status(400).send(cuerpo);
    }

    // Errores con estado propio declarado por Fastify (payload muy grande, JSON roto, etc).
    const estadoDeclarado = typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (estadoDeclarado >= 400 && estadoDeclarado < 500) {
      const cuerpo = armarCuerpo(error.code ?? 'SOLICITUD_INVALIDA', error.message);
      registrarEnLog(request, estadoDeclarado, error, cuerpo);
      return reply.status(estadoDeclarado).send(cuerpo);
    }

    // Cualquier otra cosa: al cliente le contamos poco, al log le contamos todo.
    const cuerpo = armarCuerpo('ERROR_INTERNO', MENSAJE_ERROR_INTERNO);
    registrarEnLog(request, 500, crudo, cuerpo);
    return reply.status(500).send(cuerpo);
  });

  app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
    const cuerpo = armarCuerpo(
      'RUTA_NO_ENCONTRADA',
      `La ruta ${request.method} ${request.url} no existe.`,
    );
    request.log.warn(
      { estado: 404, metodo: request.method, url: request.url, codigo: cuerpo.error.codigo },
      'Ruta inexistente',
    );
    return reply.status(404).send(cuerpo);
  });
}
