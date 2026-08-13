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

import { TIPOS_COMPROBANTE } from '../../compartido/contratos';
import {
  CONDICIONES_IVA,
  ENTORNOS_ARCA,
  ESTADOS_CHEQUE,
  ESTADOS_ORDEN_PRODUCCION,
  FORMAS_PAGO,
  FORMATOS_CHEQUE,
  TIPOS_CHEQUE,
  TIPOS_ENTIDAD_CC,
} from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { chequesServicio } from '../servicios/cheques.servicio';
import { comprobantesServicio } from '../servicios/comprobantes.servicio';
import { fiscalServicio } from '../servicios/fiscal.servicio';
import { ventasServicio } from '../servicios/ventas.servicio';
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
  /** Elaborar aunque el papel diga que faltan insumos (estan fisicamente). */
  forzar: z.boolean().optional(),
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

const esquemaConfigFiscal = z.object({
  entorno: z.enum(ENTORNOS_ARCA),
  cuit: z.string().max(20),
  razonSocial: z.string().max(160).nullable().optional(),
  direccion: z.string().max(200).nullable().optional(),
  condicionIva: z.enum(CONDICIONES_IVA),
  iibb: z.string().max(40).nullable().optional(),
  rutaCertificado: z.string().max(500).nullable().optional(),
  rutaClave: z.string().max(500).nullable().optional(),
  puntoVenta: z.number().int().min(1).max(99999),
  habilitada: z.boolean(),
});

const esquemaNuevaVenta = z.object({
  clienteId: z.number().int().positive().nullable().optional(),
  formaPago: z.enum(FORMAS_PAGO),
  pedidoId: z.number().int().positive().nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
  comprobante: z.enum(TIPOS_COMPROBANTE).optional(),
  condicionIvaReceptor: z.number().int().positive().max(20).optional(),
  /** Destino del saldo no llevado en una entrega parcial de pedido. */
  restoPedido: z.enum(['liberar', 'mantener']).nullable().optional(),
  /** Pagos mixtos. Ausente = todo en Efectivo (venta rapida). */
  pagos: z
    .array(
      z.object({
        medioPagoId: z.number().int().positive(),
        importe: z.number().int().positive(),
        referencia: z.string().max(60).nullable().optional(),
        cheque: z
          .object({
            numero: z.string().min(1).max(40),
            banco: z.string().max(80).nullable().optional(),
            fechaPago: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD'),
            formato: z.enum(['fisico', 'echeq']).optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .max(10)
    .nullable()
    .optional(),
  items: z
    .array(
      z.object({
        articuloId: z.number().int().positive(),
        cantidad: z.number().min(0.01).max(1_000_000),
        precioUnitario: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
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
    const datos = produccionServicio.cambiarEstado(id, cuerpo.estado, cuerpo.rindeReal ?? null, cuerpo.forzar ?? false);
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

  /* --------------------------------- Ventas ------------------------------- */

  // Async: si la venta lleva factura, se espera el CAE de ARCA antes de escribir.
  app.post('/api/ventas', async (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaNuevaVenta, request.body, 'La venta enviada no es valida.');
    const datos = await ventasServicio.crearVenta(entrada);
    return reply.status(201).send({ datos });
  });

  // Todo lo necesario para imprimir el remito o la factura de una venta.
  app.get('/api/ventas/:id/comprobante', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la venta no es valido.');
    return reply.status(200).send({ datos: comprobantesServicio.obtenerImprimible(id) });
  });

  app.patch('/api/ventas/:id/anular', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la venta no es valido.');
    const datos = ventasServicio.anularVenta(id);
    return reply.status(200).send({ datos });
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

  /* --------------------------- Facturacion / ARCA ------------------------- */

  app.get('/api/fiscal/config', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: fiscalServicio.obtenerConfig() });
  });

  app.put('/api/fiscal/config', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      esquemaConfigFiscal,
      request.body,
      'La configuracion fiscal enviada no es valida.',
    );
    return reply.status(200).send({ datos: fiscalServicio.guardarConfig(entrada) });
  });

  app.post('/api/fiscal/probar', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: await fiscalServicio.probarConexion() });
  });
}
