/**
 * Rutas de articulos y stock.
 *
 * Las rutas solo hacen tres cosas: validar la entrada con zod, delegar en el
 * servicio y serializar la salida. Ninguna regla de negocio vive aca.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { TIPOS_ARTICULO } from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { stockServicio } from '../servicios/stock.servicio';

/** Los querystring llegan siempre como texto: aceptamos las cuatro formas usuales. */
const BOOLEANO_TEXTO = ['true', 'false', '1', '0'] as const;

const esquemaConsultaArticulos = z.object({
  tipo: z.enum(TIPOS_ARTICULO).optional(),
  grupo: z.enum(['insumos', 'productos']).optional(),
  soloActivos: z
    .enum(BOOLEANO_TEXTO)
    .optional()
    .transform((valor) => (valor === undefined ? true : valor === 'true' || valor === '1')),
});

const esquemaParametrosArticulo = z.object({
  id: z.coerce.number().int().positive(),
});

/**
 * Valida con zod y, si falla, lanza un ErrorValidacion de dominio. Elegimos este
 * camino (y no dejar escapar el ZodError) para que todas las respuestas de error
 * del ERP salgan por el mismo lugar y con el mismo formato.
 */
function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

export function registrarRutasArticulos(app: FastifyInstance): void {
  app.get('/api/articulos', (request: FastifyRequest, reply: FastifyReply) => {
    const consulta = validarOFallar(
      esquemaConsultaArticulos,
      request.query,
      'Los filtros de busqueda de articulos no son validos.',
    );

    const datos = stockServicio.listarArticulosConStock({
      soloActivos: consulta.soloActivos,
      ...(consulta.tipo !== undefined ? { tipo: consulta.tipo } : {}),
      ...(consulta.grupo !== undefined ? { grupo: consulta.grupo } : {}),
    });

    return reply.status(200).send({ datos });
  });

  app.get('/api/articulos/:id/stock', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosArticulo,
      request.params,
      'El identificador del articulo no es valido: se espera un numero entero positivo.',
    );

    // Si el articulo no existe, el servicio lanza ErrorNoEncontrado -> 404.
    const datos = stockServicio.detalleStock(id);
    return reply.status(200).send({ datos });
  });
}
