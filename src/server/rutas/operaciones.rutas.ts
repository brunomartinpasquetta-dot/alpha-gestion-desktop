/**
 * Rutas de OPERACION de fabrica: ejecucion de ordenes, trazabilidad y cheques.
 *
 *   PATCH /api/produccion/ordenes/:id/estado   ejecutar / finalizar / cancelar
 *   GET   /api/trazabilidad/:lote              historia completa de una tanda
 *   GET   /api/cheques                          cartera completa
 *   GET   /api/cheques/resumen                  indicadores de vencimientos
 *   POST  /api/cheques                          alta (recibido o emitido)
 *   PATCH /api/cheques/:id/estado               depositar / acreditar / etc.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  ESTADOS_CHEQUE,
  ESTADOS_ORDEN_PRODUCCION,
  FORMATOS_CHEQUE,
  TIPOS_CHEQUE,
  TIPOS_ENTIDAD_CC,
} from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { chequesServicio } from '../servicios/cheques.servicio';
import { produccionServicio } from '../servicios/produccion.servicio';
import { trazabilidadServicio } from '../servicios/trazabilidad.servicio';

function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

const esquemaId = z.object({ id: z.coerce.number().int().positive() });

const esquemaCambioOrden = z.object({
  estado: z.enum(ESTADOS_ORDEN_PRODUCCION),
  rindeReal: z.number().positive().nullable().optional(),
});

const esquemaLote = z.object({
  lote: z.string().min(3).max(40),
});

const esquemaNuevoCheque = z.object({
  tipo: z.enum(TIPOS_CHEQUE),
  formato: z.enum(FORMATOS_CHEQUE),
  numero: z.string().min(1).max(40),
  banco: z.string().max(80).nullable().optional(),
  cuitEmisor: z.string().max(20).nullable().optional(),
  contraparte: z.string().min(1).max(120),
  entidadTipo: z.enum(TIPOS_ENTIDAD_CC).nullable().optional(),
  entidadId: z.number().int().positive().nullable().optional(),
  importe: z.number().int().positive(),
  fechaEmision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
  fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
  notas: z.string().max(300).nullable().optional(),
});

const esquemaCambioCheque = z.object({
  estado: z.enum(ESTADOS_CHEQUE),
});

export function registrarRutasOperaciones(app: FastifyInstance): void {
  /* ------------------------------- Produccion ----------------------------- */

  app.patch('/api/produccion/ordenes/:id/estado', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la orden no es valido.');
    const cuerpo = validarOFallar(
      esquemaCambioOrden,
      request.body,
      'El cambio de estado enviado no es valido.',
    );
    const datos = produccionServicio.cambiarEstado(id, cuerpo.estado, cuerpo.rindeReal ?? null);
    return reply.status(200).send({ datos });
  });

  /* ------------------------------ Trazabilidad ---------------------------- */

  app.get('/api/trazabilidad/:lote', (request: FastifyRequest, reply: FastifyReply) => {
    const { lote } = validarOFallar(
      esquemaLote,
      request.params,
      'El numero de lote no es valido.',
    );
    const datos = trazabilidadServicio.consultarLote(lote.trim().toUpperCase());
    return reply.status(200).send({ datos });
  });

  /* --------------------------------- Cheques ------------------------------ */

  app.get('/api/cheques', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: chequesServicio.listar() });
  });

  app.get('/api/cheques/resumen', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: chequesServicio.resumenCartera() });
  });

  app.post('/api/cheques', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      esquemaNuevoCheque,
      request.body,
      'El cheque enviado no es valido.',
    );
    const datos = chequesServicio.crear(entrada);
    return reply.status(201).send({ datos });
  });

  app.patch('/api/cheques/:id/estado', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del cheque no es valido.');
    const { estado } = validarOFallar(
      esquemaCambioCheque,
      request.body,
      'El estado enviado no es valido.',
    );
    const datos = chequesServicio.cambiarEstado(id, estado);
    return reply.status(200).send({ datos });
  });
}
