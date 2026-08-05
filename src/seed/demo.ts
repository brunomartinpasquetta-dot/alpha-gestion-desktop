/**
 * Set de datos de DEMOSTRACION (flag ALFAJORES_SEED_DEMO=1).
 *
 * El seed base carga el catalogo minimo. Este modulo agrega encima un negocio
 * en marcha —compras, produccion, ventas, pedidos, caja y cuentas corrientes—
 * para que las pantallas de los modulos tengan algo real que mostrar.
 *
 * COHERENCIA CON LOS LEDGERS (es lo que hace que los numeros cierren):
 *  - Cada compra `recibida` genera su movimiento de stock POSITIVO.
 *  - Cada venta `entregada` genera su movimiento NEGATIVO.
 *  - Cada orden `finalizada` genera un consumo NEGATIVO por insumo y un ingreso
 *    POSITIVO del articulo producido, mas sus filas en `produccion_consumos`.
 *  - Las operaciones de contado impactan en la caja del dia; las de cuenta
 *    corriente, en el ledger `cuentas_corrientes`.
 *  - La linea de tiempo esta ordenada para que NINGUN articulo quede con stock
 *    negativo en ningun momento: primero se compra, despues se produce, al final
 *    se vende. Las cantidades producidas no dependen del flag de movimientos del
 *    seed base, asi el demo cierra tanto con ese flag prendido como apagado.
 *
 * IDEMPOTENCIA: todas las filas del demo llevan un marcador `[demo:...]` en su
 * campo `notas`. Como el bloque entero se inserta en una sola transaccion, con
 * detectar UNA fila marcada alcanza para saber que ya fue sembrado y saltearlo.
 */

import { and, eq, like, sql } from 'drizzle-orm';

import {
  articulos,
  cajaMovimientos,
  cajas,
  clientes,
  compraItems,
  compras,
  cuentasCorrientes,
  listasPrecio,
  movimientosStock,
  ordenesProduccion,
  pedidoItems,
  pedidos,
  precios,
  produccionConsumos,
  proveedores,
  recetaItems,
  recetas,
  unidadesMedida,
  ventaItems,
  ventas,
} from '../server/db/schema';
import type { BaseDatos } from '../server/db/conexion';
import { calcularSubtotalCentavos, redondearCantidad } from '../server/utiles/numeros';

type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

/** Variable de entorno que habilita el sembrado de datos de demostracion. */
export const VARIABLE_ENTORNO_DEMO = 'ALFAJORES_SEED_DEMO';

export function demoHabilitado(): boolean {
  return process.env[VARIABLE_ENTORNO_DEMO] === '1';
}

export interface ResumenDemo {
  readonly sembrado: boolean;
  readonly yaExistia: boolean;
  readonly proveedores: number;
  readonly clientes: number;
  readonly listasPrecio: number;
  readonly articulos: number;
  readonly recetas: number;
  readonly compras: number;
  readonly ordenes: number;
  readonly ventas: number;
  readonly pedidos: number;
  readonly cajas: number;
  readonly movimientosStock: number;
  readonly movimientosCc: number;
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                 */
/* -------------------------------------------------------------------------- */

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Fecha ISO-8601 UTC a N dias del momento de correr el seed. Todo el demo usa
 * fechas relativas: sembrado dentro de seis meses tiene que seguir viendose
 * fresco, no anclado a una fecha muerta del pasado.
 */
function haceDias(dias: number, hora = 12): string {
  const fecha = new Date(Date.now() - dias * MS_POR_DIA);
  fecha.setUTCHours(hora, 0, 0, 0);
  return fecha.toISOString();
}

function exigir<T>(valor: T | undefined, descripcion: string): T {
  if (valor === undefined) {
    throw new Error(`Seed demo: falta ${descripcion}. Corre primero el seed base.`);
  }
  return valor;
}

/** Inserta una fila y devuelve su id, fallando fuerte si la base no lo devuelve. */
function insertarId<T extends { id: number }>(filas: T[], descripcion: string): number {
  return exigir(filas[0], `el id generado para ${descripcion}`).id;
}

/* -------------------------------------------------------------------------- */
/* Catalogo que agrega el demo                                                */
/* -------------------------------------------------------------------------- */

const PROVEEDORES_DEMO = [
  {
    nombre: 'Chocolates del Sur SA',
    cuit: '30-71234567-9',
    telefono: '351 456-7890',
    email: 'ventas@chocolatesdelsur.com.ar',
    direccion: 'Av. Colon 1450, Cordoba',
  },
  {
    nombre: 'Almacen Mayorista El Puente',
    cuit: '30-70987654-3',
    telefono: '351 422-1133',
    email: 'pedidos@elpuente.com.ar',
    direccion: 'Bv. Los Alemanes 780, Cordoba',
  },
] as const;

const CLIENTES_DEMO = [
  { nombre: 'Kiosco La Esquina', tipo: 'mostrador', cuit: null, telefono: '351 300-1122' },
  { nombre: 'Distribuidora Sierras', tipo: 'distribuidor', cuit: '30-71555444-2', telefono: '351 411-0099' },
  { nombre: 'Cafeteria Central', tipo: 'mayorista', cuit: '27-33222111-4', telefono: '351 480-5566' },
  { nombre: 'Panaderia Don Pedro', tipo: 'mayorista', cuit: '20-28999888-1', telefono: '351 499-3344' },
] as const;

const ARTICULOS_DEMO = [
  {
    codigo: 'MP-CHO-001',
    nombre: 'Cobertura de chocolate',
    tipo: 'materia_prima',
    unidad: 'g',
    stockMin: 2000,
    costoActual: 900,
  },
  {
    codigo: 'MP-COC-001',
    nombre: 'Coco rallado',
    tipo: 'materia_prima',
    unidad: 'g',
    stockMin: 1000,
    costoActual: 400,
  },
  {
    codigo: 'PT-ALF-CHO',
    nombre: 'Alfajor de chocolate',
    tipo: 'producto_terminado',
    unidad: 'u',
    stockMin: 80,
    unidadesPorCaja: 12,
    costoActual: 110000,
  },
  {
    codigo: 'PT-ALF-TRI',
    nombre: 'Alfajor triple',
    tipo: 'producto_terminado',
    unidad: 'u',
    stockMin: 60,
    unidadesPorCaja: 12,
    costoActual: 130000,
  },
] as const;

/* -------------------------------------------------------------------------- */
/* Deteccion de sembrado previo                                               */
/* -------------------------------------------------------------------------- */

/** True si el demo ya fue sembrado en esta base. */
function demoYaSembrado(tx: Transaccion): boolean {
  const fila = tx
    .select({ total: sql<number>`COUNT(*)`.mapWith(Number) })
    .from(compras)
    .where(like(compras.notas, '[demo:%'))
    .get();
  return (fila?.total ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* Sembrado                                                                   */
/* -------------------------------------------------------------------------- */

interface Contexto {
  readonly tx: Transaccion;
  readonly unidades: ReadonlyMap<string, number>;
  readonly articulos: Map<string, number>;
  readonly proveedores: Map<string, number>;
  readonly clientes: Map<string, number>;
  readonly listas: Map<string, number>;
}

function mapearUnidades(tx: Transaccion): Map<string, number> {
  const filas = tx
    .select({ id: unidadesMedida.id, abreviatura: unidadesMedida.abreviatura })
    .from(unidadesMedida)
    .all();
  return new Map(filas.map((f) => [f.abreviatura, f.id]));
}

function mapearArticulos(tx: Transaccion): Map<string, number> {
  const filas = tx.select({ id: articulos.id, codigo: articulos.codigo }).from(articulos).all();
  return new Map(filas.map((f) => [f.codigo, f.id]));
}

function articuloId(ctx: Contexto, codigo: string): number {
  return exigir(ctx.articulos.get(codigo), `el articulo ${codigo}`);
}

/** Alta de los articulos nuevos del demo, con su unidad base resuelta. */
function sembrarArticulosDemo(ctx: Contexto): number {
  let creados = 0;
  for (const definicion of ARTICULOS_DEMO) {
    if (ctx.articulos.has(definicion.codigo)) continue;
    const id = insertarId(
      ctx.tx
        .insert(articulos)
        .values({
          codigo: definicion.codigo,
          nombre: definicion.nombre,
          tipo: definicion.tipo,
          unidadBaseId: exigir(ctx.unidades.get(definicion.unidad), `la unidad ${definicion.unidad}`),
          stockMin: definicion.stockMin,
          unidadesPorCaja: 'unidadesPorCaja' in definicion ? definicion.unidadesPorCaja : null,
          costoActual: definicion.costoActual,
          activo: true,
        })
        .returning({ id: articulos.id })
        .all(),
      `el articulo ${definicion.codigo}`,
    );
    ctx.articulos.set(definicion.codigo, id);
    creados += 1;
  }
  return creados;
}

/** Recetas de los dos productos nuevos. Encadenan con el pre-elaborado del seed base. */
function sembrarRecetasDemo(ctx: Contexto): number {
  const definiciones = [
    {
      producido: 'PT-ALF-CHO',
      rinde: 12,
      unidad: 'u',
      notas: 'Alfajor bañado en chocolate. Rinde una placa.',
      items: [
        { insumo: 'PE-DDL-001', cantidad: 240, merma: 2 },
        { insumo: 'MP-TAP-001', cantidad: 24, merma: 3 },
        { insumo: 'MP-CHO-001', cantidad: 180, merma: 5 },
      ],
    },
    {
      producido: 'PT-ALF-TRI',
      rinde: 12,
      unidad: 'u',
      notas: 'Triple: tres tapas, doble capa de dulce, borde de coco.',
      items: [
        { insumo: 'PE-DDL-001', cantidad: 360, merma: 2 },
        { insumo: 'MP-TAP-001', cantidad: 36, merma: 3 },
        { insumo: 'MP-COC-001', cantidad: 60, merma: 4 },
      ],
    },
  ] as const;

  let creadas = 0;
  for (const definicion of definiciones) {
    const producidoId = articuloId(ctx, definicion.producido);
    const existente = ctx.tx
      .select({ id: recetas.id })
      .from(recetas)
      .where(eq(recetas.articuloProducidoId, producidoId))
      .get();
    if (existente) continue;

    const recetaId = insertarId(
      ctx.tx
        .insert(recetas)
        .values({
          articuloProducidoId: producidoId,
          rindeCantidad: definicion.rinde,
          rindeUnidadId: exigir(ctx.unidades.get(definicion.unidad), `la unidad ${definicion.unidad}`),
          activa: true,
          notas: definicion.notas,
        })
        .returning({ id: recetas.id })
        .all(),
      `la receta de ${definicion.producido}`,
    );

    for (const item of definicion.items) {
      ctx.tx
        .insert(recetaItems)
        .values({
          recetaId,
          articuloInsumoId: articuloId(ctx, item.insumo),
          cantidad: item.cantidad,
          mermaEsperadaPct: item.merma,
        })
        .run();
    }
    creadas += 1;
  }
  return creadas;
}

function sembrarTercerosDemo(ctx: Contexto): { proveedores: number; clientes: number; listas: number } {
  let nuevosProveedores = 0;
  for (const definicion of PROVEEDORES_DEMO) {
    if (ctx.proveedores.has(definicion.nombre)) continue;
    const id = insertarId(
      ctx.tx
        .insert(proveedores)
        .values({ ...definicion, notas: '[demo:proveedor]', activo: true })
        .returning({ id: proveedores.id })
        .all(),
      `el proveedor ${definicion.nombre}`,
    );
    ctx.proveedores.set(definicion.nombre, id);
    nuevosProveedores += 1;
  }

  let nuevasListas = 0;
  if (!ctx.listas.has('Mayorista')) {
    const id = insertarId(
      ctx.tx
        .insert(listasPrecio)
        .values({ nombre: 'Mayorista', activa: true })
        .returning({ id: listasPrecio.id })
        .all(),
      'la lista Mayorista',
    );
    ctx.listas.set('Mayorista', id);
    nuevasListas += 1;
  }

  const listaMayorista = exigir(ctx.listas.get('Mayorista'), 'la lista Mayorista');
  let nuevosClientes = 0;
  for (const definicion of CLIENTES_DEMO) {
    if (ctx.clientes.has(definicion.nombre)) continue;
    const id = insertarId(
      ctx.tx
        .insert(clientes)
        .values({
          nombre: definicion.nombre,
          cuit: definicion.cuit,
          telefono: definicion.telefono,
          tipo: definicion.tipo,
          // Solo los que compran al por mayor tienen lista propia.
          listaPrecioId: definicion.tipo === 'mostrador' ? null : listaMayorista,
          notas: '[demo:cliente]',
          activo: true,
        })
        .returning({ id: clientes.id })
        .all(),
      `el cliente ${definicion.nombre}`,
    );
    ctx.clientes.set(definicion.nombre, id);
    nuevosClientes += 1;
  }

  return { proveedores: nuevosProveedores, clientes: nuevosClientes, listas: nuevasListas };
}

/** Precios de los productos nuevos en las dos listas. Mayorista siempre mas barato. */
function sembrarPreciosDemo(ctx: Contexto): void {
  const tabla = [
    { lista: 'General', articulo: 'PT-ALF-CHO', precio: 185000 },
    { lista: 'General', articulo: 'PT-ALF-TRI', precio: 210000 },
    { lista: 'Mayorista', articulo: 'PT-ALF-MAI', precio: 130000 },
    { lista: 'Mayorista', articulo: 'PT-ALF-CHO', precio: 150000 },
    { lista: 'Mayorista', articulo: 'PT-ALF-TRI', precio: 175000 },
  ] as const;

  for (const fila of tabla) {
    const listaId = ctx.listas.get(fila.lista);
    if (listaId === undefined) continue;
    const artId = articuloId(ctx, fila.articulo);
    const existente = ctx.tx
      .select({ id: precios.id })
      .from(precios)
      .where(and(eq(precios.articuloId, artId), eq(precios.listaPrecioId, listaId)))
      .get();
    if (existente) continue;

    ctx.tx
      .insert(precios)
      .values({
        articuloId: artId,
        listaPrecioId: listaId,
        precio: fila.precio,
        vigenteDesde: haceDias(30),
      })
      .run();
  }
}

/* ------------------------------- Movimientos ------------------------------- */

interface MovimientoDemo {
  articulo: string;
  tipo: 'compra' | 'venta' | 'consumo_produccion' | 'ingreso_produccion';
  cantidad: number;
  costoUnitario?: number;
  documentoTipo: 'compra' | 'venta' | 'orden_produccion';
  documentoId: number;
  fecha: string;
  notas: string;
}

function registrarMovimiento(ctx: Contexto, mov: MovimientoDemo): void {
  ctx.tx
    .insert(movimientosStock)
    .values({
      articuloId: articuloId(ctx, mov.articulo),
      tipo: mov.tipo,
      cantidad: redondearCantidad(mov.cantidad),
      costoUnitario: mov.costoUnitario ?? null,
      documentoTipo: mov.documentoTipo,
      documentoId: mov.documentoId,
      fecha: mov.fecha,
      notas: mov.notas,
    })
    .run();
}

/* --------------------------------- Compras -------------------------------- */

interface ItemCompraDemo {
  articulo: string;
  cantidadCompra: number;
  unidadCompra: string;
  factorConversion: number;
  costoUnitario: number;
}

interface CompraDemo {
  clave: string;
  proveedor: string;
  dias: number;
  formaPago: 'contado' | 'cuenta_corriente';
  estado: 'pendiente' | 'recibida';
  items: readonly ItemCompraDemo[];
}

const COMPRAS_DEMO: readonly CompraDemo[] = [
  {
    clave: 'compra-01',
    proveedor: 'Distribuidora La Espiga',
    dias: 21,
    formaPago: 'cuenta_corriente',
    estado: 'recibida',
    items: [
      { articulo: 'MP-HAR-0000', cantidadCompra: 4, unidadCompra: 'kg', factorConversion: 25000, costoUnitario: 115 },
      { articulo: 'MP-TAP-001', cantidadCompra: 20, unidadCompra: 'u', factorConversion: 200, costoUnitario: 8500 },
    ],
  },
  {
    clave: 'compra-02',
    proveedor: 'Distribuidora La Espiga',
    dias: 20,
    formaPago: 'cuenta_corriente',
    estado: 'recibida',
    items: [
      { articulo: 'MP-LEC-001', cantidadCompra: 60, unidadCompra: 'l', factorConversion: 1000, costoUnitario: 175 },
    ],
  },
  {
    clave: 'compra-03',
    proveedor: 'Chocolates del Sur SA',
    dias: 16,
    formaPago: 'cuenta_corriente',
    estado: 'recibida',
    items: [
      { articulo: 'MP-CHO-001', cantidadCompra: 20, unidadCompra: 'kg', factorConversion: 1000, costoUnitario: 900 },
    ],
  },
  {
    clave: 'compra-04',
    proveedor: 'Almacen Mayorista El Puente',
    dias: 10,
    formaPago: 'cuenta_corriente',
    estado: 'recibida',
    items: [
      { articulo: 'MP-COC-001', cantidadCompra: 5, unidadCompra: 'kg', factorConversion: 1000, costoUnitario: 400 },
    ],
  },
  {
    clave: 'compra-05',
    proveedor: 'Distribuidora La Espiga',
    dias: 2,
    formaPago: 'cuenta_corriente',
    estado: 'pendiente',
    items: [
      { articulo: 'MP-HAR-0000', cantidadCompra: 2, unidadCompra: 'kg', factorConversion: 25000, costoUnitario: 120 },
    ],
  },
  {
    clave: 'compra-06',
    proveedor: 'Almacen Mayorista El Puente',
    dias: 1,
    formaPago: 'contado',
    estado: 'recibida',
    items: [
      { articulo: 'MP-COC-001', cantidadCompra: 2, unidadCompra: 'kg', factorConversion: 1000, costoUnitario: 420 },
    ],
  },
];

interface CompraSembrada {
  id: number;
  clave: string;
  proveedorId: number;
  total: number;
  formaPago: 'contado' | 'cuenta_corriente';
  fecha: string;
  dias: number;
}

function sembrarCompras(ctx: Contexto): CompraSembrada[] {
  const sembradas: CompraSembrada[] = [];

  for (const definicion of COMPRAS_DEMO) {
    const fecha = haceDias(definicion.dias);
    const proveedorId = exigir(
      ctx.proveedores.get(definicion.proveedor),
      `el proveedor ${definicion.proveedor}`,
    );

    const compraId = insertarId(
      ctx.tx
        .insert(compras)
        .values({
          proveedorId,
          fecha,
          total: 0,
          formaPago: definicion.formaPago,
          estado: definicion.estado,
          notas: `[demo:${definicion.clave}]`,
        })
        .returning({ id: compras.id })
        .all(),
      `la compra ${definicion.clave}`,
    );

    let total = 0;
    for (const item of definicion.items) {
      const cantidadBase = redondearCantidad(item.cantidadCompra * item.factorConversion);
      const subtotal = calcularSubtotalCentavos(item.costoUnitario, cantidadBase);
      total += subtotal;

      ctx.tx
        .insert(compraItems)
        .values({
          compraId,
          articuloId: articuloId(ctx, item.articulo),
          cantidadCompra: item.cantidadCompra,
          unidadCompraId: exigir(ctx.unidades.get(item.unidadCompra), `la unidad ${item.unidadCompra}`),
          factorConversion: item.factorConversion,
          cantidadBase,
          costoUnitario: item.costoUnitario,
          subtotal,
        })
        .run();

      // Solo las compras recibidas mueven stock. Una compra pendiente todavia no
      // ingreso a la fabrica, asi que no puede sumar al inventario.
      if (definicion.estado === 'recibida') {
        registrarMovimiento(ctx, {
          articulo: item.articulo,
          tipo: 'compra',
          cantidad: cantidadBase,
          costoUnitario: item.costoUnitario,
          documentoTipo: 'compra',
          documentoId: compraId,
          fecha,
          notas: `[demo:${definicion.clave}] Ingreso por compra`,
        });
      }
    }

    ctx.tx.update(compras).set({ total }).where(eq(compras.id, compraId)).run();
    sembradas.push({
      id: compraId,
      clave: definicion.clave,
      proveedorId,
      total,
      formaPago: definicion.formaPago,
      fecha,
      dias: definicion.dias,
    });
  }

  return sembradas;
}

/* ------------------------------- Produccion -------------------------------- */

interface OrdenDemo {
  clave: string;
  producido: string;
  dias: number;
  factorEscala: number;
  cantidadPlanificada: number;
  estado: 'planificada' | 'en_proceso' | 'finalizada';
  rindeReal: number | null;
  /** Insumos consumidos: solo se registran si la orden esta finalizada. */
  consumos: readonly { articulo: string; teorico: number; real: number }[];
}

const ORDENES_DEMO: readonly OrdenDemo[] = [
  {
    clave: 'orden-01',
    producido: 'PE-DDL-001',
    dias: 18,
    factorEscala: 6,
    cantidadPlanificada: 6000,
    estado: 'finalizada',
    rindeReal: 5950,
    consumos: [{ articulo: 'MP-LEC-001', teorico: 15000, real: 15300 }],
  },
  {
    clave: 'orden-02',
    producido: 'PT-ALF-MAI',
    dias: 15,
    factorEscala: 10,
    cantidadPlanificada: 120,
    estado: 'finalizada',
    rindeReal: 118,
    consumos: [
      { articulo: 'PE-DDL-001', teorico: 2400, real: 2450 },
      { articulo: 'MP-TAP-001', teorico: 240, real: 244 },
    ],
  },
  {
    clave: 'orden-03',
    producido: 'PT-ALF-CHO',
    dias: 8,
    factorEscala: 5,
    cantidadPlanificada: 60,
    estado: 'finalizada',
    rindeReal: 60,
    consumos: [
      { articulo: 'PE-DDL-001', teorico: 1200, real: 1200 },
      { articulo: 'MP-TAP-001', teorico: 120, real: 122 },
      { articulo: 'MP-CHO-001', teorico: 900, real: 940 },
    ],
  },
  {
    clave: 'orden-04',
    producido: 'PT-ALF-TRI',
    dias: 4,
    factorEscala: 3,
    cantidadPlanificada: 36,
    estado: 'en_proceso',
    rindeReal: null,
    consumos: [
      { articulo: 'PE-DDL-001', teorico: 1080, real: 0 },
      { articulo: 'MP-TAP-001', teorico: 108, real: 0 },
      { articulo: 'MP-COC-001', teorico: 180, real: 0 },
    ],
  },
  {
    clave: 'orden-05',
    producido: 'PT-ALF-CHO',
    dias: 0,
    factorEscala: 4,
    cantidadPlanificada: 48,
    estado: 'planificada',
    rindeReal: null,
    consumos: [],
  },
];

function sembrarOrdenes(ctx: Contexto, pedidoIdParaOrden: number | null): number {
  let creadas = 0;

  for (const definicion of ORDENES_DEMO) {
    const producidoId = articuloId(ctx, definicion.producido);
    const receta = ctx.tx
      .select({ id: recetas.id })
      .from(recetas)
      .where(eq(recetas.articuloProducidoId, producidoId))
      .get();
    if (!receta) continue;

    const fechaPlanificada = haceDias(definicion.dias);
    const finalizada = definicion.estado === 'finalizada';
    const enProceso = definicion.estado === 'en_proceso';

    const ordenId = insertarId(
      ctx.tx
        .insert(ordenesProduccion)
        .values({
          recetaId: receta.id,
          articuloProducidoId: producidoId,
          cantidadPlanificada: definicion.cantidadPlanificada,
          factorEscala: definicion.factorEscala,
          estado: definicion.estado,
          pedidoId: definicion.clave === 'orden-05' ? pedidoIdParaOrden : null,
          rindeReal: definicion.rindeReal,
          fechaPlanificada,
          fechaInicio: finalizada || enProceso ? fechaPlanificada : null,
          fechaFin: finalizada ? haceDias(definicion.dias, 18) : null,
          notas: `[demo:${definicion.clave}]`,
        })
        .returning({ id: ordenesProduccion.id })
        .all(),
      `la orden ${definicion.clave}`,
    );

    for (const consumo of definicion.consumos) {
      ctx.tx
        .insert(produccionConsumos)
        .values({
          ordenId,
          articuloInsumoId: articuloId(ctx, consumo.articulo),
          cantidadTeorica: consumo.teorico,
          // Una orden en proceso todavia no tiene consumo real registrado.
          cantidadReal: finalizada ? consumo.real : null,
        })
        .run();

      if (finalizada) {
        registrarMovimiento(ctx, {
          articulo: consumo.articulo,
          tipo: 'consumo_produccion',
          cantidad: -consumo.real,
          documentoTipo: 'orden_produccion',
          documentoId: ordenId,
          fecha: haceDias(definicion.dias, 14),
          notas: `[demo:${definicion.clave}] Consumo de produccion`,
        });
      }
    }

    if (finalizada) {
      registrarMovimiento(ctx, {
        articulo: definicion.producido,
        tipo: 'ingreso_produccion',
        cantidad: definicion.rindeReal ?? definicion.cantidadPlanificada,
        documentoTipo: 'orden_produccion',
        documentoId: ordenId,
        fecha: haceDias(definicion.dias, 18),
        notas: `[demo:${definicion.clave}] Ingreso de produccion`,
      });
    }

    creadas += 1;
  }

  return creadas;
}

/* ---------------------------------- Ventas --------------------------------- */

interface VentaDemo {
  clave: string;
  cliente: string | null;
  dias: number;
  formaPago: 'contado' | 'cuenta_corriente';
  items: readonly { articulo: string; cantidad: number; precioUnitario: number }[];
}

const VENTAS_DEMO: readonly VentaDemo[] = [
  {
    clave: 'venta-01',
    cliente: 'Cafeteria Central',
    dias: 12,
    formaPago: 'cuenta_corriente',
    items: [{ articulo: 'PT-ALF-MAI', cantidad: 24, precioUnitario: 130000 }],
  },
  {
    clave: 'venta-02',
    cliente: 'Distribuidora Sierras',
    dias: 6,
    formaPago: 'cuenta_corriente',
    items: [
      { articulo: 'PT-ALF-MAI', cantidad: 30, precioUnitario: 130000 },
      { articulo: 'PT-ALF-CHO', cantidad: 12, precioUnitario: 150000 },
    ],
  },
  {
    clave: 'venta-03',
    cliente: 'Panaderia Don Pedro',
    dias: 1,
    formaPago: 'contado',
    items: [{ articulo: 'PT-ALF-MAI', cantidad: 10, precioUnitario: 130000 }],
  },
  {
    clave: 'venta-04',
    cliente: 'Kiosco La Esquina',
    dias: 1,
    formaPago: 'contado',
    items: [{ articulo: 'PT-ALF-CHO', cantidad: 8, precioUnitario: 185000 }],
  },
  {
    clave: 'venta-05',
    cliente: null,
    dias: 0,
    formaPago: 'contado',
    items: [{ articulo: 'PT-ALF-MAI', cantidad: 6, precioUnitario: 160000 }],
  },
  {
    clave: 'venta-06',
    cliente: 'Kiosco La Esquina',
    dias: 0,
    formaPago: 'contado',
    items: [{ articulo: 'PT-ALF-CHO', cantidad: 5, precioUnitario: 185000 }],
  },
];

interface VentaSembrada {
  id: number;
  clave: string;
  clienteId: number | null;
  total: number;
  formaPago: 'contado' | 'cuenta_corriente';
  fecha: string;
  dias: number;
}

function sembrarVentas(ctx: Contexto): VentaSembrada[] {
  const sembradas: VentaSembrada[] = [];

  for (const definicion of VENTAS_DEMO) {
    const fecha = haceDias(definicion.dias, 16);
    const clienteId = definicion.cliente === null ? null : (ctx.clientes.get(definicion.cliente) ?? null);

    const ventaId = insertarId(
      ctx.tx
        .insert(ventas)
        .values({
          clienteId,
          fecha,
          total: 0,
          formaPago: definicion.formaPago,
          pedidoId: null,
          estado: 'entregada',
          notas: `[demo:${definicion.clave}]`,
        })
        .returning({ id: ventas.id })
        .all(),
      `la venta ${definicion.clave}`,
    );

    let total = 0;
    for (const item of definicion.items) {
      const subtotal = calcularSubtotalCentavos(item.precioUnitario, item.cantidad);
      total += subtotal;

      ctx.tx
        .insert(ventaItems)
        .values({
          ventaId,
          articuloId: articuloId(ctx, item.articulo),
          cantidad: item.cantidad,
          precioUnitario: item.precioUnitario,
          subtotal,
        })
        .run();

      registrarMovimiento(ctx, {
        articulo: item.articulo,
        tipo: 'venta',
        cantidad: -item.cantidad,
        documentoTipo: 'venta',
        documentoId: ventaId,
        fecha,
        notas: `[demo:${definicion.clave}] Egreso por venta`,
      });
    }

    ctx.tx.update(ventas).set({ total }).where(eq(ventas.id, ventaId)).run();
    sembradas.push({
      id: ventaId,
      clave: definicion.clave,
      clienteId,
      total,
      formaPago: definicion.formaPago,
      fecha,
      dias: definicion.dias,
    });
  }

  return sembradas;
}

/* --------------------------------- Pedidos --------------------------------- */

interface PedidoDemo {
  clave: string;
  cliente: string | null;
  origen: 'celular' | 'mostrador' | 'sistema';
  estado: 'pendiente' | 'confirmado' | 'en_produccion' | 'listo' | 'entregado';
  dias: number;
  entregaEnDias: number | null;
  cargadoPor: string | null;
  items: readonly { articulo: string; cantidad: number; notas?: string }[];
}

const PEDIDOS_DEMO: readonly PedidoDemo[] = [
  {
    clave: 'pedido-01',
    cliente: 'Cafeteria Central',
    origen: 'celular',
    estado: 'pendiente',
    dias: 0,
    entregaEnDias: -3,
    cargadoPor: 'Bruno',
    items: [
      { articulo: 'PT-ALF-MAI', cantidad: 48 },
      { articulo: 'PT-ALF-CHO', cantidad: 24, notas: 'Sin coco, alergia' },
    ],
  },
  {
    clave: 'pedido-02',
    cliente: 'Distribuidora Sierras',
    origen: 'celular',
    estado: 'confirmado',
    dias: 1,
    entregaEnDias: -2,
    cargadoPor: 'Bruno',
    items: [{ articulo: 'PT-ALF-TRI', cantidad: 36 }],
  },
  {
    clave: 'pedido-03',
    cliente: 'Panaderia Don Pedro',
    origen: 'mostrador',
    estado: 'en_produccion',
    dias: 2,
    entregaEnDias: -1,
    cargadoPor: 'Mostrador',
    items: [
      { articulo: 'PT-ALF-MAI', cantidad: 60 },
      { articulo: 'PT-ALF-CHO', cantidad: 30 },
    ],
  },
  {
    clave: 'pedido-04',
    cliente: 'Kiosco La Esquina',
    origen: 'celular',
    estado: 'listo',
    dias: 3,
    entregaEnDias: 0,
    cargadoPor: 'Bruno',
    items: [{ articulo: 'PT-ALF-CHO', cantidad: 12 }],
  },
  {
    clave: 'pedido-05',
    cliente: 'Cafeteria Central',
    origen: 'sistema',
    estado: 'entregado',
    dias: 9,
    entregaEnDias: 6,
    cargadoPor: null,
    items: [{ articulo: 'PT-ALF-MAI', cantidad: 24 }],
  },
  {
    clave: 'pedido-06',
    cliente: null,
    origen: 'mostrador',
    estado: 'pendiente',
    dias: 0,
    entregaEnDias: -1,
    cargadoPor: 'Mostrador',
    items: [{ articulo: 'PT-ALF-TRI', cantidad: 12 }],
  },
];

/** Devuelve los pedidos sembrados; el primero se usa para atar una orden de produccion. */
function sembrarPedidos(ctx: Contexto): number[] {
  const ids: number[] = [];

  for (const definicion of PEDIDOS_DEMO) {
    const clienteId = definicion.cliente === null ? null : (ctx.clientes.get(definicion.cliente) ?? null);

    const pedidoId = insertarId(
      ctx.tx
        .insert(pedidos)
        .values({
          clienteId,
          origen: definicion.origen,
          estado: definicion.estado,
          fechaPedido: haceDias(definicion.dias, 9),
          fechaEntregaEstimada:
            definicion.entregaEnDias === null ? null : haceDias(definicion.entregaEnDias, 9),
          cargadoPor: definicion.cargadoPor,
          notas: `[demo:${definicion.clave}]`,
        })
        .returning({ id: pedidos.id })
        .all(),
      `el pedido ${definicion.clave}`,
    );

    for (const item of definicion.items) {
      ctx.tx
        .insert(pedidoItems)
        .values({
          pedidoId,
          articuloId: articuloId(ctx, item.articulo),
          cantidad: item.cantidad,
          notas: item.notas ?? null,
        })
        .run();
    }

    ids.push(pedidoId);
  }

  return ids;
}

/* ---------------------------- Cuentas corrientes --------------------------- */

function sembrarCuentasCorrientes(
  ctx: Contexto,
  comprasSembradas: readonly CompraSembrada[],
  ventasSembradas: readonly VentaSembrada[],
): number {
  let creados = 0;

  // Compra a cuenta corriente: le debemos al proveedor -> haber.
  for (const compra of comprasSembradas) {
    if (compra.formaPago !== 'cuenta_corriente') continue;
    ctx.tx
      .insert(cuentasCorrientes)
      .values({
        entidadTipo: 'proveedor',
        entidadId: compra.proveedorId,
        tipoMovimiento: 'haber',
        monto: compra.total,
        documentoTipo: 'compra',
        documentoId: compra.id,
        fecha: compra.fecha,
        notas: `[demo:${compra.clave}] Compra en cuenta corriente`,
      })
      .run();
    creados += 1;
  }

  // Venta a cuenta corriente: el cliente nos debe -> debe.
  for (const venta of ventasSembradas) {
    if (venta.formaPago !== 'cuenta_corriente' || venta.clienteId === null) continue;
    ctx.tx
      .insert(cuentasCorrientes)
      .values({
        entidadTipo: 'cliente',
        entidadId: venta.clienteId,
        tipoMovimiento: 'debe',
        monto: venta.total,
        documentoTipo: 'venta',
        documentoId: venta.id,
        fecha: venta.fecha,
        notas: `[demo:${venta.clave}] Venta en cuenta corriente`,
      })
      .run();
    creados += 1;
  }

  // Un pago parcial a proveedor y un cobro parcial a cliente, para que los
  // saldos no sean el simple total de los documentos.
  const proveedorLaEspiga = ctx.proveedores.get('Distribuidora La Espiga');
  if (proveedorLaEspiga !== undefined) {
    ctx.tx
      .insert(cuentasCorrientes)
      .values({
        entidadTipo: 'proveedor',
        entidadId: proveedorLaEspiga,
        tipoMovimiento: 'debe',
        monto: 15000000,
        documentoTipo: 'pago',
        documentoId: null,
        fecha: haceDias(5, 11),
        notas: '[demo:pago-01] Pago a cuenta por transferencia',
      })
      .run();
    creados += 1;
  }

  const cafeteria = ctx.clientes.get('Cafeteria Central');
  if (cafeteria !== undefined) {
    ctx.tx
      .insert(cuentasCorrientes)
      .values({
        entidadTipo: 'cliente',
        entidadId: cafeteria,
        tipoMovimiento: 'haber',
        monto: 2000000,
        documentoTipo: 'cobro',
        documentoId: null,
        fecha: haceDias(3, 11),
        notas: '[demo:cobro-01] Cobro parcial en efectivo',
      })
      .run();
    creados += 1;
  }

  return creados;
}

/* ----------------------------------- Caja ---------------------------------- */

const MONTO_APERTURA = 5000000; // $50.000

function sembrarCajas(
  ctx: Contexto,
  comprasSembradas: readonly CompraSembrada[],
  ventasSembradas: readonly VentaSembrada[],
): number {
  /** Movimientos de contado de un dia dado, con su signo contable. */
  const movimientosDelDia = (dias: number) => {
    const ingresos = ventasSembradas.filter((v) => v.formaPago === 'contado' && v.dias === dias);
    const egresos = comprasSembradas.filter((c) => c.formaPago === 'contado' && c.dias === dias);
    return { ingresos, egresos };
  };

  const insertarMovimientosCaja = (cajaId: number, dias: number): number => {
    const { ingresos, egresos } = movimientosDelDia(dias);
    let neto = 0;

    for (const venta of ingresos) {
      ctx.tx
        .insert(cajaMovimientos)
        .values({
          cajaId,
          tipo: 'ingreso',
          concepto: `Venta #${venta.id} de contado`,
          monto: venta.total,
          documentoTipo: 'venta',
          documentoId: venta.id,
          fecha: venta.fecha,
          usuario: 'admin',
          notas: `[demo:${venta.clave}]`,
        })
        .run();
      neto += venta.total;
    }

    for (const compra of egresos) {
      ctx.tx
        .insert(cajaMovimientos)
        .values({
          cajaId,
          tipo: 'egreso',
          concepto: `Compra #${compra.id} de contado`,
          monto: compra.total,
          documentoTipo: 'compra',
          documentoId: compra.id,
          fecha: compra.fecha,
          usuario: 'admin',
          notas: `[demo:${compra.clave}]`,
        })
        .run();
      neto -= compra.total;
    }

    return neto;
  };

  // Caja de ayer, ya cerrada, con un faltante chico para que se vea el control.
  const cajaCerradaId = insertarId(
    ctx.tx
      .insert(cajas)
      .values({
        fechaApertura: haceDias(1, 8),
        fechaCierre: haceDias(1, 21),
        montoApertura: MONTO_APERTURA,
        estado: 'cerrada',
        usuario: 'admin',
      })
      .returning({ id: cajas.id })
      .all(),
    'la caja cerrada',
  );

  const netoAyer = insertarMovimientosCaja(cajaCerradaId, 1);
  const teorico = MONTO_APERTURA + netoAyer;
  const real = teorico - 25000; // faltante de $250
  ctx.tx
    .update(cajas)
    .set({ montoCierreTeorico: teorico, montoCierreReal: real, diferencia: real - teorico })
    .where(eq(cajas.id, cajaCerradaId))
    .run();

  // Caja de hoy, abierta.
  const cajaAbiertaId = insertarId(
    ctx.tx
      .insert(cajas)
      .values({
        fechaApertura: haceDias(0, 8),
        fechaCierre: null,
        montoApertura: MONTO_APERTURA,
        estado: 'abierta',
        usuario: 'admin',
      })
      .returning({ id: cajas.id })
      .all(),
    'la caja abierta',
  );
  insertarMovimientosCaja(cajaAbiertaId, 0);

  return 2;
}

/* -------------------------------------------------------------------------- */
/* Punto de entrada                                                           */
/* -------------------------------------------------------------------------- */

const RESUMEN_VACIO: ResumenDemo = {
  sembrado: false,
  yaExistia: false,
  proveedores: 0,
  clientes: 0,
  listasPrecio: 0,
  articulos: 0,
  recetas: 0,
  compras: 0,
  ordenes: 0,
  ventas: 0,
  pedidos: 0,
  cajas: 0,
  movimientosStock: 0,
  movimientosCc: 0,
};

/**
 * Siembra el set de demostracion completo dentro de una transaccion.
 * Si ya fue sembrado, no toca nada y lo informa.
 */
export function sembrarDemo(db: BaseDatos): ResumenDemo {
  return db.transaction((tx): ResumenDemo => {
    if (demoYaSembrado(tx)) return { ...RESUMEN_VACIO, yaExistia: true };

    const ctx: Contexto = {
      tx,
      unidades: mapearUnidades(tx),
      articulos: mapearArticulos(tx),
      proveedores: new Map(
        tx.select({ id: proveedores.id, nombre: proveedores.nombre }).from(proveedores).all()
          .map((f) => [f.nombre, f.id]),
      ),
      clientes: new Map(
        tx.select({ id: clientes.id, nombre: clientes.nombre }).from(clientes).all()
          .map((f) => [f.nombre, f.id]),
      ),
      listas: new Map(
        tx.select({ id: listasPrecio.id, nombre: listasPrecio.nombre }).from(listasPrecio).all()
          .map((f) => [f.nombre, f.id]),
      ),
    };

    const terceros = sembrarTercerosDemo(ctx);
    const articulosCreados = sembrarArticulosDemo(ctx);
    const recetasCreadas = sembrarRecetasDemo(ctx);
    sembrarPreciosDemo(ctx);

    // Orden cronologico: comprar -> producir -> vender. Asi ningun articulo
    // pasa por stock negativo en ningun punto de la linea de tiempo.
    const comprasSembradas = sembrarCompras(ctx);
    const pedidosIds = sembrarPedidos(ctx);
    const ordenesCreadas = sembrarOrdenes(ctx, pedidosIds[1] ?? null);
    const ventasSembradas = sembrarVentas(ctx);

    const movimientosCc = sembrarCuentasCorrientes(ctx, comprasSembradas, ventasSembradas);
    const cajasCreadas = sembrarCajas(ctx, comprasSembradas, ventasSembradas);

    const totalMovimientos =
      tx.select({ total: sql<number>`COUNT(*)`.mapWith(Number) }).from(movimientosStock)
        .where(like(movimientosStock.notas, '[demo:%')).get()?.total ?? 0;

    return {
      sembrado: true,
      yaExistia: false,
      proveedores: terceros.proveedores,
      clientes: terceros.clientes,
      listasPrecio: terceros.listas,
      articulos: articulosCreados,
      recetas: recetasCreadas,
      compras: comprasSembradas.length,
      ordenes: ordenesCreadas,
      ventas: ventasSembradas.length,
      pedidos: pedidosIds.length,
      cajas: cajasCreadas,
      movimientosStock: totalMovimientos,
      movimientosCc,
    };
  });
}
