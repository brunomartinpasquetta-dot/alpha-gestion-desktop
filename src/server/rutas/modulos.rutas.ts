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
import { responderConDatos } from '../asistente/consultas';
import { answerQuestion as responderPregunta } from '../asistente/motor';
import { cajaGeneralServicio } from '../servicios/caja-general.servicio';
import { presentacionesServicio } from '../servicios/presentaciones.servicio';
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

  // Ledger completo de un grupo (auditoria): ingresos, egresos y ajustes.
  app.get('/api/stock/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const { grupo } = validarOFallar(
      esquemaConsultaStock,
      request.query,
      "El grupo de stock debe ser 'insumos' o 'productos'.",
    );
    return reply.status(200).send({ datos: consultasServicio.listarMovimientosDeGrupo(grupo) });
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

  // Medios de pago activos, en el orden del PDV. El renderer arma con esto
  // las filas del pago mixto.
  // Catalogo de presentaciones para el talonario de pedidos.
  app.get('/api/presentaciones', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: presentacionesServicio.listar() });
  });

  // Precio de UN renglon (presentacion x lista), resuelto por la unica fuente
  // de verdad de la liquidacion (precio propio, componentes, listas derivadas).
  app.get('/api/presentaciones/:id/precio/:listaId', (request: FastifyRequest, reply: FastifyReply) => {
    const { id, listaId } = request.params as { id: string; listaId: string };
    const precio = presentacionesServicio.precioDeRenglon(Number(id), Number(listaId));
    return reply.status(200).send({ datos: { precio } });
  });

  // Asistente virtual (Alfi). Primero intenta responder con DATOS REALES del
  // sistema (ventas de hoy, stock, deudores...); si la pregunta no es de
  // datos, sigue el motor de conocimiento de siempre.
  app.post('/api/asistente', (request: FastifyRequest, reply: FastifyReply) => {
    const { pregunta, sesion } = validarOFallar(
      z.object({ pregunta: z.string().min(1).max(500), sesion: z.string().max(80).optional() }),
      request.body,
      'La pregunta del asistente no es valida.',
    );
    const dato = responderConDatos(pregunta);
    if (dato !== null) {
      return reply.status(200).send({ datos: { respuesta: dato, sugerencias: [] } });
    }
    const respuesta = responderPregunta(pregunta, sesion ?? 'principal');
    return reply.status(200).send({
      datos: { respuesta: respuesta.reply, sugerencias: respuesta.suggestions },
    });
  });

  app.get('/api/medios-pago', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarMediosPago() });
  });

  // Vendedores/revendedores activos, para el desplegable del pedido.
  app.get('/api/vendedores', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: consultasServicio.listarVendedores() });
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

  // Caja general (la caja fuerte): saldos y libro de movimientos.
  app.get('/api/caja-general/saldos', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: cajaGeneralServicio.saldos() });
  });

  app.get('/api/caja-general/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const filtro = validarOFallar(
      z.object({
        desde: z.string().max(10).optional(),
        hasta: z.string().max(10).optional(),
        tipo: z.enum(['ingreso', 'egreso', 'desde_caja_diaria']).optional(),
        medio: z.enum(['efectivo', 'electronico']).optional(),
      }),
      request.query,
      'El filtro de movimientos no es valido.',
    );
    return reply.status(200).send({ datos: cajaGeneralServicio.listarMovimientos(filtro) });
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
