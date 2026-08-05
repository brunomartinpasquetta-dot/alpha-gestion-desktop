/**
 * CONTRATO DE LA API DE LECTURA.
 *
 * Unica fuente de verdad de las formas que viajan entre el servidor y el renderer.
 * Lo importan las dos puntas, asi que debe ser PURO: solo tipos y constantes, sin
 * `process`, sin Node, sin Drizzle, sin Fastify.
 *
 * Convenciones:
 *  - Todo importe viene en CENTAVOS (entero). El renderer los convierte a pesos
 *    solo para mostrar.
 *  - Toda cantidad viene en REAL, ya redondeada, expresada en la unidad base del
 *    articulo, y acompanada de la abreviatura de esa unidad.
 *  - Toda fecha viaja como texto ISO-8601 en UTC.
 *  - Todas las respuestas de lista tienen la forma { datos: T[] }.
 */

/* ------------------------------- Enumeraciones ---------------------------- */

export type TipoArticulo = 'materia_prima' | 'pre_elaborado' | 'producto_terminado';
export type GrupoStock = 'insumos' | 'productos';
export type TipoMovimientoStock =
  | 'compra'
  | 'venta'
  | 'consumo_produccion'
  | 'ingreso_produccion'
  | 'merma'
  | 'ajuste';
export type TipoDocumentoStock = 'compra' | 'venta' | 'orden_produccion' | 'ajuste';
export type EstadoOrdenProduccion = 'planificada' | 'en_proceso' | 'finalizada' | 'cancelada';
export type FormaPago = 'contado' | 'cuenta_corriente';
export type EstadoCompra = 'pendiente' | 'recibida';
export type EstadoVenta = 'pendiente' | 'entregada' | 'anulada';
export type OrigenPedido = 'celular' | 'mostrador' | 'sistema';
export type EstadoPedido =
  | 'pendiente'
  | 'confirmado'
  | 'en_produccion'
  | 'listo'
  | 'entregado'
  | 'cancelado';
export type TipoCliente = 'mostrador' | 'mayorista' | 'distribuidor';
export type TipoEntidadCc = 'cliente' | 'proveedor';
export type TipoMovimientoCaja = 'ingreso' | 'egreso';
export type EstadoCaja = 'abierta' | 'cerrada';

/* --------------------------- Envoltorios genericos ------------------------ */

export interface RespuestaLista<T> {
  datos: T[];
}

export interface RespuestaItem<T> {
  datos: T;
}

export interface ErrorApi {
  error: { codigo: string; mensaje: string; detalles?: unknown };
}

/* --------------------------------- Salud ---------------------------------- */

export interface RespuestaSalud {
  ok: boolean;
  version: string;
  entorno: 'desarrollo' | 'produccion';
  db: { ok: boolean; rutaDb: string; tablas: number; error?: string };
}

/* ------------------------------- Articulos -------------------------------- */

export interface ArticuloConStock {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadBaseId: number;
  unidadAbreviatura: string;
  stockMin: number | null;
  costoActual: number | null;
  activo: boolean;
  stock: number;
  bajoMinimo: boolean;
}

export interface SaldoStock {
  articuloId: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadAbreviatura: string;
  stock: number;
  stockMin: number | null;
  bajoMinimo: boolean;
}

/** Fila del ledger de un articulo, con el saldo acumulado hasta ese movimiento. */
export interface MovimientoStockVista {
  id: number;
  fecha: string;
  tipo: TipoMovimientoStock;
  cantidad: number;
  costoUnitario: number | null;
  documentoTipo: TipoDocumentoStock | null;
  documentoId: number | null;
  notas: string | null;
  saldoAcumulado: number;
}

/* -------------------------------- Recetas --------------------------------- */

export interface RecetaItemVista {
  id: number;
  articuloInsumoId: number;
  insumoCodigo: string;
  insumoNombre: string;
  insumoTipo: TipoArticulo;
  cantidad: number;
  unidadAbreviatura: string;
  mermaEsperadaPct: number;
}

export interface RecetaVista {
  id: number;
  articuloProducidoId: number;
  articuloProducidoCodigo: string;
  articuloProducidoNombre: string;
  articuloProducidoTipo: TipoArticulo;
  rindeCantidad: number;
  rindeUnidadAbreviatura: string;
  activa: boolean;
  notas: string | null;
  items: RecetaItemVista[];
}

/* ------------------------------- Produccion ------------------------------- */

export interface OrdenProduccionVista {
  id: number;
  recetaId: number;
  articuloProducidoId: number;
  articuloProducidoCodigo: string;
  articuloProducidoNombre: string;
  cantidadPlanificada: number;
  unidadAbreviatura: string;
  factorEscala: number;
  estado: EstadoOrdenProduccion;
  pedidoId: number | null;
  rindeReal: number | null;
  fechaPlanificada: string;
  fechaInicio: string | null;
  fechaFin: string | null;
  notas: string | null;
  cantidadInsumos: number;
}

/* --------------------------------- Compras -------------------------------- */

export interface CompraVista {
  id: number;
  fecha: string;
  proveedorId: number;
  proveedorNombre: string;
  total: number;
  formaPago: FormaPago;
  estado: EstadoCompra;
  cantidadItems: number;
  notas: string | null;
}

/* --------------------------------- Ventas --------------------------------- */

export interface VentaVista {
  id: number;
  fecha: string;
  clienteId: number | null;
  /** null = venta de mostrador sin cliente identificado. */
  clienteNombre: string | null;
  total: number;
  formaPago: FormaPago;
  estado: EstadoVenta;
  pedidoId: number | null;
  cantidadItems: number;
  notas: string | null;
}

/* --------------------------------- Pedidos -------------------------------- */

export interface PedidoItemVista {
  id: number;
  articuloId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  unidadAbreviatura: string;
  notas: string | null;
}

export interface PedidoVista {
  id: number;
  clienteId: number | null;
  clienteNombre: string | null;
  origen: OrigenPedido;
  estado: EstadoPedido;
  fechaPedido: string;
  fechaEntregaEstimada: string | null;
  cargadoPor: string | null;
  notas: string | null;
  items: PedidoItemVista[];
}

/* ----------------------------- Cuentas corrientes ------------------------- */

export interface SaldoCuentaCorriente {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  debe: number;
  haber: number;
  saldo: number;
}

export interface ResumenCuentaCorriente extends SaldoCuentaCorriente {
  entidadNombre: string;
  cantidadMovimientos: number;
  ultimoMovimiento: string | null;
}

/* ----------------------------------- Caja --------------------------------- */

export interface CajaVista {
  id: number;
  fechaApertura: string;
  fechaCierre: string | null;
  montoApertura: number;
  montoCierreTeorico: number | null;
  montoCierreReal: number | null;
  diferencia: number | null;
  estado: EstadoCaja;
  usuario: string | null;
  totalIngresos: number;
  totalEgresos: number;
}

export interface CajaMovimientoVista {
  id: number;
  cajaId: number | null;
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  documentoTipo: string | null;
  documentoId: number | null;
  fecha: string;
  usuario: string | null;
  notas: string | null;
}

/* --------------------------------- Terceros ------------------------------- */

export interface ClienteVista {
  id: number;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  tipo: TipoCliente;
  listaPrecioId: number | null;
  listaPrecioNombre: string | null;
  activo: boolean;
  saldoCc: number;
}

export interface ProveedorVista {
  id: number;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  saldoCc: number;
}

/* --------------------------------- Precios -------------------------------- */

export interface PrecioVista {
  id: number;
  articuloId: number;
  codigo: string;
  nombre: string;
  precio: number;
  vigenteDesde: string;
}

export interface ListaPrecioVista {
  id: number;
  nombre: string;
  activa: boolean;
  precios: PrecioVista[];
}

/* -------------------------------- Resumen --------------------------------- */

/** Datos del tablero de inicio. Todo se calcula en una sola pasada del servidor. */
export interface ResumenGeneral {
  articulos: {
    total: number;
    insumos: number;
    productos: number;
    bajoMinimo: number;
  };
  pedidos: {
    pendientes: number;
    enProduccion: number;
    listos: number;
  };
  produccion: {
    planificadas: number;
    enProceso: number;
  };
  compras: {
    pendientes: number;
    totalMes: number;
  };
  ventas: {
    cantidadMes: number;
    totalMes: number;
  };
  caja: {
    abierta: boolean;
    cajaId: number | null;
    saldoEstimado: number;
  };
  cuentasCorrientes: {
    saldoClientes: number;
    saldoProveedores: number;
  };
}

/* ------------------------- Etiquetas para la interfaz --------------------- */

export const ETIQUETA_TIPO_ARTICULO: Readonly<Record<TipoArticulo, string>> = {
  materia_prima: 'Materia prima',
  pre_elaborado: 'Pre-elaborado',
  producto_terminado: 'Producto terminado',
};

export const ETIQUETA_TIPO_MOVIMIENTO: Readonly<Record<TipoMovimientoStock, string>> = {
  compra: 'Compra',
  venta: 'Venta',
  consumo_produccion: 'Consumo de produccion',
  ingreso_produccion: 'Ingreso de produccion',
  merma: 'Merma',
  ajuste: 'Ajuste',
};

export const ETIQUETA_ESTADO_ORDEN: Readonly<Record<EstadoOrdenProduccion, string>> = {
  planificada: 'Planificada',
  en_proceso: 'En proceso',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

export const ETIQUETA_ESTADO_PEDIDO: Readonly<Record<EstadoPedido, string>> = {
  pendiente: 'Pendiente',
  confirmado: 'Confirmado',
  en_produccion: 'En produccion',
  listo: 'Listo',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const ETIQUETA_ORIGEN_PEDIDO: Readonly<Record<OrigenPedido, string>> = {
  celular: 'Celular',
  mostrador: 'Mostrador',
  sistema: 'Sistema',
};

export const ETIQUETA_ESTADO_COMPRA: Readonly<Record<EstadoCompra, string>> = {
  pendiente: 'Pendiente',
  recibida: 'Recibida',
};

export const ETIQUETA_ESTADO_VENTA: Readonly<Record<EstadoVenta, string>> = {
  pendiente: 'Pendiente',
  entregada: 'Entregada',
  anulada: 'Anulada',
};

export const ETIQUETA_FORMA_PAGO: Readonly<Record<FormaPago, string>> = {
  contado: 'Contado',
  cuenta_corriente: 'Cuenta corriente',
};

export const ETIQUETA_TIPO_CLIENTE: Readonly<Record<TipoCliente, string>> = {
  mostrador: 'Mostrador',
  mayorista: 'Mayorista',
  distribuidor: 'Distribuidor',
};
