/**
 * Rutas de ESCRITURA de pedidos y canal de tiempo real.
 *
 *   POST  /api/pedidos              crea un pedido (celular, mostrador o sistema)
 *   PATCH /api/pedidos/:id/estado   aplica una transicion de la maquina de estados
 *   GET   /api/eventos              stream SSE: avisa cambios sin que nadie refresque
 *
 * Seguridad: si ALFAJORES_PIN_PEDIDOS esta configurado, la creacion exige el
 * header `x-pin-pedidos`. El PIN protege la superficie que va a quedar expuesta
 * por el tunel; los cambios de estado son operacion de fabrica (escritorio).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ESTADOS_PEDIDO, ORIGENES_PEDIDO } from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { cerrarConexiones, suscribir } from '../eventos';
import { leerConfig } from '../config';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { pedidosServicio } from '../servicios/pedidos.servicio';

function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

const esquemaNuevoPedido = z.object({
  clienteId: z.number().int().positive().nullable().optional(),
  origen: z.enum(ORIGENES_PEDIDO),
  fechaEntregaEstimada: z.string().max(40).nullable().optional(),
  cargadoPor: z.string().max(80).nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        articuloId: z.number().int().positive(),
        cantidad: z.number().positive(),
        notas: z.string().max(200).nullable().optional(),
      }),
    )
    .min(1),
});

const esquemaParametrosPedido = z.object({
  id: z.coerce.number().int().positive(),
});

const esquemaCambioEstado = z.object({
  estado: z.enum(ESTADOS_PEDIDO),
});

export function registrarRutasPedidos(app: FastifyInstance): void {
  // Al cerrar el servidor se cortan los streams SSE: si quedan vivos,
  // `app.close()` espera para siempre y la app no puede apagarse.
  app.addHook('onClose', (_instancia, listo) => {
    cerrarConexiones();
    listo();
  });

  app.post('/api/pedidos', (request: FastifyRequest, reply: FastifyReply) => {
    const config = leerConfig();
    if (config.pinPedidos !== undefined) {
      const pin = request.headers['x-pin-pedidos'];
      if (typeof pin !== 'string' || pin !== config.pinPedidos) {
        return reply.status(401).send({
          error: { codigo: 'PIN_INVALIDO', mensaje: 'El PIN de carga de pedidos no es valido.' },
        });
      }
    }

    const entrada = validarOFallar(
      esquemaNuevoPedido,
      request.body,
      'El pedido enviado no es valido.',
    );
    const pedido = pedidosServicio.crearPedido(entrada);
    return reply.status(201).send({ datos: pedido });
  });

  app.patch('/api/pedidos/:id/estado', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosPedido,
      request.params,
      'El identificador del pedido no es valido.',
    );
    const { estado } = validarOFallar(
      esquemaCambioEstado,
      request.body,
      'El estado enviado no es valido.',
    );

    const datos = pedidosServicio.cambiarEstado(id, estado);
    return reply.status(200).send({ datos });
  });

  app.get('/api/eventos', (request: FastifyRequest, reply: FastifyReply) => {
    // SSE: la respuesta queda abierta. Primero se le avisa a Fastify que la
    // respuesta la maneja el socket crudo (hijack), y recien despues se escribe.
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // El dev server de Vite proxea este endpoint: sin esto bufferea el stream.
      'x-accel-buffering': 'no',
    });
    reply.raw.write(':conectado\n\n');

    const desuscribir = suscribir(reply.raw);
    request.raw.on('close', desuscribir);
  });
}
