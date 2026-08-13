/**
 * Schema completo de la base de datos del ERP (Drizzle + SQLite).
 *
 * Principios rectores:
 *  - ARTICULO UNIFICADO: insumos y productos finales viven en la misma tabla `articulos`.
 *    La separacion "Stock de Insumos" vs "Stock de Productos" es una VISTA DERIVADA del
 *    campo `tipo`, no tablas distintas.
 *  - LEDGER UNICO DE STOCK: `movimientos_stock` es la unica fuente de verdad. El stock
 *    actual de un articulo es SUM(cantidad). No existe un campo `stock` mutable.
 *  - LEDGER UNICO DE CUENTA CORRIENTE: `cuentas_corrientes` sirve a clientes y proveedores.
 *    Saldo = SUM(debe) - SUM(haber) por entidad.
 *  - DINERO SIEMPRE EN CENTAVOS (INTEGER). Nunca REAL para importes.
 *  - CANTIDADES EN REAL, expresadas en la unidad base del articulo.
 */

import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

/** Timestamp UTC en formato ISO-8601, usado como default de columnas de fecha. */
const AHORA = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

/* ------------------------------------------------------------------------- */
/* Catalogos base                                                            */
/* ------------------------------------------------------------------------- */

export const TIPOS_MAGNITUD = ['peso', 'volumen', 'unidad'] as const;
export type TipoMagnitud = (typeof TIPOS_MAGNITUD)[number];

export const unidadesMedida = sqliteTable(
  'unidades_medida',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    abreviatura: text('abreviatura').notNull(),
    tipoMagnitud: text('tipo_magnitud', { enum: TIPOS_MAGNITUD }).notNull(),
  },
  (tabla) => [
    uniqueIndex('ux_unidades_medida_abreviatura').on(tabla.abreviatura),
    check('ck_unidades_medida_tipo_magnitud', sql`${tabla.tipoMagnitud} IN ('peso','volumen','unidad')`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Articulos (insumos + productos, tabla unificada)                          */
/* ------------------------------------------------------------------------- */

export const TIPOS_ARTICULO = ['materia_prima', 'pre_elaborado', 'producto_terminado'] as const;
export type TipoArticulo = (typeof TIPOS_ARTICULO)[number];

/**
 * Familias o rubros para agrupar articulos (Chocolates, Harinas, Envases...).
 * `padreId` permite subrubros; null es una familia de primer nivel.
 */
export const familias = sqliteTable(
  'familias',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    padreId: integer('padre_id'),
  },
  (tabla) => [uniqueIndex('ux_familias_nombre').on(tabla.nombre)],
);

/** Alicuotas de IVA que maneja ARCA, en porcentaje. */
export const ALICUOTAS_IVA = [0, 10.5, 21, 27] as const;

export const articulos = sqliteTable(
  'articulos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    codigo: text('codigo').notNull(),
    nombre: text('nombre').notNull(),
    /** materia_prima + pre_elaborado => Stock Insumos. producto_terminado => Stock Productos. */
    tipo: text('tipo', { enum: TIPOS_ARTICULO }).notNull(),
    unidadBaseId: integer('unidad_base_id')
      .notNull()
      .references(() => unidadesMedida.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    stockMin: real('stock_min'),
    /**
     * Cuanto conviene tener en stock. El minimo dispara la alarma; el ideal dice
     * hasta donde reponer, que es la pregunta que sigue: sin el, el operador ve
     * "falta harina" pero no cuanta comprar.
     */
    stockIdeal: real('stock_ideal'),
    /** Codigo de barras para escanear en el mostrador. Unico cuando esta cargado. */
    codigoBarras: text('codigo_barras'),
    marca: text('marca'),
    familiaId: integer('familia_id').references(() => familias.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /**
     * Proveedor al que se le compra habitualmente. No obliga a nada: es el que
     * se propone al cargar una compra y el que permite responder "a quien le
     * compro esto" sin buscar en el historial.
     */
    proveedorHabitualId: integer('proveedor_habitual_id').references(() => proveedores.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /**
     * Alicuota de IVA en porcentaje. La factura la usa para desglosar: antes se
     * asumia 21% para todo, lo que declaraba mal cualquier articulo con otra
     * alicuota.
     */
    alicuotaIva: real('alicuota_iva').notNull().default(21),
    /** Se vende por peso (la balanza define la cantidad), no por unidad. */
    porPeso: integer('por_peso', { mode: 'boolean' }).notNull().default(false),
    notas: text('notas'),
    /**
     * Unidades por caja cerrada (ej: 12 alfajores por caja). Los clientes piden
     * por cajas; el stock y el ledger siguen SIEMPRE en unidad base. NULL = el
     * articulo no se comercializa por caja (insumos, pre-elaborados).
     */
    unidadesPorCaja: integer('unidades_por_caja'),
    /** Costo cacheado en centavos por unidad base. Recalculable desde compras/recetas. */
    costoActual: integer('costo_actual'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(AHORA),
    updatedAt: text('updated_at').notNull().default(AHORA),
  },
  (tabla) => [
    uniqueIndex('ux_articulos_codigo').on(tabla.codigo),
    index('ix_articulos_tipo').on(tabla.tipo),
    index('ix_articulos_activo').on(tabla.activo),
    index('ix_articulos_familia').on(tabla.familiaId),
    index('ix_articulos_proveedor').on(tabla.proveedorHabitualId),
    index('ix_articulos_codigo_barras').on(tabla.codigoBarras),
    check(
      'ck_articulos_tipo',
      sql`${tabla.tipo} IN ('materia_prima','pre_elaborado','producto_terminado')`,
    ),
    check('ck_articulos_stock_min', sql`${tabla.stockMin} IS NULL OR ${tabla.stockMin} >= 0`),
    check(
      'ck_articulos_unidades_por_caja',
      sql`${tabla.unidadesPorCaja} IS NULL OR ${tabla.unidadesPorCaja} > 0`,
    ),
    check('ck_articulos_costo_actual', sql`${tabla.costoActual} IS NULL OR ${tabla.costoActual} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Listas de precio y precios                                                */
/* ------------------------------------------------------------------------- */

/**
 * Una actualizacion masiva de precios, para poder deshacerla entera.
 *
 * Sin esto, revertir un aumento mal aplicado significa corregir articulo por
 * articulo: la red de seguridad es lo que hace que la actualizacion masiva se
 * pueda usar sin miedo.
 */
export const lotesPrecio = sqliteTable('lotes_precio', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fecha: text('fecha').notNull().default(AHORA),
  /** "Aumento 25% sobre lista General, redondeo a $10". */
  descripcion: text('descripcion').notNull(),
  cantidadArticulos: integer('cantidad_articulos').notNull().default(0),
  /** Se marca al deshacerlo; el lote no se borra, queda el rastro. */
  revertido: integer('revertido', { mode: 'boolean' }).notNull().default(false),
});

export const listasPrecio = sqliteTable(
  'listas_precio',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    /**
     * Lista DERIVADA: sus precios se calculan desde otra lista aplicando el
     * porcentaje ("Lista 1 + 20%"). Es como lo maneja la planilla de Anyulin:
     * el 20% es un parametro; cuando cambia la base, cambia la derivada sola.
     * null = lista con precios propios cargados.
     */
    baseListaId: integer('base_lista_id'),
    /** Recargo en porcentaje sobre la base (20 = +20%). Solo con baseListaId. */
    recargoPct: real('recargo_pct'),
    activa: integer('activa', { mode: 'boolean' }).notNull().default(true),
  },
  (tabla) => [uniqueIndex('ux_listas_precio_nombre').on(tabla.nombre)],
);

export const precios = sqliteTable(
  'precios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    listaPrecioId: integer('lista_precio_id')
      .notNull()
      .references(() => listasPrecio.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Precio en centavos por unidad base del articulo. */
    precio: integer('precio').notNull(),
    vigenteDesde: text('vigente_desde').notNull().default(AHORA),
    /** Lote de la actualizacion masiva que lo creo. null = carga puntual. */
    loteId: integer('lote_id').references(() => lotesPrecio.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
  },
  (tabla) => [
    index('ix_precios_articulo_lista').on(tabla.articuloId, tabla.listaPrecioId, tabla.vigenteDesde),
    index('ix_precios_lote').on(tabla.loteId),
    check('ck_precios_precio', sql`${tabla.precio} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Terceros                                                                  */
/* ------------------------------------------------------------------------- */

export const proveedores = sqliteTable(
  'proveedores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Codigo corto para buscarlo rapido al cargar una compra. */
    codigo: text('codigo'),
    nombre: text('nombre').notNull(),
    cuit: text('cuit'),
    /** Numero de Ingresos Brutos, que va en algunos comprobantes. */
    iibb: text('iibb'),
    telefono: text('telefono'),
    celular: text('celular'),
    localidad: text('localidad'),
    email: text('email'),
    direccion: text('direccion'),
    notas: text('notas'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  },
  (tabla) => [
    index('ix_proveedores_nombre').on(tabla.nombre),
    uniqueIndex('ux_proveedores_codigo').on(tabla.codigo),
  ],
);

export const TIPOS_CLIENTE = ['mostrador', 'mayorista', 'distribuidor'] as const;
export type TipoCliente = (typeof TIPOS_CLIENTE)[number];

/**
 * Vendedores / revendedores: quien trae el pedido. Un vendedor puede ademas
 * ser cliente (compra para revender); por eso es una entidad propia y no un
 * campo del cliente.
 */
export const vendedores = sqliteTable(
  'vendedores',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull().unique(),
    telefono: text('telefono'),
    /** CUIT del vendedor: hace falta cuando el pedido se le factura a el. */
    cuit: text('cuit'),
    /**
     * Su ficha de CLIENTE, si tambien compra o se le factura: la venta
     * "facturada al vendedor" usa esta ficha (CUIT, condicion de IVA, cuenta
     * corriente) como receptora.
     */
    clienteId: integer('cliente_id').references((): AnySQLiteColumn => clientes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    notas: text('notas'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  },
  (tabla) => [index('ix_vendedores_nombre').on(tabla.nombre)],
);

export const clientes = sqliteTable(
  'clientes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    cuit: text('cuit'),
    /** DNI, CUIT, CUIL, pasaporte o consumidor final. Define que informar a ARCA. */
    tipoDocumento: text('tipo_documento'),
    numeroDocumento: text('numero_documento'),
    /**
     * Condicion frente al IVA. Se guarda EN el cliente y no se pregunta en cada
     * venta: es un dato del cliente, no de la operacion, y preguntarlo cada vez
     * es como se cuela un comprobante mal emitido un viernes a la tarde.
     * Codigos de la tabla de ARCA (FEParamGetCondicionIvaReceptor).
     */
    condicionIva: integer('condicion_iva').notNull().default(5),
    telefono: text('telefono'),
    celular: text('celular'),
    localidad: text('localidad'),
    /**
     * Cuanto se le puede fiar, en centavos. 0 = sin limite definido. La venta en
     * cuenta corriente avisa cuando el saldo lo supera.
     */
    limiteCredito: integer('limite_credito').notNull().default(0),
    email: text('email'),
    direccion: text('direccion'),
    tipo: text('tipo', { enum: TIPOS_CLIENTE }).notNull().default('mostrador'),
    listaPrecioId: integer('lista_precio_id').references(() => listasPrecio.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Vendedor habitual: el que se propone al cargarle un pedido. */
    vendedorId: integer('vendedor_id').references(() => vendedores.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    notas: text('notas'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  },
  (tabla) => [
    index('ix_clientes_nombre').on(tabla.nombre),
    index('ix_clientes_tipo').on(tabla.tipo),
    check('ck_clientes_tipo', sql`${tabla.tipo} IN ('mostrador','mayorista','distribuidor')`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Recetas (BOM encadenable)                                                 */
/* ------------------------------------------------------------------------- */

export const recetas = sqliteTable(
  'recetas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Articulo que produce esta receta: un pre_elaborado o un producto_terminado. */
    articuloProducidoId: integer('articulo_producido_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    rindeCantidad: real('rinde_cantidad').notNull(),
    rindeUnidadId: integer('rinde_unidad_id')
      .notNull()
      .references(() => unidadesMedida.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    activa: integer('activa', { mode: 'boolean' }).notNull().default(true),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_recetas_articulo_producido').on(tabla.articuloProducidoId),
    check('ck_recetas_rinde_cantidad', sql`${tabla.rindeCantidad} > 0`),
  ],
);

export const recetaItems = sqliteTable(
  'receta_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recetaId: integer('receta_id')
      .notNull()
      .references(() => recetas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Insumo consumido: materia_prima u otro pre_elaborado (encadenamiento de BOM). */
    articuloInsumoId: integer('articulo_insumo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Cantidad expresada en la unidad base del insumo. */
    cantidad: real('cantidad').notNull(),
    mermaEsperadaPct: real('merma_esperada_pct').notNull().default(0),
  },
  (tabla) => [
    index('ix_receta_items_receta').on(tabla.recetaId),
    index('ix_receta_items_insumo').on(tabla.articuloInsumoId),
    uniqueIndex('ux_receta_items_receta_insumo').on(tabla.recetaId, tabla.articuloInsumoId),
    check('ck_receta_items_cantidad', sql`${tabla.cantidad} > 0`),
    check(
      'ck_receta_items_merma',
      sql`${tabla.mermaEsperadaPct} >= 0 AND ${tabla.mermaEsperadaPct} <= 100`,
    ),
  ],
);

/* ------------------------------------------------------------------------- */
/* Pedidos (feature estrella: carga desde el celular)                        */
/* ------------------------------------------------------------------------- */

export const ORIGENES_PEDIDO = ['celular', 'mostrador', 'sistema'] as const;
export type OrigenPedido = (typeof ORIGENES_PEDIDO)[number];

export const ESTADOS_PEDIDO = [
  'pendiente',
  'confirmado',
  'en_produccion',
  'listo',
  'entregado',
  'cancelado',
] as const;
export type EstadoPedido = (typeof ESTADOS_PEDIDO)[number];

export const pedidos = sqliteTable(
  'pedidos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clienteId: integer('cliente_id').references(() => clientes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Quien trajo el pedido (revendedor). null = venta directa de fabrica. */
    vendedorId: integer('vendedor_id').references(() => vendedores.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    /** Con que lista se liquida. null = la lista del cliente al vender. */
    listaPrecioId: integer('lista_precio_id').references(() => listasPrecio.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    origen: text('origen', { enum: ORIGENES_PEDIDO }).notNull().default('sistema'),
    estado: text('estado', { enum: ESTADOS_PEDIDO }).notNull().default('pendiente'),
    fechaPedido: text('fecha_pedido').notNull().default(AHORA),
    fechaEntregaEstimada: text('fecha_entrega_estimada'),
    cargadoPor: text('cargado_por'),
    notas: text('notas'),
    /**
     * Clave de idempotencia que manda el cliente (la PWA usa el id local de su
     * cola offline). Si un reintento llega con una clave ya vista, se devuelve
     * el pedido existente en vez de duplicarlo: la cola garantiza "al menos una
     * vez", esta clave lo convierte en "exactamente una vez".
     */
    claveIdempotencia: text('clave_idempotencia'),
  },
  (tabla) => [
    index('ix_pedidos_estado_fecha').on(tabla.estado, tabla.fechaPedido),
    uniqueIndex('ux_pedidos_clave_idempotencia').on(tabla.claveIdempotencia),
    index('ix_pedidos_cliente').on(tabla.clienteId),
    check('ck_pedidos_origen', sql`${tabla.origen} IN ('celular','mostrador','sistema')`),
    check(
      'ck_pedidos_estado',
      sql`${tabla.estado} IN ('pendiente','confirmado','en_produccion','listo','entregado','cancelado')`,
    ),
  ],
);

export const pedidoItems = sqliteTable(
  'pedido_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pedidoId: integer('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Siempre un articulo de tipo producto_terminado. */
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cantidad: real('cantidad').notNull(),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_pedido_items_pedido').on(tabla.pedidoId),
    check('ck_pedido_items_cantidad', sql`${tabla.cantidad} > 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Produccion                                                                */
/* ------------------------------------------------------------------------- */

export const ESTADOS_ORDEN_PRODUCCION = [
  'planificada',
  'en_proceso',
  // Tanda arrancada y detenida a proposito (falta un insumo, cambio de
  // prioridad): conserva su lote y sus insumos comprometidos.
  'pausada',
  'finalizada',
  'cancelada',
] as const;
export type EstadoOrdenProduccion = (typeof ESTADOS_ORDEN_PRODUCCION)[number];

export const ordenesProduccion = sqliteTable(
  'ordenes_produccion',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recetaId: integer('receta_id')
      .notNull()
      .references(() => recetas.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Denormalizado desde la receta para consultas rapidas e historicas. */
    articuloProducidoId: integer('articulo_producido_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cantidadPlanificada: real('cantidad_planificada').notNull(),
    /** Media tanda = 0.5, doble tanda = 2, etc. */
    factorEscala: real('factor_escala').notNull().default(1),
    estado: text('estado', { enum: ESTADOS_ORDEN_PRODUCCION }).notNull().default('planificada'),
    /**
     * Numero de lote UNICO de la tanda (ej: L-20260805-01). Se asigna cuando la
     * orden se ejecuta (pasa a en_proceso) y es la clave de trazabilidad: de un
     * lote se llega a la orden, sus consumos y sus movimientos de stock.
     */
    numeroLote: text('numero_lote'),
    /** Produccion contra pedido: permite trazar que orden cubre que pedido. */
    pedidoId: integer('pedido_id').references(() => pedidos.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    rindeReal: real('rinde_real'),
    fechaPlanificada: text('fecha_planificada').notNull().default(AHORA),
    fechaInicio: text('fecha_inicio'),
    fechaFin: text('fecha_fin'),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_ordenes_produccion_estado_fecha').on(tabla.estado, tabla.fechaPlanificada),
    index('ix_ordenes_produccion_articulo').on(tabla.articuloProducidoId),
    index('ix_ordenes_produccion_pedido').on(tabla.pedidoId),
    uniqueIndex('ux_ordenes_produccion_numero_lote').on(tabla.numeroLote),
    check(
      'ck_ordenes_produccion_estado',
      sql`${tabla.estado} IN ('planificada','en_proceso','pausada','finalizada','cancelada')`,
    ),
    check('ck_ordenes_produccion_cantidad', sql`${tabla.cantidadPlanificada} > 0`),
    check('ck_ordenes_produccion_factor', sql`${tabla.factorEscala} > 0`),
  ],
);

export const produccionConsumos = sqliteTable(
  'produccion_consumos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ordenId: integer('orden_id')
      .notNull()
      .references(() => ordenesProduccion.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    articuloInsumoId: integer('articulo_insumo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Cantidad que la receta indica (en unidad base del insumo). */
    cantidadTeorica: real('cantidad_teorica').notNull(),
    /** Cantidad realmente consumida. NULL => se asume el teorico. Merma = real - teorico. */
    cantidadReal: real('cantidad_real'),
  },
  (tabla) => [
    index('ix_produccion_consumos_orden').on(tabla.ordenId),
    index('ix_produccion_consumos_insumo').on(tabla.articuloInsumoId),
    check('ck_produccion_consumos_teorica', sql`${tabla.cantidadTeorica} >= 0`),
    check(
      'ck_produccion_consumos_real',
      sql`${tabla.cantidadReal} IS NULL OR ${tabla.cantidadReal} >= 0`,
    ),
  ],
);

/* ------------------------------------------------------------------------- */
/* LEDGER DE STOCK - fuente de verdad unica                                  */
/* ------------------------------------------------------------------------- */

export const TIPOS_MOVIMIENTO_STOCK = [
  'compra',
  'venta',
  'consumo_produccion',
  'ingreso_produccion',
  'merma',
  'ajuste',
] as const;
export type TipoMovimientoStock = (typeof TIPOS_MOVIMIENTO_STOCK)[number];

export const TIPOS_DOCUMENTO_STOCK = ['compra', 'venta', 'orden_produccion', 'ajuste'] as const;
export type TipoDocumentoStock = (typeof TIPOS_DOCUMENTO_STOCK)[number];

export const movimientosStock = sqliteTable(
  'movimientos_stock',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    tipo: text('tipo', { enum: TIPOS_MOVIMIENTO_STOCK }).notNull(),
    /** Con signo: (+) ingreso, (-) egreso. Siempre en la unidad base del articulo. */
    cantidad: real('cantidad').notNull(),
    /** Centavos por unidad base, para valuacion de inventario. */
    costoUnitario: integer('costo_unitario'),
    documentoTipo: text('documento_tipo', { enum: TIPOS_DOCUMENTO_STOCK }),
    documentoId: integer('documento_id'),
    fecha: text('fecha').notNull().default(AHORA),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_movimientos_stock_articulo_fecha').on(tabla.articuloId, tabla.fecha),
    index('ix_movimientos_stock_documento').on(tabla.documentoTipo, tabla.documentoId),
    index('ix_movimientos_stock_tipo').on(tabla.tipo),
    check(
      'ck_movimientos_stock_tipo',
      sql`${tabla.tipo} IN ('compra','venta','consumo_produccion','ingreso_produccion','merma','ajuste')`,
    ),
    check(
      'ck_movimientos_stock_documento_tipo',
      sql`${tabla.documentoTipo} IS NULL OR ${tabla.documentoTipo} IN ('compra','venta','orden_produccion','ajuste')`,
    ),
    check('ck_movimientos_stock_cantidad', sql`${tabla.cantidad} <> 0`),
    check(
      'ck_movimientos_stock_costo',
      sql`${tabla.costoUnitario} IS NULL OR ${tabla.costoUnitario} >= 0`,
    ),
  ],
);

/* ------------------------------------------------------------------------- */
/* PRESENTACIONES - como se VENDE lo que el stock cuenta en unidades          */
/* ------------------------------------------------------------------------- */

/**
 * Una presentacion es la forma comercial de vender: la caja de 36, la docena,
 * la bolsa de 6, la unidad suelta, o la caja SURTIDA que mezcla variedades.
 *
 * El modelo viene del talonario real de Anyulin: el stock y la produccion
 * SIEMPRE cuentan unidades por variedad (el ledger no sabe de cajas); la
 * presentacion es una capa comercial que al vender se descompone en sus
 * componentes. La surtida B-N-FB descuenta de tres stocks a la vez.
 *
 * `precioPropio`: la regla general es unidades x precio unitario de la lista
 * (asi liquida el Excel), pero cubanitos, almendras y el envase Anyulin tienen
 * precio de renglon propio. true = el precio sale de la tabla de precios de la
 * PRESENTACION, no se calcula desde el articulo.
 */
export const presentaciones = sqliteTable(
  'presentaciones',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    /** Codigo corto para el talonario ("CAJA-B", "DOC-BNFB", "X4"). */
    codigo: text('codigo').notNull(),
    precioPropio: integer('precio_propio', { mode: 'boolean' }).notNull().default(false),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    orden: integer('orden').notNull().default(0),
  },
  (tabla) => [uniqueIndex('ux_presentaciones_codigo').on(tabla.codigo)],
);

/**
 * De que se compone una presentacion: articulo base + cuantas unidades aporta.
 * Simple = 1 componente (caja de blancos: 36 u de ALF DdL-BLANCO).
 * Surtida = N componentes (caja B-N-FB: 12+12+12).
 * El envase cobrable (CAJA ANYULIN) es una presentacion con componentes de las
 * 4 variedades (3 c/u) MAS su renglon de precio propio.
 */
export const presentacionComponentes = sqliteTable(
  'presentacion_componentes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    presentacionId: integer('presentacion_id')
      .notNull()
      .references(() => presentaciones.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Unidades base del articulo que aporta UNA presentacion. */
    unidades: real('unidades').notNull(),
  },
  (tabla) => [
    index('ix_presentacion_componentes_presentacion').on(tabla.presentacionId),
    check('ck_presentacion_componentes_unidades', sql`${tabla.unidades} > 0`),
  ],
);

/**
 * Precio de renglon de una presentacion con precio propio, por lista y con
 * vigencia (mismo criterio historico que `precios`). Solo aplica cuando la
 * presentacion tiene `precioPropio`; las demas se liquidan unidades x precio
 * unitario del articulo.
 */
export const preciosPresentacion = sqliteTable(
  'precios_presentacion',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    presentacionId: integer('presentacion_id')
      .notNull()
      .references(() => presentaciones.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    listaPrecioId: integer('lista_precio_id')
      .notNull()
      .references(() => listasPrecio.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Centavos por presentacion. */
    precio: integer('precio').notNull(),
    vigenteDesde: text('vigente_desde').notNull().default(AHORA),
  },
  (tabla) => [
    index('ix_precios_presentacion_lista').on(tabla.presentacionId, tabla.listaPrecioId, tabla.vigenteDesde),
    check('ck_precios_presentacion_precio', sql`${tabla.precio} >= 0`),
  ],
);

/**
 * Renglones del pedido EN PRESENTACIONES: lo que el cliente pidio tal como lo
 * pidio ("2 cajas B-N-FB, 3 docenas de blancos"). Es la verdad comercial: de
 * aca salen la liquidacion del remito y la orden de elaboracion impresa.
 *
 * Los `pedido_items` en unidades por articulo se DERIVAN de estos renglones
 * (explotando la composicion) y siguen alimentando el circuito de reservas y
 * produccion, que no sabe de cajas. Un pedido cargado a mano sin renglones
 * (viejo, o desde el celular) sigue funcionando: los renglones son opcionales.
 */
export const pedidoRenglones = sqliteTable(
  'pedido_renglones',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    pedidoId: integer('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /**
     * NULL = renglon armado A MEDIDA: la mezcla que pidio el cliente no existe
     * en el catalogo ("docena con 4 FN + 4 FB + 4 N"). Su composicion vive en
     * `pedido_renglon_componentes` y `descripcion` es lo que se imprime.
     */
    presentacionId: integer('presentacion_id').references(() => presentaciones.id, {
      onDelete: 'restrict',
      onUpdate: 'cascade',
    }),
    descripcion: text('descripcion'),
    cantidad: real('cantidad').notNull(),
  },
  (tabla) => [
    index('ix_pedido_renglones_pedido').on(tabla.pedidoId),
    check('ck_pedido_renglones_cantidad', sql`${tabla.cantidad} > 0`),
    // O es de catalogo o es a medida con descripcion: nunca un renglon mudo.
    check(
      'ck_pedido_renglones_identidad',
      sql`${tabla.presentacionId} IS NOT NULL OR ${tabla.descripcion} IS NOT NULL`,
    ),
  ],
);

/** Composicion de un renglon A MEDIDA: unidades por variedad de UNA presentacion. */
export const pedidoRenglonComponentes = sqliteTable(
  'pedido_renglon_componentes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    renglonId: integer('renglon_id')
      .notNull()
      .references(() => pedidoRenglones.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    unidades: real('unidades').notNull(),
  },
  (tabla) => [
    index('ix_pedido_renglon_componentes_renglon').on(tabla.renglonId),
    check('ck_pedido_renglon_componentes_unidades', sql`${tabla.unidades} > 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* MEDIOS DE PAGO - replicado de StockFlow (payment_methods)                  */
/* ------------------------------------------------------------------------- */

export const TIPOS_MEDIO_PAGO = [
  'efectivo',
  'transferencia',
  'tarjeta_debito',
  'tarjeta_credito',
  'cheque',
  'otro',
] as const;
export type TipoMedioPago = (typeof TIPOS_MEDIO_PAGO)[number];

/**
 * Medios de pago CONFIGURABLES, no un enum cerrado: el comercio puede tener
 * "Transferencia Galicia" o "Visa 3 cuotas" como filas propias. El `tipo` es
 * la taxonomia que decide el comportamiento (el cheque dispara la cartera,
 * el efectivo fisico entra al arqueo del cajon). Copiado de StockFlow.
 */
export const mediosPago = sqliteTable(
  'medios_pago',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    nombre: text('nombre').notNull(),
    tipo: text('tipo', { enum: TIPOS_MEDIO_PAGO }).notNull(),
    /**
     * true = billetes que entran al cajon: es lo UNICO que cuenta para el
     * arqueo fisico del cierre de caja. Transferencias y tarjetas quedan en la
     * caja como ingresos electronicos, visibles pero fuera del arqueo.
     */
    esEfectivoFisico: integer('es_efectivo_fisico', { mode: 'boolean' }).notNull().default(false),
    /** Porcentaje que ABSORBE el comercio (no se le cobra al cliente). */
    comisionPct: real('comision_pct').notNull().default(0),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
    orden: integer('orden').notNull().default(0),
  },
  (tabla) => [
    uniqueIndex('ux_medios_pago_nombre').on(tabla.nombre),
    check(
      'ck_medios_pago_tipo',
      sql`${tabla.tipo} IN ('efectivo','transferencia','tarjeta_debito','tarjeta_credito','cheque','otro')`,
    ),
    check('ck_medios_pago_comision', sql`${tabla.comisionPct} >= 0 AND ${tabla.comisionPct} <= 100`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Compras                                                                   */
/* ------------------------------------------------------------------------- */

export const FORMAS_PAGO = ['contado', 'cuenta_corriente'] as const;
export type FormaPago = (typeof FORMAS_PAGO)[number];

export const ESTADOS_COMPRA = ['pendiente', 'recibida'] as const;
export type EstadoCompra = (typeof ESTADOS_COMPRA)[number];

export const compras = sqliteTable(
  'compras',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    proveedorId: integer('proveedor_id')
      .notNull()
      .references(() => proveedores.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    fecha: text('fecha').notNull().default(AHORA),
    /** Total en centavos. */
    total: integer('total').notNull().default(0),
    formaPago: text('forma_pago', { enum: FORMAS_PAGO }).notNull().default('contado'),
    estado: text('estado', { enum: ESTADOS_COMPRA }).notNull().default('pendiente'),
    /**
     * Anulacion. Va en su propia columna y no como estado porque el CHECK de
     * `estado` no admite valores nuevos sin recrear la tabla, y recrearla con
     * compra_items colgando por clave foranea es mas riesgoso que este flag.
     * La vista deriva el estado que ve el usuario.
     */
    anulada: integer('anulada', { mode: 'boolean' }).notNull().default(false),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_compras_proveedor_fecha').on(tabla.proveedorId, tabla.fecha),
    index('ix_compras_estado').on(tabla.estado),
    check('ck_compras_forma_pago', sql`${tabla.formaPago} IN ('contado','cuenta_corriente')`),
    check('ck_compras_estado', sql`${tabla.estado} IN ('pendiente','recibida')`),
    check('ck_compras_total', sql`${tabla.total} >= 0`),
  ],
);

export const compraItems = sqliteTable(
  'compra_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    compraId: integer('compra_id')
      .notNull()
      .references(() => compras.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Cantidad tal cual se compra (ej: 2 bolsas). */
    cantidadCompra: real('cantidad_compra').notNull(),
    unidadCompraId: integer('unidad_compra_id')
      .notNull()
      .references(() => unidadesMedida.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Convierte cantidad_compra a unidad base del articulo (ej: bolsa 25kg -> 25000 g). */
    factorConversion: real('factor_conversion').notNull().default(1),
    /** Calculada: cantidad_compra * factor_conversion. */
    cantidadBase: real('cantidad_base').notNull(),
    /** Centavos por unidad base. */
    costoUnitario: integer('costo_unitario').notNull().default(0),
    /** Centavos. */
    subtotal: integer('subtotal').notNull().default(0),
  },
  (tabla) => [
    index('ix_compra_items_compra').on(tabla.compraId),
    index('ix_compra_items_articulo').on(tabla.articuloId),
    check('ck_compra_items_cantidad_compra', sql`${tabla.cantidadCompra} > 0`),
    check('ck_compra_items_factor', sql`${tabla.factorConversion} > 0`),
    check('ck_compra_items_cantidad_base', sql`${tabla.cantidadBase} > 0`),
    check('ck_compra_items_costo', sql`${tabla.costoUnitario} >= 0`),
    check('ck_compra_items_subtotal', sql`${tabla.subtotal} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Ventas                                                                    */
/* ------------------------------------------------------------------------- */

export const ESTADOS_VENTA = ['pendiente', 'entregada', 'anulada'] as const;
export type EstadoVenta = (typeof ESTADOS_VENTA)[number];

export const ventas = sqliteTable(
  'ventas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** NULL = venta de mostrador sin cliente identificado. */
    clienteId: integer('cliente_id').references(() => clientes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    fecha: text('fecha').notNull().default(AHORA),
    /** Total en centavos. */
    total: integer('total').notNull().default(0),
    formaPago: text('forma_pago', { enum: FORMAS_PAGO }).notNull().default('contado'),
    pedidoId: integer('pedido_id').references(() => pedidos.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    estado: text('estado', { enum: ESTADOS_VENTA }).notNull().default('entregada'),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_ventas_fecha').on(tabla.fecha),
    index('ix_ventas_cliente_fecha').on(tabla.clienteId, tabla.fecha),
    index('ix_ventas_pedido').on(tabla.pedidoId),
    check('ck_ventas_forma_pago', sql`${tabla.formaPago} IN ('contado','cuenta_corriente')`),
    check('ck_ventas_estado', sql`${tabla.estado} IN ('pendiente','entregada','anulada')`),
    check('ck_ventas_total', sql`${tabla.total} >= 0`),
  ],
);

export const ventaItems = sqliteTable(
  'venta_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ventaId: integer('venta_id')
      .notNull()
      .references(() => ventas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Siempre un articulo de tipo producto_terminado. */
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    cantidad: real('cantidad').notNull(),
    /** Centavos por unidad base. */
    precioUnitario: integer('precio_unitario').notNull().default(0),
    /** Centavos. */
    subtotal: integer('subtotal').notNull().default(0),
  },
  (tabla) => [
    index('ix_venta_items_venta').on(tabla.ventaId),
    index('ix_venta_items_articulo').on(tabla.articuloId),
    check('ck_venta_items_cantidad', sql`${tabla.cantidad} > 0`),
    check('ck_venta_items_precio', sql`${tabla.precioUnitario} >= 0`),
    check('ck_venta_items_subtotal', sql`${tabla.subtotal} >= 0`),
  ],
);

/**
 * Pagos de una venta: N por venta (venta mixta: parte efectivo, parte
 * transferencia, parte cheque...). Solo para ventas de contado; la venta en
 * cuenta corriente no lleva pagos (el cobro es un acto posterior).
 *
 * La suma de los pagos es EXACTAMENTE el total de la venta: no hay vuelto ni
 * redondeo (el cajero carga lo cobrado en cada medio). Regla de StockFlow.
 */
export const ventaPagos = sqliteTable(
  'venta_pagos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ventaId: integer('venta_id')
      .notNull()
      .references(() => ventas.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    medioPagoId: integer('medio_pago_id')
      .notNull()
      .references(() => mediosPago.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Centavos, siempre positivo. */
    importe: integer('importe').notNull(),
    /** Numero de transferencia, ultimos 4 de la tarjeta, etc. */
    referencia: text('referencia'),
    /** Snapshot de la comision del medio AL MOMENTO de la venta. */
    comisionPct: real('comision_pct').notNull().default(0),
    comisionImporte: integer('comision_importe').notNull().default(0),
    netoImporte: integer('neto_importe').notNull().default(0),
    /** Si el medio es cheque: el cheque que este pago dio de alta en la cartera. */
    chequeId: integer('cheque_id').references(() => cheques.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
  },
  (tabla) => [
    index('ix_venta_pagos_venta').on(tabla.ventaId),
    check('ck_venta_pagos_importe', sql`${tabla.importe} > 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* RESERVAS DE STOCK - lo que hay pero ya tiene dueño                         */
/* ------------------------------------------------------------------------- */

export const ESTADOS_RESERVA = ['activa', 'entregada', 'liberada'] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

/** De donde salio la mercaderia reservada: se elaboro para el pedido, o ya estaba. */
export const ORIGENES_RESERVA = ['produccion', 'stock'] as const;
export type OrigenReserva = (typeof ORIGENES_RESERVA)[number];

/**
 * Mercaderia que existe fisicamente pero ya tiene dueño.
 *
 * La reserva NO es un movimiento de stock: la mercaderia esta en el deposito,
 * el ledger no cambia. Lo que cambia es a quien se le puede prometer. De ahi
 * salen los tres numeros que el vendedor necesita distinguir:
 *
 *   fisico     = SUM(movimientos_stock)          <- lo que hay en el deposito
 *   reservado  = SUM(reservas activas)           <- lo que ya es de alguien
 *   disponible = fisico - reservado              <- lo que se puede vender hoy
 *
 * Sin esta tabla, dos vendedores prometen la misma tanda al mismo tiempo y uno
 * de los dos clientes se queda esperando.
 *
 * `ordenId` y `numeroLote` son la trazabilidad: dicen de que tanda salio lo que
 * se le prometio a ese cliente, tanto si se elaboro para el como si se tomo de
 * lo que ya habia en el deposito.
 */
export const reservasStock = sqliteTable(
  'reservas_stock',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    articuloId: integer('articulo_id')
      .notNull()
      .references(() => articulos.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    pedidoId: integer('pedido_id')
      .notNull()
      .references(() => pedidos.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    /** Denormalizado del pedido: el cliente puede cambiar, la reserva historica no. */
    clienteId: integer('cliente_id').references(() => clientes.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    cantidad: real('cantidad').notNull(),
    origen: text('origen', { enum: ORIGENES_RESERVA }).notNull(),
    /** Tanda de la que sale la mercaderia. Null si vino de una compra o un ajuste. */
    ordenId: integer('orden_id').references(() => ordenesProduccion.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    numeroLote: text('numero_lote'),
    estado: text('estado', { enum: ESTADOS_RESERVA }).notNull().default('activa'),
    /** Venta que finalmente se llevo la reserva. Se completa al facturar el pedido. */
    ventaId: integer('venta_id').references(() => ventas.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    fecha: text('fecha').notNull().default(AHORA),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_reservas_stock_articulo_estado').on(tabla.articuloId, tabla.estado),
    index('ix_reservas_stock_pedido').on(tabla.pedidoId),
    index('ix_reservas_stock_orden').on(tabla.ordenId),
    check('ck_reservas_stock_cantidad', sql`${tabla.cantidad} > 0`),
    check('ck_reservas_stock_origen', sql`${tabla.origen} IN ('produccion','stock')`),
    check('ck_reservas_stock_estado', sql`${tabla.estado} IN ('activa','entregada','liberada')`),
  ],
);

/* ------------------------------------------------------------------------- */
/* LEDGER DE CUENTAS CORRIENTES (clientes y proveedores)                     */
/* ------------------------------------------------------------------------- */

export const TIPOS_ENTIDAD_CC = ['cliente', 'proveedor'] as const;
export type TipoEntidadCc = (typeof TIPOS_ENTIDAD_CC)[number];

export const TIPOS_MOVIMIENTO_CC = ['debe', 'haber'] as const;
export type TipoMovimientoCc = (typeof TIPOS_MOVIMIENTO_CC)[number];

export const TIPOS_DOCUMENTO_CC = ['venta', 'compra', 'cobro', 'pago'] as const;
export type TipoDocumentoCc = (typeof TIPOS_DOCUMENTO_CC)[number];

export const cuentasCorrientes = sqliteTable(
  'cuentas_corrientes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entidadTipo: text('entidad_tipo', { enum: TIPOS_ENTIDAD_CC }).notNull(),
    /** FK logica a clientes.id o proveedores.id segun entidad_tipo (polimorfica, sin FK fisica). */
    entidadId: integer('entidad_id').notNull(),
    tipoMovimiento: text('tipo_movimiento', { enum: TIPOS_MOVIMIENTO_CC }).notNull(),
    /** Monto en centavos, siempre positivo. El signo lo da tipo_movimiento. */
    monto: integer('monto').notNull(),
    documentoTipo: text('documento_tipo', { enum: TIPOS_DOCUMENTO_CC }).notNull(),
    documentoId: integer('documento_id'),
    fecha: text('fecha').notNull().default(AHORA),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_cuentas_corrientes_entidad_fecha').on(tabla.entidadTipo, tabla.entidadId, tabla.fecha),
    index('ix_cuentas_corrientes_documento').on(tabla.documentoTipo, tabla.documentoId),
    check('ck_cuentas_corrientes_entidad_tipo', sql`${tabla.entidadTipo} IN ('cliente','proveedor')`),
    check('ck_cuentas_corrientes_tipo_movimiento', sql`${tabla.tipoMovimiento} IN ('debe','haber')`),
    check(
      'ck_cuentas_corrientes_documento_tipo',
      sql`${tabla.documentoTipo} IN ('venta','compra','cobro','pago')`,
    ),
    check('ck_cuentas_corrientes_monto', sql`${tabla.monto} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Caja                                                                      */
/* ------------------------------------------------------------------------- */

export const ESTADOS_CAJA = ['abierta', 'cerrada'] as const;
export type EstadoCaja = (typeof ESTADOS_CAJA)[number];

export const cajas = sqliteTable(
  'cajas',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    fechaApertura: text('fecha_apertura').notNull().default(AHORA),
    fechaCierre: text('fecha_cierre'),
    /** Todos los montos en centavos. */
    montoApertura: integer('monto_apertura').notNull().default(0),
    montoCierreTeorico: integer('monto_cierre_teorico'),
    montoCierreReal: integer('monto_cierre_real'),
    /** monto_cierre_real - monto_cierre_teorico (puede ser negativo). */
    diferencia: integer('diferencia'),
    estado: text('estado', { enum: ESTADOS_CAJA }).notNull().default('abierta'),
    usuario: text('usuario'),
  },
  (tabla) => [
    index('ix_cajas_estado').on(tabla.estado),
    index('ix_cajas_fecha_apertura').on(tabla.fechaApertura),
    check('ck_cajas_estado', sql`${tabla.estado} IN ('abierta','cerrada')`),
  ],
);

export const TIPOS_MOVIMIENTO_CAJA = ['ingreso', 'egreso'] as const;
export type TipoMovimientoCaja = (typeof TIPOS_MOVIMIENTO_CAJA)[number];

export const cajaMovimientos = sqliteTable(
  'caja_movimientos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    cajaId: integer('caja_id').references(() => cajas.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    tipo: text('tipo', { enum: TIPOS_MOVIMIENTO_CAJA }).notNull(),
    concepto: text('concepto').notNull(),
    /** Centavos, siempre positivo. El signo lo da `tipo`. */
    monto: integer('monto').notNull(),
    documentoTipo: text('documento_tipo'),
    documentoId: integer('documento_id'),
    /**
     * Con que medio entro/salio la plata. NULL = movimiento viejo o manual:
     * cuenta como efectivo fisico para el arqueo (criterio de StockFlow).
     */
    medioPagoId: integer('medio_pago_id').references(() => mediosPago.id, {
      onDelete: 'set null',
      onUpdate: 'cascade',
    }),
    fecha: text('fecha').notNull().default(AHORA),
    usuario: text('usuario'),
    notas: text('notas'),
  },
  (tabla) => [
    index('ix_caja_movimientos_caja_fecha').on(tabla.cajaId, tabla.fecha),
    index('ix_caja_movimientos_documento').on(tabla.documentoTipo, tabla.documentoId),
    check('ck_caja_movimientos_tipo', sql`${tabla.tipo} IN ('ingreso','egreso')`),
    check('ck_caja_movimientos_monto', sql`${tabla.monto} >= 0`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Cheques                                                                   */
/* ------------------------------------------------------------------------- */

export const TIPOS_CHEQUE = ['recibido', 'emitido'] as const;
export type TipoCheque = (typeof TIPOS_CHEQUE)[number];

export const FORMATOS_CHEQUE = ['fisico', 'echeq'] as const;
export type FormatoCheque = (typeof FORMATOS_CHEQUE)[number];

export const ESTADOS_CHEQUE = [
  'en_cartera',
  'depositado',
  'acreditado',
  'rechazado',
  'endosado',
  'entregado',
  'anulado',
] as const;
export type EstadoCheque = (typeof ESTADOS_CHEQUE)[number];

/**
 * Cartera de cheques (el cliente opera con cheques diferidos).
 * Recibidos: en_cartera -> depositado -> acreditado | rechazado, o endosado.
 * Emitidos: entregado -> rechazado. `anulado` sale desde cualquier estado no final.
 */
export const cheques = sqliteTable(
  'cheques',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tipo: text('tipo', { enum: TIPOS_CHEQUE }).notNull(),
    formato: text('formato', { enum: FORMATOS_CHEQUE }).notNull().default('fisico'),
    /** Numero del cheque fisico o identificador del ECHEQ. */
    numero: text('numero').notNull(),
    banco: text('banco'),
    /** CUIT del emisor (obligatorio en ECHEQ, opcional en fisico). */
    cuitEmisor: text('cuit_emisor'),
    /** Quien lo emitio (recibido) o a quien se entrego (emitido). */
    contraparte: text('contraparte').notNull(),
    /** FK logica opcional a clientes/proveedores, como en cuentas_corrientes. */
    entidadTipo: text('entidad_tipo', { enum: TIPOS_ENTIDAD_CC }),
    entidadId: integer('entidad_id'),
    /** Centavos, siempre positivo. */
    importe: integer('importe').notNull(),
    fechaEmision: text('fecha_emision').notNull(),
    /** Fecha de pago/vencimiento (cheque diferido). Rige los avisos de la cartera. */
    fechaPago: text('fecha_pago').notNull(),
    estado: text('estado', { enum: ESTADOS_CHEQUE }).notNull(),
    documentoTipo: text('documento_tipo'),
    documentoId: integer('documento_id'),
    notas: text('notas'),
    createdAt: text('created_at').notNull().default(AHORA),
  },
  (tabla) => [
    index('ix_cheques_tipo_estado').on(tabla.tipo, tabla.estado),
    index('ix_cheques_fecha_pago').on(tabla.fechaPago),
    check('ck_cheques_tipo', sql`${tabla.tipo} IN ('recibido','emitido')`),
    check('ck_cheques_formato', sql`${tabla.formato} IN ('fisico','echeq')`),
    check(
      'ck_cheques_estado',
      sql`${tabla.estado} IN ('en_cartera','depositado','acreditado','rechazado','endosado','entregado','anulado')`,
    ),
    check('ck_cheques_importe', sql`${tabla.importe} > 0`),
  ],
);

export type Cheque = typeof cheques.$inferSelect;
export type NuevoCheque = typeof cheques.$inferInsert;

/* ------------------------------------------------------------------------- */
/* Facturacion electronica ARCA                                              */
/* ------------------------------------------------------------------------- */

export const ENTORNOS_ARCA = ['homologacion', 'produccion'] as const;
export type EntornoArca = (typeof ENTORNOS_ARCA)[number];

export const CONDICIONES_IVA = ['RI', 'MT'] as const;
export type CondicionIva = (typeof CONDICIONES_IVA)[number];

/** Configuracion fiscal del emisor. Singleton: id fijo 'unica'. */
export const configuracionFiscal = sqliteTable('configuracion_fiscal', {
  id: text('id').primaryKey(),
  entorno: text('entorno', { enum: ENTORNOS_ARCA }).notNull().default('homologacion'),
  cuit: text('cuit').notNull().default(''),
  razonSocial: text('razon_social'),
  direccion: text('direccion'),
  condicionIva: text('condicion_iva', { enum: CONDICIONES_IVA }).notNull().default('RI'),
  iibb: text('iibb'),
  /** Rutas en disco al certificado X.509 y la clave privada del tramite ARCA. */
  rutaCertificado: text('ruta_certificado'),
  rutaClave: text('ruta_clave'),
  puntoVenta: integer('punto_venta').notNull().default(1),
  habilitada: integer('habilitada', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull().default(AHORA),
});

export const LETRAS_COMPROBANTE = ['A', 'B'] as const;
export type LetraComprobante = (typeof LETRAS_COMPROBANTE)[number];

/**
 * Comprobantes fiscales emitidos con CAE. Solo se persisten APROBADOS: si ARCA
 * rechaza, no se consume numeracion ni queda rastro local (patron StockFlow).
 * Los datos del receptor se congelan al emitir: ARCA los exige inmutables.
 */
export const comprobantes = sqliteTable(
  'comprobantes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ventaId: integer('venta_id')
      .notNull()
      .references(() => ventas.id, { onDelete: 'restrict', onUpdate: 'cascade' }),
    /** Codigo ARCA: 1 = Factura A, 6 = Factura B. */
    codigoArca: integer('codigo_arca').notNull(),
    letra: text('letra', { enum: LETRAS_COMPROBANTE }).notNull(),
    puntoVenta: integer('punto_venta').notNull(),
    numero: integer('numero').notNull(),
    fecha: text('fecha').notNull(),
    /** Doc del receptor: 80 = CUIT, 96 = DNI, 99 = consumidor final. */
    docTipo: integer('doc_tipo').notNull(),
    docNumero: text('doc_numero').notNull(),
    receptorNombre: text('receptor_nombre').notNull(),
    /**
     * Condicion del receptor frente al IVA informada a ARCA (tabla
     * FEParamGetCondicionIvaReceptor). Se guarda para poder IMPRIMIRLA: sin
     * esto, el comprobante impreso tendria que adivinarla y diria
     * "Consumidor Final" aunque se haya emitido a un monotributista.
     */
    condicionIvaReceptor: integer('condicion_iva_receptor'),
    /** Centavos. neto + iva = total. */
    neto: integer('neto').notNull(),
    iva: integer('iva').notNull(),
    total: integer('total').notNull(),
    cae: text('cae').notNull(),
    caeVencimiento: text('cae_vencimiento'),
    observaciones: text('observaciones'),
    urlQr: text('url_qr'),
    createdAt: text('created_at').notNull().default(AHORA),
  },
  (tabla) => [
    uniqueIndex('ux_comprobantes_numeracion').on(tabla.codigoArca, tabla.puntoVenta, tabla.numero),
    uniqueIndex('ux_comprobantes_venta').on(tabla.ventaId),
  ],
);

export type ConfiguracionFiscal = typeof configuracionFiscal.$inferSelect;
export type Comprobante = typeof comprobantes.$inferSelect;

/* ------------------------------------------------------------------------- */
/* Usuarios                                                                  */
/* ------------------------------------------------------------------------- */

export const ROLES_USUARIO = ['admin', 'empleado'] as const;
export type RolUsuario = (typeof ROLES_USUARIO)[number];

export const usuarios = sqliteTable(
  'usuarios',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    rol: text('rol', { enum: ROLES_USUARIO }).notNull().default('empleado'),
    activo: integer('activo', { mode: 'boolean' }).notNull().default(true),
  },
  (tabla) => [
    uniqueIndex('ux_usuarios_username').on(tabla.username),
    check('ck_usuarios_rol', sql`${tabla.rol} IN ('admin','empleado')`),
  ],
);

/* ------------------------------------------------------------------------- */
/* Tipos inferidos (select / insert) para uso en repositorios y servicios    */
/* ------------------------------------------------------------------------- */

export type UnidadMedida = typeof unidadesMedida.$inferSelect;
export type NuevaUnidadMedida = typeof unidadesMedida.$inferInsert;

export type Articulo = typeof articulos.$inferSelect;
export type NuevoArticulo = typeof articulos.$inferInsert;

export type ListaPrecio = typeof listasPrecio.$inferSelect;
export type NuevaListaPrecio = typeof listasPrecio.$inferInsert;

export type Precio = typeof precios.$inferSelect;
export type NuevoPrecio = typeof precios.$inferInsert;

export type Proveedor = typeof proveedores.$inferSelect;
export type NuevoProveedor = typeof proveedores.$inferInsert;

export type Cliente = typeof clientes.$inferSelect;
export type NuevoCliente = typeof clientes.$inferInsert;

export type Receta = typeof recetas.$inferSelect;
export type NuevaReceta = typeof recetas.$inferInsert;

export type RecetaItem = typeof recetaItems.$inferSelect;
export type NuevoRecetaItem = typeof recetaItems.$inferInsert;

export type Pedido = typeof pedidos.$inferSelect;
export type NuevoPedido = typeof pedidos.$inferInsert;

export type PedidoItem = typeof pedidoItems.$inferSelect;
export type NuevoPedidoItem = typeof pedidoItems.$inferInsert;

export type OrdenProduccion = typeof ordenesProduccion.$inferSelect;
export type NuevaOrdenProduccion = typeof ordenesProduccion.$inferInsert;

export type ProduccionConsumo = typeof produccionConsumos.$inferSelect;
export type NuevoProduccionConsumo = typeof produccionConsumos.$inferInsert;

export type MovimientoStock = typeof movimientosStock.$inferSelect;
export type NuevoMovimientoStock = typeof movimientosStock.$inferInsert;

export type Compra = typeof compras.$inferSelect;
export type NuevaCompra = typeof compras.$inferInsert;

export type CompraItem = typeof compraItems.$inferSelect;
export type NuevoCompraItem = typeof compraItems.$inferInsert;

export type Venta = typeof ventas.$inferSelect;
export type NuevaVenta = typeof ventas.$inferInsert;

export type VentaItem = typeof ventaItems.$inferSelect;
export type NuevoVentaItem = typeof ventaItems.$inferInsert;

export type CuentaCorriente = typeof cuentasCorrientes.$inferSelect;
export type NuevaCuentaCorriente = typeof cuentasCorrientes.$inferInsert;

export type Caja = typeof cajas.$inferSelect;
export type NuevaCaja = typeof cajas.$inferInsert;

export type CajaMovimiento = typeof cajaMovimientos.$inferSelect;
export type NuevoCajaMovimiento = typeof cajaMovimientos.$inferInsert;

export type Usuario = typeof usuarios.$inferSelect;
export type NuevoUsuario = typeof usuarios.$inferInsert;
