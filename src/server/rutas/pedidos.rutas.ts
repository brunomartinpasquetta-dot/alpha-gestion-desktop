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
import { reservasServicio } from '../servicios/reservas.servicio';

function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

const esquemaNuevoPedido = z.object({
  renglones: z
    .array(
      z
        .object({
          presentacionId: z.number().int().positive().nullable().optional(),
          cantidad: z.number().gt(0).max(100000),
          descripcion: z.string().max(200).nullable().optional(),
          componentes: z
            .array(z.object({ articuloId: z.number().int().positive(), unidades: z.number().gt(0).max(10000) }))
            .max(12)
            .nullable()
            .optional(),
        })
        // A medida exige descripcion y composicion; de catalogo, ninguna.
        .refine(
          (renglon) =>
            renglon.presentacionId != null ||
            ((renglon.componentes?.length ?? 0) > 0 && !!renglon.descripcion?.trim()),
          { message: 'El renglon a medida necesita descripcion y composicion.' },
        ),
    )
    .max(60)
    .nullable()
    .optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  vendedorId: z.number().int().positive().nullable().optional(),
  listaPrecioId: z.number().int().positive().nullable().optional(),
  origen: z.enum(ORIGENES_PEDIDO),
  fechaEntregaEstimada: z.string().max(40).nullable().optional(),
  cargadoPor: z.string().max(80).nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
  // El talonario manda renglones y cero items (se derivan); el celular manda
  // items directos. Al menos UNO de los dos tiene que venir con contenido.
  items: z
    .array(
      z.object({
        articuloId: z.number().int().positive(),
        // Topes sensatos: nadie pide una millonesima de alfajor ni un billon.
        cantidad: z.number().min(0.01).max(1_000_000),
        notas: z.string().max(200).nullable().optional(),
      }),
    )
    .default([]),
  claveIdempotencia: z.string().min(8).max(80).nullable().optional(),
}).refine(
  (pedido) => (pedido.items?.length ?? 0) > 0 || (pedido.renglones?.length ?? 0) > 0,
  { message: 'El pedido tiene que tener al menos un renglon o un articulo.' },
);

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
    // El PIN protege la carga desde AFUERA (el celular). Desde la propia
    // maquina no se pide, porque el mostrador tambien carga pedidos y exigirle
    // el PIN al operador que ya esta sentado frente al sistema no agrega nada.
    // OJO con el tunel de Cloudflare: terminaria en la maquina y entraria como
    // loopback. Ver guardia-pin.ts: antes de exponerlo hay que endurecer esto.
    const config = leerConfig();
    const esLocal = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.ip);
    if (config.pinPedidos !== undefined && !esLocal) {
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
    const resultado = pedidosServicio.crearPedido(entrada);
    // 200 si la clave de idempotencia ya se habia procesado; 201 si es nuevo.
    // Las ordenes que el pedido abrio solo viajan aparte del pedido: quien
    // carga desde el mostrador quiere ver que trabajo genero.
    return reply
      .status(resultado.existente ? 200 : 201)
      .send({ datos: resultado.pedido, ordenes: resultado.ordenes, cobertura: resultado.cobertura });
  });

  app.put('/api/pedidos/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosPedido,
      request.params,
      'El identificador del pedido no es valido.',
    );
    const entrada = validarOFallar(esquemaNuevoPedido, request.body, 'El pedido enviado no es valido.');
    return reply.status(200).send({ datos: pedidosServicio.actualizarPedido(id, entrada) });
  });

  /**
   * Aparta para este pedido lo que ya esta elaborado y sin dueño.
   *
   * Es lo que evita elaborar de nuevo algo que esta en el deposito: si hay
   * stock, se le asigna al cliente —anotando de que tanda sale— y la fabrica
   * solo tiene que elaborar la diferencia.
   */
  app.post('/api/pedidos/:id/cubrir-con-stock', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosPedido,
      request.params,
      'El identificador del pedido no es valido.',
    );
    return reply.status(200).send({ datos: reservasServicio.cubrirConStock(id) });
  });

  /** Suelta lo apartado para el pedido, sin cancelar el pedido. */
  app.post('/api/pedidos/:id/liberar-reservas', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosPedido,
      request.params,
      'El identificador del pedido no es valido.',
    );
    return reply.status(200).send({ datos: reservasServicio.liberar(id) });
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
