/**
 * Rutas de ESCRITURA de maestros, compras, tesoreria y planificacion.
 *
 * Convencion en todo el modulo: POST crea, PUT reemplaza, PATCH cambia un
 * aspecto puntual (el estado). No existe DELETE: dar de baja es PATCH .../activo
 * con `false`, porque el ledger referencia a estas entidades y borrarlas dejaria
 * documentos apuntando al vacio.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  FORMAS_PAGO,
  ROLES_USUARIO,
  TIPOS_ARTICULO,
  TIPOS_CLIENTE,
  TIPOS_ENTIDAD_CC,
  TIPOS_MOVIMIENTO_CAJA,
} from '../db/schema';
import { ErrorValidacion } from '../dominio/errores';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { ajustesServicio } from '../servicios/ajustes.servicio';
import { comprasServicio } from '../servicios/compras.servicio';
import { inicializacionServicio } from '../servicios/inicializacion.servicio';
import { maestrosServicio } from '../servicios/maestros.servicio';
import { produccionServicio } from '../servicios/produccion.servicio';
import { tesoreriaServicio } from '../servicios/tesoreria.servicio';

function validarOFallar<T>(esquema: z.ZodType<T>, datos: unknown, mensaje: string): T {
  const resultado = esquema.safeParse(datos);
  if (resultado.success) return resultado.data;
  throw new ErrorValidacion(mensaje, formatearIssuesZod(resultado.error.issues));
}

const esquemaId = z.object({ id: z.coerce.number().int().positive() });
const esquemaActivo = z.object({ activo: z.boolean() });

const textoOpcional = (max: number) => z.string().max(max).nullable().optional();

const esquemaCliente = z.object({
  nombre: z.string().min(2).max(120),
  cuit: textoOpcional(20),
  telefono: textoOpcional(40),
  email: textoOpcional(120),
  direccion: textoOpcional(200),
  tipo: z.enum(TIPOS_CLIENTE),
  listaPrecioId: z.number().int().positive().nullable().optional(),
  notas: textoOpcional(500),
});

const esquemaProveedor = z.object({
  nombre: z.string().min(2).max(120),
  cuit: textoOpcional(20),
  telefono: textoOpcional(40),
  email: textoOpcional(120),
  direccion: textoOpcional(200),
  notas: textoOpcional(500),
});

const esquemaArticulo = z.object({
  codigo: z.string().min(2).max(40),
  nombre: z.string().min(2).max(120),
  tipo: z.enum(TIPOS_ARTICULO),
  unidadBaseId: z.number().int().positive(),
  stockMin: z.number().min(0).max(1_000_000).nullable().optional(),
  unidadesPorCaja: z.number().int().min(1).max(1000).nullable().optional(),
  costoActual: z.number().int().min(0).nullable().optional(),
});

const esquemaUsuario = z.object({
  username: z.string().min(3).max(40),
  password: z.string().max(80).optional(),
  rol: z.enum(ROLES_USUARIO),
});

const esquemaNuevaCompra = z.object({
  proveedorId: z.number().int().positive(),
  formaPago: z.enum(FORMAS_PAGO),
  notas: textoOpcional(500),
  items: z
    .array(
      z.object({
        articuloId: z.number().int().positive(),
        cantidadCompra: z.number().min(0.0001).max(1_000_000),
        unidadCompraId: z.number().int().positive(),
        factorConversion: z.number().min(0.0001).max(1_000_000),
        costoUnitario: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(100),
});

const esquemaApertura = z.object({
  montoApertura: z.number().int().min(0),
  usuario: textoOpcional(80),
});

const esquemaCierre = z.object({ montoCierreReal: z.number().int().min(0) });

const esquemaMovimientoCaja = z.object({
  tipo: z.enum(TIPOS_MOVIMIENTO_CAJA),
  concepto: z.string().min(3).max(160),
  monto: z.number().int().positive(),
  usuario: textoOpcional(80),
  notas: textoOpcional(300),
});

const esquemaCobroPago = z.object({
  entidadTipo: z.enum(TIPOS_ENTIDAD_CC),
  entidadId: z.number().int().positive(),
  monto: z.number().int().positive(),
  medio: z.enum(['efectivo', 'cheque', 'transferencia']),
  notas: textoOpcional(300),
});

const esquemaAjuste = z.object({
  articuloId: z.number().int().positive(),
  cantidad: z.number().refine((n) => n !== 0, 'El ajuste no puede ser cero').gte(-1_000_000).lte(1_000_000),
  motivo: z.string().min(3).max(300),
  esMerma: z.boolean().optional(),
});

const esquemaReceta = z.object({
  articuloProducidoId: z.number().int().positive(),
  rindeCantidad: z.number().gt(0).max(1_000_000),
  notas: textoOpcional(500),
  items: z
    .array(
      z.object({
        articuloInsumoId: z.number().int().positive(),
        cantidad: z.number().gt(0).max(1_000_000),
        mermaEsperadaPct: z.number().min(0).max(100).optional(),
      }),
    )
    .min(1)
    .max(50),
});

const esquemaListaPrecio = z.object({ nombre: z.string().min(2).max(80) });

const esquemaPrecio = z.object({
  listaPrecioId: z.number().int().positive(),
  articuloId: z.number().int().positive(),
  precio: z.number().int().min(0),
});

const esquemaNuevaOrden = z.object({
  recetaId: z.number().int().positive(),
  factorEscala: z.number().min(0.01).max(100),
  pedidoId: z.number().int().positive().nullable().optional(),
  notas: textoOpcional(500),
});

export function registrarRutasEscritura(app: FastifyInstance): void {
  /* -------------------------------- Clientes ------------------------------- */

  app.post('/api/clientes', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaCliente, request.body, 'El cliente enviado no es valido.');
    return reply.status(201).send({ datos: maestrosServicio.crearCliente(entrada) });
  });

  app.put('/api/clientes/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del cliente no es valido.');
    const entrada = validarOFallar(esquemaCliente, request.body, 'El cliente enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.actualizarCliente(id, entrada) });
  });

  app.patch('/api/clientes/:id/activo', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del cliente no es valido.');
    const { activo } = validarOFallar(esquemaActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.cambiarActivoCliente(id, activo) });
  });

  /* ------------------------------ Proveedores ------------------------------ */

  app.post('/api/proveedores', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaProveedor, request.body, 'El proveedor enviado no es valido.');
    return reply.status(201).send({ datos: maestrosServicio.crearProveedor(entrada) });
  });

  app.put('/api/proveedores/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del proveedor no es valido.');
    const entrada = validarOFallar(esquemaProveedor, request.body, 'El proveedor enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.actualizarProveedor(id, entrada) });
  });

  app.patch('/api/proveedores/:id/activo', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del proveedor no es valido.');
    const { activo } = validarOFallar(esquemaActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.cambiarActivoProveedor(id, activo) });
  });

  /* -------------------------------- Articulos ------------------------------ */

  app.post('/api/articulos', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaArticulo, request.body, 'El articulo enviado no es valido.');
    return reply.status(201).send({ datos: { id: maestrosServicio.crearArticulo(entrada) } });
  });

  app.put('/api/articulos/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del articulo no es valido.');
    const entrada = validarOFallar(esquemaArticulo, request.body, 'El articulo enviado no es valido.');
    return reply.status(200).send({ datos: { id: maestrosServicio.actualizarArticulo(id, entrada) } });
  });

  app.patch('/api/articulos/:id/activo', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del articulo no es valido.');
    const { activo } = validarOFallar(esquemaActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: { id: maestrosServicio.cambiarActivoArticulo(id, activo) } });
  });

  /* -------------------------------- Usuarios ------------------------------- */

  app.post('/api/usuarios', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaUsuario, request.body, 'El usuario enviado no es valido.');
    return reply.status(201).send({ datos: maestrosServicio.crearUsuario(entrada) });
  });

  app.put('/api/usuarios/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del usuario no es valido.');
    const entrada = validarOFallar(esquemaUsuario, request.body, 'El usuario enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.actualizarUsuario(id, entrada) });
  });

  app.patch('/api/usuarios/:id/activo', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del usuario no es valido.');
    const { activo } = validarOFallar(esquemaActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: maestrosServicio.cambiarActivoUsuario(id, activo) });
  });

  /* --------------------------------- Compras ------------------------------- */

  app.post('/api/compras', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaNuevaCompra, request.body, 'La compra enviada no es valida.');
    return reply.status(201).send({ datos: comprasServicio.crearCompra(entrada) });
  });

  app.patch('/api/compras/:id/anular', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la compra no es valido.');
    return reply.status(200).send({ datos: comprasServicio.anularCompra(id) });
  });

  /* -------------------------------- Tesoreria ------------------------------ */

  app.post('/api/caja/abrir', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaApertura, request.body, 'La apertura enviada no es valida.');
    return reply
      .status(201)
      .send({ datos: tesoreriaServicio.abrirCaja(entrada.montoApertura, entrada.usuario ?? null) });
  });

  app.patch('/api/caja/:id/cerrar', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la caja no es valido.');
    const entrada = validarOFallar(esquemaCierre, request.body, 'El cierre enviado no es valido.');
    return reply.status(200).send({ datos: tesoreriaServicio.cerrarCaja(id, entrada) });
  });

  app.post('/api/caja/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaMovimientoCaja, request.body, 'El movimiento enviado no es valido.');
    return reply.status(201).send({ datos: tesoreriaServicio.registrarMovimientoCaja(entrada) });
  });

  app.post('/api/cuentas-corrientes/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaCobroPago, request.body, 'El cobro o pago enviado no es valido.');
    return reply.status(201).send({ datos: tesoreriaServicio.registrarCobroPago(entrada) });
  });

  /* ---------------------------- Ajustes de stock --------------------------- */

  app.post('/api/stock/ajustes', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaAjuste, request.body, 'El ajuste enviado no es valido.');
    return reply.status(201).send({ datos: ajustesServicio.ajustarStock(entrada) });
  });

  /* --------------------------------- Recetas ------------------------------- */

  app.post('/api/recetas', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaReceta, request.body, 'La receta enviada no es valida.');
    return reply.status(201).send({ datos: ajustesServicio.guardarReceta(null, entrada) });
  });

  app.put('/api/recetas/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la receta no es valido.');
    const entrada = validarOFallar(esquemaReceta, request.body, 'La receta enviada no es valida.');
    return reply.status(200).send({ datos: ajustesServicio.guardarReceta(id, entrada) });
  });

  app.patch('/api/recetas/:id/activa', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la receta no es valido.');
    const { activo } = validarOFallar(esquemaActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: ajustesServicio.cambiarActivaReceta(id, activo) });
  });

  /* ----------------------------- Listas de precio -------------------------- */

  app.post('/api/listas-precio', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaListaPrecio, request.body, 'La lista enviada no es valida.');
    return reply.status(201).send({ datos: ajustesServicio.crearListaPrecio(entrada) });
  });

  app.post('/api/listas-precio/precios', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaPrecio, request.body, 'El precio enviado no es valido.');
    return reply.status(201).send({ datos: ajustesServicio.fijarPrecio(entrada) });
  });

  /* ----------------------- Arranque con datos reales ----------------------- */

  app.get('/api/sistema/datos-demo', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: inicializacionServicio.contarDatosExistentes() });
  });

  app.post('/api/sistema/empezar-de-cero', (request: FastifyRequest, reply: FastifyReply) => {
    const { confirmacion } = validarOFallar(
      z.object({ confirmacion: z.string() }),
      request.body,
      'Falta la confirmacion.',
    );
    return reply.status(200).send({ datos: inicializacionServicio.empezarDeCero(confirmacion) });
  });

  /* ------------------------------- Produccion ------------------------------ */

  app.post('/api/produccion/ordenes', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaNuevaOrden, request.body, 'La orden enviada no es valida.');
    return reply.status(201).send({ datos: produccionServicio.crearOrden(entrada) });
  });
}
