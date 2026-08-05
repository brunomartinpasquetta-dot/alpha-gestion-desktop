/**
 * Rutas de LECTURA de los modulos del ERP.
 *
 * Igual que el resto: validar con zod, delegar en el servicio de consultas y
 * serializar. Cero reglas de negocio aca.
 *
 * Todas devuelven `{ datos }` para que el renderer tenga una sola forma que
 * desenvolver, y todas son GET: las operaciones de escritura se suman despues.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import {
  consultasServicio,
  LIMITE_MOVIMIENTOS_DEFAULT,
  LIMITE_MOVIMIENTOS_MAXIMO,
} from '../servicios/consultas.servicio';
import { stockServicio } from '../servicios/stock.servicio';

function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

const esquemaConsultaStock = z.object({
  grupo: z.enum(['insumos', 'productos']),
});

const esquemaParametrosArticulo = z.object({
  id: z.coerce.number().int().positive(),
});

const esquemaConsultaMovimientos = z.object({
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MOVIMIENTOS_MAXIMO)
    .optional()
    .default(LIMITE_MOVIMIENTOS_DEFAULT),
});

const esquemaConsultaMovimientosCaja = z.object({
  cajaId: z.coerce.number().int().positive().optional(),
});

export function registrarRutasModulos(app: FastifyInstance): void {
  /* -------------------------------- Resumen ------------------------------ */

  app.get('/api/resumen', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.obtenerResumenGeneral() });
  });

  /* --------------------------------- Stock ------------------------------- */

  app.get('/api/stock', (request: FastifyRequest, reply: FastifyReply) => {
    const { grupo } = validarOFallar(
      esquemaConsultaStock,
      request.query,
      "El grupo de stock debe ser 'insumos' o 'productos'.",
    );
    return reply.status(200).send({ datos: stockServicio.saldosPorGrupo(grupo) });
  });

  app.get('/api/articulos/:id/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(
      esquemaParametrosArticulo,
      request.params,
      'El identificador del articulo no es valido: se espera un numero entero positivo.',
    );
    const { limite } = validarOFallar(
      esquemaConsultaMovimientos,
      request.query,
      `El limite debe ser un entero entre 1 y ${LIMITE_MOVIMIENTOS_MAXIMO}.`,
    );

    // Articulo inexistente -> el servicio lanza ErrorNoEncontrado -> 404.
    const datos = consultasServicio.listarMovimientosDeArticulo(id, limite);
    return reply.status(200).send({ datos });
  });

  /* ------------------------------ Produccion ----------------------------- */

  app.get('/api/recetas', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarRecetas() });
  });

  app.get('/api/produccion/ordenes', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarOrdenesProduccion() });
  });

  /* -------------------------------- Comercial ---------------------------- */

  app.get('/api/pedidos', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarPedidos() });
  });

  app.get('/api/ventas', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarVentas() });
  });

  app.get('/api/compras', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarCompras() });
  });

  /* -------------------------------- Finanzas ----------------------------- */

  app.get('/api/caja/cajas', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarCajas() });
  });

  app.get('/api/caja/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const { cajaId } = validarOFallar(
      esquemaConsultaMovimientosCaja,
      request.query,
      'El identificador de caja no es valido: se espera un numero entero positivo.',
    );
    return reply.status(200).send({ datos: consultasServicio.listarMovimientosCaja(cajaId) });
  });

  app.get('/api/caja/general', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.obtenerCajaGeneral() });
  });

  app.get('/api/estadisticas', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.obtenerEstadisticas() });
  });

  app.get('/api/usuarios', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarUsuarios() });
  });

  app.get('/api/cuentas-corrientes', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .status(200)
      .send({ datos: consultasServicio.listarResumenCuentasCorrientes() });
  });

  /* -------------------------------- Maestros ----------------------------- */

  app.get('/api/clientes', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarClientes() });
  });

  app.get('/api/proveedores', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarProveedores() });
  });

  app.get('/api/listas-precio', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarListasPrecio() });
  });
}
