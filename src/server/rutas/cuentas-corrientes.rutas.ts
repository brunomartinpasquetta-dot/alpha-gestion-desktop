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

const esquemaParametrosSaldo = z.object({
  entidad_tipo: z.enum(TIPOS_ENTIDAD_CC),
  entidad_id: z.coerce.number().int().positive(),
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
}
