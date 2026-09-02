/**
 * Rutas de cuentas corrientes. Por ahora solo consulta de saldo por entidad;
 * el alta de movimientos entra por los comprobantes, no por un endpoint suelto.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TIPOS_ENTIDAD_CC } from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { ccServicio } from '../servicios/cuentas-corrientes.servicio';
import { ccDetalleServicio } from '../servicios/cc-detalle.servicio';

const esquemaParametrosSaldo = z.object({
  entidad_tipo: z.enum(TIPOS_ENTIDAD_CC),
  entidad_id: z.coerce.number().int().positive(),
});

const esquemaParametrosImputacion = esquemaParametrosSaldo.extend({
  importe: z.coerce.number().int().positive(),
});

/** Mismo criterio que en articulos: los fallos de esquema salen como ErrorValidacion. */
function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

export function registrarRutasCuentasCorrientes(app: FastifyInstance): void {
  app.get(
    '/api/cc/:entidad_tipo/:entidad_id/saldo',
    (request: FastifyRequest, reply: FastifyReply) => {
      const parametros = validarOFallar(
        esquemaParametrosSaldo,
        request.params,
        'La entidad de cuenta corriente solicitada no es valida.',
      );

      // Entidad inexistente -> el servicio lanza ErrorNoEncontrado -> 404.
      const datos = ccServicio.saldoEntidad(parametros.entidad_tipo, parametros.entidad_id);
      return reply.status(200).send({ datos });
    },
  );

  // Ficha de la cuenta: comprobantes abiertos + libro con saldo corrido.
  app.get(
    '/api/cc/:entidad_tipo/:entidad_id/detalle',
    (request: FastifyRequest, reply: FastifyReply) => {
      const parametros = validarOFallar(
        esquemaParametrosSaldo,
        request.params,
        'La entidad de cuenta corriente solicitada no es valida.',
      );
      const datos = ccDetalleServicio.detalle(parametros.entidad_tipo, parametros.entidad_id);
      return reply.status(200).send({ datos });
    },
  );

  // Vista previa de la imputacion FIFO, para mostrarla ANTES de confirmar.
  app.get(
    '/api/cc/:entidad_tipo/:entidad_id/imputacion/:importe',
    (request: FastifyRequest, reply: FastifyReply) => {
      const parametros = validarOFallar(
        esquemaParametrosImputacion,
        request.params,
        'Los datos de la imputacion no son validos.',
      );
      const datos = ccDetalleServicio.simularImputacion(
        parametros.entidad_tipo,
        parametros.entidad_id,
        parametros.importe,
      );
      return reply.status(200).send({ datos });
    },
  );
}
