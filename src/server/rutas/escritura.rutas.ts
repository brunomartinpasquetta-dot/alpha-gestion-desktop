/**
 * Rutas de ESCRITURA de maestros, compras, tesoreria y planificacion.
 *
 * Convencion en todo el modulo: POST crea, PUT reemplaza, PATCH cambia un
 * aspecto puntual (el estado). No existe DELETE: dar de baja es PATCH .../activo
 * con `false`, porque el ledger referencia a estas entidades y borrarlas dejaria
 * documentos apuntando al vacio.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

import {
  FORMAS_PAGO,
  ROLES_USUARIO,
  TIPOS_ARTICULO,
  TIPOS_CLIENTE,
  TIPOS_ENTIDAD_CC,
  TIPOS_MOVIMIENTO_CAJA,
} from '../db/schema';
import { cerrarDb, obtenerDb, obtenerRutaDb, obtenerSqlite } from '../db/conexion';
import { leerConfig } from '../config';
import { escribirConfigLocal } from '../config-local';
import { detenerTunel, estadoTunel, iniciarTunel } from '../tunel';
import { promocionesServicio } from '../servicios/promociones.servicio';
import { cajaGeneralServicio } from '../servicios/caja-general.servicio';
import { eq } from 'drizzle-orm';

import { mediosPago } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { sembrarAnyulin, sembrarPadronAnyulin } from '../../seed/anyulin';
import { formatearIssuesZod } from '../plugins/manejador-errores';
import { ajustesServicio } from '../servicios/ajustes.servicio';
import { comprasServicio } from '../servicios/compras.servicio';
import { preciosMasivoServicio } from '../servicios/precios-masivo.servicio';
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
  tipoDocumento: textoOpcional(20),
  numeroDocumento: textoOpcional(30),
  condicionIva: z.number().int().min(1).max(20).optional(),
  telefono: textoOpcional(40),
  celular: textoOpcional(40),
  localidad: textoOpcional(80),
  limiteCredito: z.number().int().min(0).optional(),
  email: textoOpcional(120),
  direccion: textoOpcional(200),
  tipo: z.enum(TIPOS_CLIENTE),
  listaPrecioId: z.number().int().positive().nullable().optional(),
  notas: textoOpcional(500),
});

const esquemaProveedor = z.object({
  codigo: textoOpcional(20),
  nombre: z.string().min(2).max(120),
  cuit: textoOpcional(20),
  iibb: textoOpcional(40),
  telefono: textoOpcional(40),
  celular: textoOpcional(40),
  localidad: textoOpcional(80),
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
  stockIdeal: z.number().min(0).max(1_000_000).nullable().optional(),
  codigoBarras: textoOpcional(40),
  marca: textoOpcional(80),
  familiaId: z.number().int().positive().nullable().optional(),
  proveedorHabitualId: z.number().int().positive().nullable().optional(),
  alicuotaIva: z.number().optional(),
  porPeso: z.boolean().optional(),
  notas: textoOpcional(500),
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

const esquemaChequeCobro = z.object({
  numero: z.string().min(1).max(40),
  fechaPago: z.string().min(10).max(10),
  banco: textoOpcional(80),
  cuitEmisor: textoOpcional(20),
  formato: z.enum(['fisico', 'echeq']).optional(),
});

const esquemaCobroPago = z.object({
  entidadTipo: z.enum(TIPOS_ENTIDAD_CC),
  entidadId: z.number().int().positive(),
  monto: z.number().int().positive(),
  medio: z.enum(['efectivo', 'cheque', 'transferencia']),
  // Va solo cuando el medio es cheque; el servicio lo exige en ese caso.
  cheque: esquemaChequeCobro.nullable().optional(),
  // Composicion del pago: cuanto entra por cada medio. La suma tiene que dar
  // `monto`, y eso lo valida el servicio.
  tramos: z
    .array(
      z.object({
        medio: z.enum(['efectivo', 'cheque', 'transferencia']),
        importe: z.number().int().positive(),
        cheque: esquemaChequeCobro.nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  imputarFifo: z.boolean().optional(),
  notas: textoOpcional(300),
});

/** Promocion: composicion + precio por lista + ventana de vigencia. */
const esquemaPromocion = z.object({
  nombre: z.string().trim().min(2).max(120),
  codigo: z.string().trim().min(1).max(30),
  vigenciaDesde: z.string().length(10).nullable().optional(),
  vigenciaHasta: z.string().length(10).nullable().optional(),
  activo: z.boolean().optional(),
  componentes: z
    .array(z.object({ articuloId: z.number().int().positive(), unidades: z.number().positive() }))
    .min(1),
  precios: z
    .array(
      z.object({ listaPrecioId: z.number().int().positive(), precio: z.number().int().positive() }),
    )
    .min(1),
});

const esquemaPromocionActivo = z.object({ activo: z.boolean() });

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

const esquemaActualizacionPrecios = z.object({
  articuloIds: z.array(z.number().int().positive()).min(1).max(5000),
  listaPrecioId: z.number().int().positive(),
  sobreCosto: z.boolean().optional(),
  modo: z.enum(['porcentaje', 'monto_fijo', 'valor_exacto']),
  valor: z.number(),
  redondeo: z.string().max(20).optional(),
});

const esquemaNuevaOrden = z.object({
  recetaId: z.number().int().positive(),
  cantidad: z.number().gt(0).max(1_000_000),
  pedidoId: z.number().int().positive().nullable().optional(),
  notas: textoOpcional(500),
});

export function registrarRutasEscritura(app: FastifyInstance): void {
  /* -------------------------------- Clientes ------------------------------- */

  /* ------------------------------ Caja general ----------------------------- */

  app.post('/api/caja-general/movimientos', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      z.object({
        tipo: z.enum(['ingreso', 'egreso']),
        monto: z.number().int().positive(),
        concepto: z.string().min(2).max(200),
        categoria: z
          .enum(['deposito_cierre', 'retiro', 'servicios', 'sueldos', 'impuestos', 'proveedores', 'otros'])
          .nullable()
          .optional(),
        esEfectivo: z.boolean().default(true),
        usuario: z.string().max(80).nullable().optional(),
      }),
      request.body,
      'El movimiento de caja general no es valido.',
    );
    return reply.status(201).send({ datos: cajaGeneralServicio.registrar(entrada) });
  });

  app.post('/api/caja-general/recalcular', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: cajaGeneralServicio.recalcular() });
  });

  /* ----------------------------- Medios de pago ---------------------------- */

  app.post('/api/medios-pago', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      z.object({
        nombre: z.string().min(2).max(60),
        tipo: z.enum(['efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito', 'cheque', 'otro']),
        esEfectivoFisico: z.boolean().default(false),
        comisionPct: z.number().min(0).max(100).default(0),
        orden: z.number().int().min(0).max(999).default(0),
      }),
      request.body,
      'El medio de pago enviado no es valido.',
    );
    const fila = ejecutarSeguro('crear un medio de pago', () =>
      obtenerDb().insert(mediosPago).values(entrada).returning({ id: mediosPago.id }).all()[0]!,
    );
    emitir('maestros:cambio');
    return reply.status(201).send({ datos: fila });
  });

  app.put('/api/medios-pago/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador no es valido.');
    const entrada = validarOFallar(
      z.object({
        nombre: z.string().min(2).max(60),
        tipo: z.enum(['efectivo', 'transferencia', 'tarjeta_debito', 'tarjeta_credito', 'cheque', 'otro']),
        esEfectivoFisico: z.boolean(),
        comisionPct: z.number().min(0).max(100),
        orden: z.number().int().min(0).max(999),
        activo: z.boolean(),
      }),
      request.body,
      'El medio de pago enviado no es valido.',
    );
    ejecutarSeguro('actualizar un medio de pago', () => {
      const existente = obtenerDb().select().from(mediosPago).where(eq(mediosPago.id, id)).get();
      if (!existente) throw new ErrorNoEncontrado('medio de pago', id);
      obtenerDb().update(mediosPago).set(entrada).where(eq(mediosPago.id, id)).run();
      return true;
    });
    emitir('maestros:cambio');
    return reply.status(200).send({ datos: { id } });
  });

  /* ------------------------------- Vendedores ------------------------------ */

  app.post('/api/vendedores', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      z.object({
        nombre: z.string().min(2).max(80),
        telefono: z.string().max(40).nullable().optional(),
        cuit: z.string().max(20).nullable().optional(),
        clienteId: z.number().int().positive().nullable().optional(),
        notas: z.string().max(300).nullable().optional(),
      }),
      request.body,
      'El vendedor enviado no es valido.',
    );
    return reply.status(201).send({ datos: maestrosServicio.crearVendedor(entrada) });
  });

  app.put('/api/vendedores/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador no es valido.');
    const entrada = validarOFallar(
      z.object({
        nombre: z.string().min(2).max(80),
        telefono: z.string().max(40).nullable().optional(),
        cuit: z.string().max(20).nullable().optional(),
        clienteId: z.number().int().positive().nullable().optional(),
        notas: z.string().max(300).nullable().optional(),
        activo: z.boolean(),
      }),
      request.body,
      'El vendedor enviado no es valido.',
    );
    return reply.status(200).send({ datos: maestrosServicio.actualizarVendedor(id, entrada) });
  });

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

  /* ------------------------------- Promociones ----------------------------- */

  app.post('/api/promociones', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaPromocion, request.body, 'La promocion enviada no es valida.');
    return reply.status(201).send({ datos: promocionesServicio.crear(entrada) });
  });

  app.put('/api/promociones/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la promocion no es valido.');
    const entrada = validarOFallar(esquemaPromocion, request.body, 'La promocion enviada no es valida.');
    return reply.status(200).send({ datos: promocionesServicio.actualizar(id, entrada) });
  });

  app.patch('/api/promociones/:id/activo', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la promocion no es valido.');
    const { activo } = validarOFallar(esquemaPromocionActivo, request.body, 'El estado enviado no es valido.');
    return reply.status(200).send({ datos: promocionesServicio.cambiarActivo(id, activo) });
  });

  /* ---------------------------- Ajustes de stock --------------------------- */

  app.post('/api/stock/ajustes', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaAjuste, request.body, 'El ajuste enviado no es valido.');
    return reply.status(201).send({ datos: ajustesServicio.ajustarStock(entrada) });
  });

  // Toma de inventario: todos los ajustes en una transaccion, o ninguno.
  app.post('/api/stock/ajustes/lote', (request: FastifyRequest, reply: FastifyReply) => {
    const { ajustes } = validarOFallar(
      z.object({ ajustes: z.array(esquemaAjuste).min(1).max(500) }),
      request.body,
      'La toma de inventario enviada no es valida.',
    );
    return reply.status(201).send({ datos: ajustesServicio.ajustarStockEnLote(ajustes) });
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

  // Catalogo REAL de Anyulin (variedades, surtidas, 10 listas, precios de la
  // planilla del cliente). Idempotente: correrlo dos veces no duplica.
  app.post('/api/sistema/cargar-anyulin', (_request: FastifyRequest, reply: FastifyReply) => {
    const resumen = ejecutarSeguro('cargar el catalogo Anyulin', () => sembrarAnyulin(obtenerDb()));
    emitir('maestros:cambio');
    return reply.status(200).send({ datos: resumen });
  });

  // Padron REAL de clientes del Excel (51 clientes con lista y vendedor).
  // Borra los clientes de demo; el que tenga historia se desactiva.
  app.post('/api/sistema/cargar-padron', (_request: FastifyRequest, reply: FastifyReply) => {
    const resumen = ejecutarSeguro('cargar el padron de clientes Anyulin', () =>
      sembrarPadronAnyulin(obtenerDb()),
    );
    emitir('maestros:cambio');
    return reply.status(200).send({ datos: resumen });
  });

  app.post('/api/sistema/cargar-demo', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: inicializacionServicio.cargarDemostracion() });
  });

  // Acceso remoto: estado del PIN y del tunel (solo desde el escritorio).
  app.get('/api/sistema/acceso-remoto', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({
      datos: { pinConfigurado: leerConfig().pinPedidos !== undefined, tunel: estadoTunel() },
    });
  });

  app.post('/api/sistema/pin', (request: FastifyRequest, reply: FastifyReply) => {
    const { pin } = validarOFallar(
      z.object({ pin: z.string().max(20) }),
      request.body,
      'El PIN enviado no es valido.',
    );
    const limpio = pin.trim();
    if (limpio !== '' && limpio.length < 4) {
      throw new ErrorValidacion('El PIN tiene que tener al menos 4 caracteres (o vacio para sacarlo).');
    }
    escribirConfigLocal({ pinPedidos: limpio });
    return reply.status(200).send({ datos: { pinConfigurado: limpio !== '' } });
  });

  app.post('/api/sistema/tunel', async (request: FastifyRequest, reply: FastifyReply) => {
    const { activar } = validarOFallar(
      z.object({ activar: z.boolean() }),
      request.body,
      'La orden del tunel no es valida.',
    );
    if (activar && leerConfig().pinPedidos === undefined) {
      throw new ErrorValidacion('Antes de abrir el tunel configura el PIN: es lo unico que protege el acceso desde internet.');
    }
    const estado = activar ? await iniciarTunel(leerConfig().puerto) : detenerTunel();
    // Se guarda la INTENCION, no el resultado del primer intento: si el duenio
    // lo activo y justo fallo (sin internet, puerto tomado), el tunel reintenta
    // solo y ademas se vuelve a levantar en el proximo arranque de la PC.
    escribirConfigLocal({ tunelActivado: activar });
    return reply.status(200).send({ datos: estado });
  });

  // Respaldo de la base con la API de backup de SQLite (consistente aun con
  // la base en uso). Cae en Descargas con fecha y hora en el nombre.
  app.post('/api/sistema/respaldar', async (_request: FastifyRequest, reply: FastifyReply) => {
    const ahora = new Date();
    const sello = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}-${String(ahora.getHours()).padStart(2, '0')}${String(ahora.getMinutes()).padStart(2, '0')}`;
    const destino = path.join(os.homedir(), 'Downloads', `alpha-gestion-respaldo-${sello}.db`);
    await obtenerSqlite().backup(destino);
    return reply.status(200).send({ datos: { ruta: destino } });
  });

  // Restauracion: reemplaza la base por el archivo elegido. El actual queda
  // resguardado al lado. Despues hay que REINICIAR el programa (el renderer
  // lo dispara): las migraciones corren al arrancar sobre la base restaurada.
  app.post('/api/sistema/restaurar', (request: FastifyRequest, reply: FastifyReply) => {
    const { ruta } = validarOFallar(
      z.object({ ruta: z.string().min(3) }),
      request.body,
      'La ruta del respaldo no es valida.',
    );
    const encabezado = Buffer.alloc(16);
    const fd = fs.openSync(ruta, 'r');
    try {
      fs.readSync(fd, encabezado, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (!encabezado.toString('utf8').startsWith('SQLite format 3')) {
      throw new ErrorValidacion('El archivo elegido no es una base de datos de Alpha Gestion.');
    }
    const rutaDb = obtenerRutaDb();
    const sello = Date.now();
    const resguardo = `${rutaDb}.antes-de-restaurar-${sello}`;

    /*
     * El resguardo "antes de restaurar" es la unica red que tiene el operador
     * cuando elige el respaldo equivocado. Antes se copiaba el archivo
     * principal SIN volcar el WAL, y acto seguido se borraba el -wal: todo lo
     * escrito desde el ultimo checkpoint —una maniana entera de ventas, si no
     * se llegaron a las 1000 paginas— no estaba ni en el resguardo ni en la
     * base. Se perdia sin manera de volver.
     * El checkpoint vuelca el WAL al archivo antes de copiarlo.
     */
    obtenerSqlite().pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(rutaDb, resguardo);

    cerrarDb();

    /*
     * A un temporal y despues rename: copiar directo sobre la base viva deja
     * un archivo truncado si el disco se llena o el respaldo esta en un pendrive
     * que se desconecta a mitad. El rename dentro del mismo directorio es
     * atomico, asi que la base o es la vieja o es la nueva, nunca media.
     */
    const temporal = `${rutaDb}.restaurando-${sello}`;
    try {
      fs.copyFileSync(ruta, temporal);
      fs.rmSync(`${rutaDb}-wal`, { force: true });
      fs.rmSync(`${rutaDb}-shm`, { force: true });
      fs.renameSync(temporal, rutaDb);
    } catch (causa) {
      fs.rmSync(temporal, { force: true });
      throw causa;
    }

    return reply.status(200).send({ datos: { ok: true, resguardo } });
  });

  app.post('/api/sistema/empezar-de-cero', (request: FastifyRequest, reply: FastifyReply) => {
    const { confirmacion } = validarOFallar(
      z.object({ confirmacion: z.string() }),
      request.body,
      'Falta la confirmacion.',
    );
    return reply.status(200).send({ datos: inicializacionServicio.empezarDeCero(confirmacion) });
  });

  app.put('/api/listas-precio/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador de la lista no es valido.');
    const entrada = validarOFallar(
      z.object({ nombre: z.string().min(2).max(80), activa: z.boolean() }),
      request.body,
      'La lista enviada no es valida.',
    );
    return reply
      .status(200)
      .send({ datos: ajustesServicio.actualizarListaPrecio(id, entrada.nombre, entrada.activa) });
  });

  app.delete('/api/listas-precio/precios/:id', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del precio no es valido.');
    return reply.status(200).send({ datos: ajustesServicio.borrarPrecio(id) });
  });

  /* --------------------- Precios de un articulo puntual -------------------- */

  app.get('/api/articulos/:id/precios', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del articulo no es valido.');
    return reply.status(200).send({ datos: ajustesServicio.preciosDeArticulo(id) });
  });

  app.put('/api/articulos/:id/precios', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del articulo no es valido.');
    const entrada = validarOFallar(
      z.object({
        precios: z
          .array(z.object({ listaPrecioId: z.number().int().positive(), precio: z.number().int().min(0) }))
          .max(20),
      }),
      request.body,
      'Los precios enviados no son validos.',
    );
    return reply
      .status(200)
      .send({ datos: ajustesServicio.fijarPreciosDeArticulo(id, entrada.precios) });
  });

  /* ---------------------- Actualizacion masiva de precios ------------------ */

  app.post('/api/precios/vista-previa', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaActualizacionPrecios, request.body, 'La actualizacion no es valida.');
    return reply.status(200).send({ datos: preciosMasivoServicio.vistaPrevia(entrada) });
  });

  app.post('/api/precios/aplicar', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaActualizacionPrecios, request.body, 'La actualizacion no es valida.');
    return reply.status(200).send({ datos: preciosMasivoServicio.aplicar(entrada) });
  });

  app.get('/api/precios/lotes', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: preciosMasivoServicio.listarLotes() });
  });

  app.post('/api/precios/lotes/:id/revertir', (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = validarOFallar(esquemaId, request.params, 'El identificador del lote no es valido.');
    return reply.status(200).send({ datos: preciosMasivoServicio.revertirLote(id) });
  });

  /* --------------------------- Sugerencia de compra ------------------------ */

  app.get('/api/reposicion', (request: FastifyRequest, reply: FastifyReply) => {
    const { criterio } = validarOFallar(
      z.object({ criterio: z.enum(['minimo', 'ideal']).default('ideal') }),
      request.query,
      'El criterio de reposicion no es valido.',
    );
    return reply.status(200).send({ datos: preciosMasivoServicio.sugerenciaDeCompra(criterio) });
  });

  /* -------------------------------- Familias ------------------------------- */

  app.get('/api/familias', (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.status(200).send({ datos: ajustesServicio.listarFamilias() });
  });

  app.post('/api/familias', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(
      z.object({ nombre: z.string().min(2).max(80), padreId: z.number().int().positive().nullable().optional() }),
      request.body,
      'La familia enviada no es valida.',
    );
    return reply
      .status(201)
      .send({ datos: ajustesServicio.crearFamilia(entrada.nombre, entrada.padreId ?? null) });
  });

  /* ------------------------------- Produccion ------------------------------ */

  app.post('/api/produccion/ordenes', (request: FastifyRequest, reply: FastifyReply) => {
    const entrada = validarOFallar(esquemaNuevaOrden, request.body, 'La orden enviada no es valida.');
    return reply.status(201).send({ datos: produccionServicio.crearOrden(entrada) });
  });
}
