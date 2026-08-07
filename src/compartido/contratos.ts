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
export type EstadoCompra = 'pendiente' | 'recibida' | 'anulada';
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
  /**
   * URL de la PWA de pedidos en la red local (http://<ip>:<puerto>/pedidos),
   * o null si el servidor solo escucha en loopback. Es la direccion que se
   * abre en el celular.
   */
  urlPedidos?: string | null;
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
  /** Unidades por caja cerrada. null = no se comercializa por caja. */
  unidadesPorCaja: number | null;
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
  /** Unidades por caja cerrada. null = no se comercializa por caja. */
  unidadesPorCaja: number | null;
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
  /** Numero de lote de la tanda; null hasta que la orden se ejecuta. */
  numeroLote: string | null;
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
  /** "FB 00001-00000042" si tiene factura con CAE; null = remito interno. */
  comprobanteEtiqueta?: string | null;
  cae?: string | null;
}

/* --------------------------------- Pedidos -------------------------------- */

export interface PedidoItemVista {
  id: number;
  articuloId: number;
  codigo: string;
  nombre: string;
  /** Siempre en unidad base. La vista la convierte a cajas si corresponde. */
  cantidad: number;
  unidadAbreviatura: string;
  unidadesPorCaja: number | null;
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
  cantidadMovimientos?: number;
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
  anulada: 'Anulada',
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

/* ------------------------------ Caja general ------------------------------ */

/** Tesoreria consolidada: todas las cajas juntas, no una sola jornada. */
export interface ResumenCajaGeneral {
  totalCajas: number;
  cajasAbiertas: number;
  cajasCerradas: number;
  /** Suma de los montos de apertura de todas las cajas (centavos). */
  totalAperturas: number;
  totalIngresos: number;
  totalEgresos: number;
  /** aperturas + ingresos - egresos. */
  saldoAcumulado: number;
  /** Suma de las diferencias de arqueo de las cajas cerradas. Negativo = faltante. */
  diferenciaAcumulada: number;
}

/* ------------------------------- Estadisticas ----------------------------- */

export interface PeriodoEstadistica {
  /** Mes en formato AAAA-MM. */
  mes: string;
  cantidad: number;
  /** Centavos. */
  total: number;
}

export interface ArticuloVendido {
  articuloId: number;
  codigo: string;
  nombre: string;
  cantidad: number;
  /** Centavos. */
  total: number;
}

export interface Estadisticas {
  ventasPorMes: PeriodoEstadistica[];
  comprasPorMes: PeriodoEstadistica[];
  masVendidos: ArticuloVendido[];
  /**
   * Valorizacion del inventario: stock x costo actual, en centavos.
   * El stock negativo se piza en cero: valorizar en negativo daria un activo
   * negativo, que no significa nada contablemente.
   */
  valorizacion: { insumos: number; productos: number; total: number };
}

/* --------------------------------- Usuarios -------------------------------- */

export type RolUsuario = 'admin' | 'empleado';

export interface UsuarioVista {
  id: number;
  username: string;
  rol: RolUsuario;
  activo: boolean;
}

export const ETIQUETA_ROL: Readonly<Record<RolUsuario, string>> = {
  admin: 'Administrador',
  empleado: 'Empleado',
};

/* ------------------------- Escritura de pedidos --------------------------- */

/** Item de un pedido nuevo, tal como lo envia el celular o el mostrador. */
export interface EntradaItemPedido {
  articuloId: number;
  cantidad: number;
  notas?: string | null;
}

/** Cuerpo de POST /api/pedidos. Lo comparten la PWA del celular y el escritorio. */
export interface EntradaNuevoPedido {
  clienteId?: number | null;
  origen: OrigenPedido;
  fechaEntregaEstimada?: string | null;
  cargadoPor?: string | null;
  notas?: string | null;
  items: EntradaItemPedido[];
  /**
   * Clave unica del cliente para que un reintento (cola offline con respuesta
   * perdida) no duplique el pedido: si el servidor ya la vio, devuelve el
   * pedido existente con 200 en vez de crear otro.
   */
  claveIdempotencia?: string | null;
}

/**
 * Maquina de estados del pedido: desde cada estado, a cuales se puede pasar.
 * Cancelable mientras no se haya entregado; la entrega es terminal.
 */
export const TRANSICIONES_PEDIDO: Readonly<Record<EstadoPedido, readonly EstadoPedido[]>> = {
  pendiente: ['confirmado', 'cancelado'],
  confirmado: ['en_produccion', 'cancelado'],
  en_produccion: ['listo', 'cancelado'],
  listo: ['entregado'],
  entregado: [],
  cancelado: [],
};

/** Accion visible en la interfaz para cada transicion. */
export const ETIQUETA_TRANSICION: Readonly<Record<EstadoPedido, string>> = {
  pendiente: 'Marcar pendiente',
  confirmado: 'Confirmar',
  en_produccion: 'Pasar a produccion',
  listo: 'Marcar listo',
  entregado: 'Entregar',
  cancelado: 'Cancelar',
};

/* ------------------------ Produccion: ejecucion y lote --------------------- */

/**
 * Maquina de estados de la orden de produccion. Al pasar a `en_proceso` se
 * asigna el numero de lote; al pasar a `finalizada` se generan los movimientos
 * de stock (consumos negativos + ingreso del producido).
 */
export const TRANSICIONES_ORDEN: Readonly<
  Record<EstadoOrdenProduccion, readonly EstadoOrdenProduccion[]>
> = {
  planificada: ['en_proceso', 'cancelada'],
  en_proceso: ['finalizada', 'cancelada'],
  finalizada: [],
  cancelada: [],
};

export const ETIQUETA_TRANSICION_ORDEN: Readonly<Record<EstadoOrdenProduccion, string>> = {
  planificada: 'Planificar',
  en_proceso: 'Ejecutar',
  finalizada: 'Finalizar',
  cancelada: 'Cancelar',
};

/** Cuerpo de PATCH /api/produccion/ordenes/:id/estado. */
export interface EntradaCambioEstadoOrden {
  estado: EstadoOrdenProduccion;
  /** Solo al finalizar: unidades reales que salieron. Si falta, se asume lo planificado. */
  rindeReal?: number | null;
}

/** Respuesta del cambio de estado de una orden. */
export interface ResultadoOrden {
  id: number;
  estado: EstadoOrdenProduccion;
  numeroLote: string | null;
  /**
   * Avisos operativos que NO bloquean (ej: un insumo quedo en stock negativo al
   * finalizar). La tanda fisica ya ocurrio; bloquear el registro seria mentirle
   * al ledger. Pero el usuario tiene que enterarse.
   */
  advertencias: string[];
}

/* ------------------------------ Trazabilidad ------------------------------- */

export interface ConsumoTrazado {
  articuloId: number;
  codigo: string;
  nombre: string;
  unidadAbreviatura: string;
  cantidadTeorica: number;
  cantidadReal: number | null;
  /** real - teorica; positivo = se uso de mas (merma). null si no hay real. */
  merma: number | null;
}

export interface MovimientoTrazado {
  id: number;
  fecha: string;
  tipo: TipoMovimientoStock;
  articuloId: number;
  articuloNombre: string;
  cantidad: number;
  unidadAbreviatura: string;
}

/** Respuesta de GET /api/trazabilidad/:lote — la historia completa de una tanda. */
export interface TrazabilidadLote {
  numeroLote: string;
  orden: OrdenProduccionVista;
  consumos: ConsumoTrazado[];
  movimientos: MovimientoTrazado[];
  /** Stock actual del articulo producido, para cerrar el circulo. */
  stockActualProducido: number;
}

/* --------------------------------- Cheques --------------------------------- */

export type TipoCheque = 'recibido' | 'emitido';
export type FormatoCheque = 'fisico' | 'echeq';
export type EstadoCheque =
  | 'en_cartera'
  | 'depositado'
  | 'acreditado'
  | 'rechazado'
  | 'endosado'
  | 'entregado'
  | 'anulado';

export interface ChequeVista {
  id: number;
  tipo: TipoCheque;
  formato: FormatoCheque;
  numero: string;
  banco: string | null;
  cuitEmisor: string | null;
  contraparte: string;
  entidadTipo: TipoEntidadCc | null;
  entidadId: number | null;
  importe: number;
  fechaEmision: string;
  fechaPago: string;
  estado: EstadoCheque;
  notas: string | null;
}

export interface EntradaNuevoCheque {
  tipo: TipoCheque;
  formato: FormatoCheque;
  numero: string;
  banco?: string | null;
  cuitEmisor?: string | null;
  contraparte: string;
  entidadTipo?: TipoEntidadCc | null;
  entidadId?: number | null;
  /** Centavos. */
  importe: number;
  fechaEmision: string;
  fechaPago: string;
  notas?: string | null;
}

/** Indicadores de la cartera: vencimientos proximos y plata en la calle. */
export interface ResumenCartera {
  enCartera: number;
  importeEnCartera: number;
  porVencer7Dias: number;
  vencidos: number;
}

/**
 * Transiciones por tipo. El recibido va camino al banco (o se endosa); el
 * emitido solo puede rebotar. `anulado` corrige un alta equivocada.
 */
export const TRANSICIONES_CHEQUE: Readonly<
  Record<TipoCheque, Readonly<Record<EstadoCheque, readonly EstadoCheque[]>>>
> = {
  recibido: {
    en_cartera: ['depositado', 'endosado', 'anulado'],
    depositado: ['acreditado', 'rechazado'],
    acreditado: [],
    rechazado: ['depositado'],
    endosado: [],
    entregado: [],
    anulado: [],
  },
  emitido: {
    en_cartera: [],
    depositado: [],
    acreditado: [],
    rechazado: [],
    endosado: [],
    entregado: ['rechazado', 'anulado'],
    anulado: [],
  },
};

export const ETIQUETA_ESTADO_CHEQUE: Readonly<Record<EstadoCheque, string>> = {
  en_cartera: 'En cartera',
  depositado: 'Depositado',
  acreditado: 'Acreditado',
  rechazado: 'Rechazado',
  endosado: 'Endosado',
  entregado: 'Entregado',
  anulado: 'Anulado',
};

/* ---------------------------- Escritura de ventas -------------------------- */

export interface EntradaItemVenta {
  articuloId: number;
  /** En unidad base. La UI captura cajas y multiplica, igual que en pedidos. */
  cantidad: number;
  /** Centavos por unidad base. Sugerido desde la lista del cliente, editable. */
  precioUnitario: number;
}

/**
 * Documento que se emite CON la venta, como en StockFlow: remito interno (sin
 * ARCA) o factura electronica con CAE. El CAE se obtiene antes de persistir.
 */
export const TIPOS_COMPROBANTE = ['remito', 'factura_b', 'factura_a'] as const;
export type TipoComprobante = (typeof TIPOS_COMPROBANTE)[number];

export const NOMBRES_COMPROBANTE: Record<TipoComprobante, string> = {
  remito: 'Remito X (interno)',
  factura_b: 'Factura B',
  factura_a: 'Factura A',
};

/**
 * Condicion del RECEPTOR frente al IVA, obligatoria en el comprobante desde la
 * RG 5616. Los codigos son los de la tabla FEParamGetCondicionIvaReceptor.
 * Una Factura A solo puede ir a un Responsable Inscripto, asi que en ese caso
 * no se pregunta: se manda 1.
 */
export const CONDICIONES_IVA_RECEPTOR = [
  { codigo: 5, etiqueta: 'Consumidor Final' },
  { codigo: 6, etiqueta: 'Monotributo' },
  { codigo: 4, etiqueta: 'Exento' },
  { codigo: 1, etiqueta: 'Responsable Inscripto' },
] as const;

export const CODIGO_RECEPTOR_RI = 1;
export const CODIGO_RECEPTOR_CONSUMIDOR_FINAL = 5;

/** Nombre legible de la condicion del receptor, para imprimir el comprobante. */
export function nombreCondicionReceptor(codigo: number | null): string {
  return CONDICIONES_IVA_RECEPTOR.find((c) => c.codigo === codigo)?.etiqueta ?? 'Consumidor Final';
}

/** Cuerpo de POST /api/ventas. La venta nace ENTREGADA: registra un hecho. */
export interface EntradaNuevaVenta {
  clienteId?: number | null;
  formaPago: FormaPago;
  /** Si la venta sale de un pedido listo, se lo marca entregado en el mismo acto. */
  pedidoId?: number | null;
  notas?: string | null;
  /** Por defecto 'remito': comportamiento historico, sin ARCA de por medio. */
  comprobante?: TipoComprobante;
  /** Condicion del receptor frente al IVA. Solo se usa en Factura B. */
  condicionIvaReceptor?: number;
  items: EntradaItemVenta[];
}

/** Respuesta de la creacion o anulacion de una venta. */
export interface ResultadoVenta {
  venta: VentaVista;
  /** Avisos que no bloquean: stock que quedo negativo, caja sin abrir, etc. */
  advertencias: string[];
}

/* ------------------------------ Fiscal / ARCA ------------------------------ */

export interface ConfiguracionFiscalVista {
  entorno: 'homologacion' | 'produccion';
  cuit: string;
  razonSocial: string | null;
  direccion: string | null;
  condicionIva: 'RI' | 'MT';
  iibb: string | null;
  rutaCertificado: string | null;
  rutaClave: string | null;
  puntoVenta: number;
  /** Solo con CUIT + certificado + clave cargados se ofrecen facturas en la venta. */
  habilitada: boolean;
}

/** Cuerpo de PUT /api/fiscal/config. */
export interface EntradaConfiguracionFiscal {
  entorno: 'homologacion' | 'produccion';
  cuit: string;
  razonSocial?: string | null;
  direccion?: string | null;
  condicionIva: 'RI' | 'MT';
  iibb?: string | null;
  rutaCertificado?: string | null;
  rutaClave?: string | null;
  puntoVenta: number;
  habilitada: boolean;
}

/** Respuesta de POST /api/fiscal/probar. */
export interface ResultadoPruebaArca {
  entorno: 'homologacion' | 'produccion';
  /** Estado de los servidores de ARCA (FEDummy), o null si no respondieron. */
  servidores: string | null;
  /** Resultado de la autenticacion WSAA con el certificado, o null si no se probo. */
  autenticacion: string | null;
  /** Ultimo numero de Factura B autorizado en el punto de venta configurado. */
  ultimoNumero: number | null;
  errores: string[];
}

/** Comprobante fiscal aprobado, asociado 1 a 1 con su venta. */
export interface ComprobanteVista {
  letra: 'A' | 'B';
  puntoVenta: number;
  numero: number;
  cae: string;
  caeVencimiento: string | null;
  neto: number;
  iva: number;
  total: number;
  observaciones: string | null;
  urlQr: string | null;
}

/**
 * Eventos del stream SSE. Viven en el contrato porque los emite el servidor y
 * los escucha el renderer: si cada lado declara su propia lista, agregar un
 * evento compila de un lado y falla del otro.
 */
export type TipoEventoSse =
  | 'pedidos:cambio'
  | 'ordenes:cambio'
  | 'cheques:cambio'
  | 'ventas:cambio'
  | 'compras:cambio'
  | 'caja:cambio'
  | 'cc:cambio'
  | 'maestros:cambio';

export interface UnidadMedidaVista {
  id: number;
  nombre: string;
  abreviatura: string;
}

/* ========================= ESCRITURA DE MAESTROS ========================== */

export interface EntradaCliente {
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  tipo: TipoCliente;
  listaPrecioId?: number | null;
  notas?: string | null;
}

export interface EntradaProveedor {
  nombre: string;
  cuit?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

export interface EntradaUsuario {
  username: string;
  /** Al editar, vacio o ausente significa "no cambiar la contraseña". */
  password?: string;
  rol: RolUsuario;
}

export interface EntradaArticulo {
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadBaseId: number;
  stockMin?: number | null;
  /** Solo tiene sentido en producto_terminado; en el resto se ignora. */
  unidadesPorCaja?: number | null;
  /** Centavos por unidad base. */
  costoActual?: number | null;
}

/* ============================ COMPRAS (escritura) ========================= */

export interface EntradaItemCompra {
  articuloId: number;
  /** Como se compra: 2 bolsas, 10 cajas. */
  cantidadCompra: number;
  unidadCompraId: number;
  /** Convierte a unidad base: bolsa de 25 kg -> 25000 si la base es el gramo. */
  factorConversion: number;
  /** Centavos por UNIDAD BASE. */
  costoUnitario: number;
}

export interface EntradaNuevaCompra {
  proveedorId: number;
  formaPago: FormaPago;
  notas?: string | null;
  items: EntradaItemCompra[];
}

export interface ResultadoCompra {
  compra: CompraVista;
  advertencias: string[];
}

/* =========================== TESORERIA (escritura) ======================== */

export interface EntradaAperturaCaja {
  /** Centavos con los que arranca el dia. */
  montoApertura: number;
  usuario?: string | null;
}

export interface EntradaCierreCaja {
  /** Lo que el operador conto de verdad, en centavos. */
  montoCierreReal: number;
}

export interface EntradaMovimientoCaja {
  tipo: TipoMovimientoCaja;
  concepto: string;
  monto: number;
  usuario?: string | null;
  notas?: string | null;
}

export type MedioCobroPago = 'efectivo' | 'cheque' | 'transferencia';

export const ETIQUETA_MEDIO_COBRO: Record<MedioCobroPago, string> = {
  efectivo: 'Efectivo',
  cheque: 'Cheque',
  transferencia: 'Transferencia',
};

/** Cobro a un cliente o pago a un proveedor. */
export interface EntradaCobroPago {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  monto: number;
  medio: MedioCobroPago;
  notas?: string | null;
}

export interface ResultadoCobroPago {
  entidadNombre: string;
  monto: number;
  advertencias: string[];
}

/* ========================= PRODUCCION (escritura) ======================== */

export interface EntradaNuevaOrden {
  recetaId: number;
  /** Media tanda = 0.5, doble = 2. La cantidad sale del rinde por este factor. */
  factorEscala: number;
  pedidoId?: number | null;
  notas?: string | null;
}

/* ====================== AJUSTES, RECETAS Y PRECIOS ======================= */

export interface EntradaAjusteStock {
  articuloId: number;
  /** Delta CON SIGNO en unidad base: positivo suma, negativo resta. */
  cantidad: number;
  /** Obligatorio: un ajuste sin explicacion es un agujero contable. */
  motivo: string;
  /** true = mercaderia descartada (se asienta como merma, no como ajuste). */
  esMerma?: boolean;
}

export interface ResultadoAjuste {
  articuloNombre: string;
  saldoPrevio: number;
  saldoNuevo: number;
  advertencias: string[];
}

export interface EntradaItemReceta {
  articuloInsumoId: number;
  cantidad: number;
  mermaEsperadaPct?: number;
}

export interface EntradaReceta {
  articuloProducidoId: number;
  /** Cuanto sale de una tanda, en la unidad base del producido. */
  rindeCantidad: number;
  notas?: string | null;
  items: EntradaItemReceta[];
}

export interface EntradaListaPrecio {
  nombre: string;
}

export interface EntradaPrecio {
  listaPrecioId: number;
  articuloId: number;
  /** Centavos por unidad base. */
  precio: number;
}

/* ========================= COMPROBANTE IMPRIMIBLE ======================== */

export interface LineaComprobante {
  codigo: string;
  nombre: string;
  cantidad: number;
  unidadAbreviatura: string;
  /** Cajas equivalentes, si el articulo se vende por caja cerrada. */
  cajas: number | null;
  precioUnitario: number;
  subtotal: number;
}

/**
 * Todo lo necesario para imprimir un remito o una factura, congelado en el
 * momento de la emision. Los datos del emisor y del receptor viajan aca y no se
 * releen de los maestros: si el cliente cambia de direccion, el comprobante
 * viejo tiene que seguir diciendo lo que decia.
 */
export interface ComprobanteImprimible {
  ventaId: number;
  fecha: string;
  estado: EstadoVenta;
  formaPago: FormaPago;
  notas: string | null;

  emisor: {
    razonSocial: string;
    cuit: string;
    direccion: string | null;
    condicionIva: string;
    iibb: string | null;
  };

  receptor: {
    nombre: string;
    cuit: string | null;
    direccion: string | null;
    condicionIva: string;
  };

  /** null = remito interno sin CAE. */
  fiscal: {
    letra: 'A' | 'B';
    tipo: string;
    puntoVenta: number;
    numero: number;
    etiqueta: string;
    cae: string;
    caeVencimiento: string | null;
    neto: number;
    iva: number;
    urlQr: string | null;
  } | null;

  lineas: LineaComprobante[];
  total: number;
}

/* ======================= ARRANQUE CON DATOS REALES ====================== */

/** Frase exacta que hay que escribir para vaciar la base. */
export const CONFIRMACION_EMPEZAR_DE_CERO = 'EMPEZAR DE CERO';

export interface DatosExistentes {
  tabla: string;
  filas: number;
}

export interface ResultadoInicializacion {
  /** Donde quedo la copia de seguridad previa al borrado. */
  rutaCopiaSeguridad: string;
  filasBorradas: number;
  detalle: DatosExistentes[];
}
