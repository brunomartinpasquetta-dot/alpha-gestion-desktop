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
export type EstadoOrdenProduccion = 'planificada' | 'en_proceso' | 'pausada' | 'finalizada' | 'cancelada';
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
  /** URL del monitor de elaboracion en la red local (tablet de fabrica). */
  urlElaboracion?: string | null;
  /** true si el acceso desde la red pide PIN. */
  pinConfigurado?: boolean;
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
  /** Hasta donde conviene reponer cuando se cae por debajo del minimo. */
  stockIdeal: number | null;
  codigoBarras: string | null;
  marca: string | null;
  familiaId: number | null;
  familiaNombre: string | null;
  proveedorHabitualId: number | null;
  proveedorHabitualNombre: string | null;
  /** Porcentaje: 0, 10.5, 21 o 27. La factura lo usa para desglosar. */
  alicuotaIva: number;
  porPeso: boolean;
  notas: string | null;
  /** Unidades por caja cerrada. null = no se comercializa por caja. */
  unidadesPorCaja: number | null;
  costoActual: number | null;
  activo: boolean;
  /** Lo que hay en el deposito, segun el ledger. */
  stock: number;
  /** De ese stock, lo que ya esta comprometido con un pedido. */
  reservado: number;
  /** Lo que se le puede prometer hoy a un cliente nuevo: stock - reservado. */
  disponible: number;
  /** Receta activa que lo produce. null = no se elabora, se compra. */
  recetaId: number | null;
  recetaRinde: number | null;
  recetaInsumos: number;
  bajoMinimo: boolean;
  /** Cuanto falta para llegar al ideal. 0 si no hace falta reponer. */
  aReponer: number;
}

export interface SaldoStock {
  articuloId: number;
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadAbreviatura: string;
  stock: number;
  stockMin: number | null;
  stockIdeal: number | null;
  marca: string | null;
  familiaNombre: string | null;
  proveedorHabitualNombre: string | null;
  /** Unidades por caja cerrada. null = no se comercializa por caja. */
  unidadesPorCaja: number | null;
  bajoMinimo: boolean;
  /** Cuanto falta para llegar al ideal. 0 si no hace falta reponer. */
  aReponer: number;
}

/** Fila del ledger GLOBAL de un grupo de stock (auditoria de movimientos). */
export interface MovimientoGrupoVista {
  id: number;
  fecha: string;
  articuloId: number;
  articuloCodigo: string;
  articuloNombre: string;
  unidadAbreviatura: string;
  tipo: TipoMovimientoStock;
  cantidad: number;
  documentoTipo: TipoDocumentoStock | null;
  documentoId: number | null;
  notas: string | null;
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
  /** 12 = el producto se cuenta por docenas, que es como se elabora y se embala. */
  unidadesPorCaja: number | null;
  factorEscala: number;
  estado: EstadoOrdenProduccion;
  /** Numero de lote de la tanda; null hasta que la orden se ejecuta. */
  numeroLote: string | null;
  pedidoId: number | null;
  /** Para quien se elabora. null = orden interna, para hacer stock. */
  clienteId: number | null;
  clienteNombre: string | null;
  /**
   * true si HOY no alcanzan los insumos para elaborarla (contando lo que ya
   * comprometieron las tandas en curso). No es un estado guardado: se calcula
   * al listar, asi cuando entra la compra de insumos la orden "despierta" sola.
   */
  esperaInsumos: boolean;
  /** Que falta y cuanto, listo para mostrar. null si no falta nada. */
  insumosFaltantes: string | null;
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
  /** De lo pedido, cuanto ya esta apartado para este cliente. */
  reservado: number;
  /** Del deposito, cuanto se puede apartar hoy sin sacarselo a otro pedido. */
  disponible: number;
}

export interface RenglonPedidoVista {
  id: number;
  /** null = renglon armado a medida (ver descripcion y componentes). */
  presentacionId: number | null;
  presentacionCodigo: string | null;
  presentacionNombre: string | null;
  descripcion: string | null;
  cantidad: number;
  /** Composicion del renglon a medida; vacio en renglones de catalogo. */
  componentes: { articuloId: number; articuloNombre: string; unidades: number }[];
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
  vendedorId: number | null;
  vendedorNombre: string | null;
  listaPrecioId: number | null;
  listaPrecioNombre: string | null;
  items: PedidoItemVista[];
  /** Renglones del talonario; vacio si el pedido se cargo por unidades. */
  renglones: RenglonPedidoVista[];
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
  /**
   * Neto de efectivo fisico (sin transferencias ni tarjetas). Es el unico
   * teorico que tiene sentido comparar contra los billetes del cajon, y el
   * mismo que usa el servidor al cerrar.
   */
  netoEfectivo: number;
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

export const TIPOS_DOCUMENTO = ['CUIT', 'DNI', 'CUIL', 'PASAPORTE', 'CF'] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export interface VendedorVista {
  id: number;
  nombre: string;
  telefono: string | null;
  cuit: string | null;
  /** Su ficha de cliente: la receptora cuando se le factura a el. */
  clienteId: number | null;
  notas: string | null;
  activo: boolean;
}

export interface ClienteVista {
  id: number;
  nombre: string;
  cuit: string | null;
  tipoDocumento: string | null;
  numeroDocumento: string | null;
  /** Codigo de la tabla de ARCA. Ver CONDICIONES_IVA_RECEPTOR. */
  condicionIva: number;
  telefono: string | null;
  celular: string | null;
  localidad: string | null;
  /** Centavos. 0 = sin limite definido. */
  limiteCredito: number;
  email: string | null;
  direccion: string | null;
  tipo: TipoCliente;
  listaPrecioId: number | null;
  listaPrecioNombre: string | null;
  /** Vendedor habitual: se propone al cargarle un pedido. */
  vendedorId: number | null;
  activo: boolean;
  saldoCc: number;
}

export interface ProveedorVista {
  id: number;
  codigo: string | null;
  nombre: string;
  cuit: string | null;
  iibb: string | null;
  telefono: string | null;
  celular: string | null;
  localidad: string | null;
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
  /** Si esta lista sale de otra + recargo: en ese caso no se le cargan precios. */
  baseListaId: number | null;
  recargoPct: number | null;
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
  // "En elaboracion" es como lo dice el que produce; "en proceso" es jerga de
  // sistema. La clave interna no cambia: solo lo que se lee en pantalla.
  en_proceso: 'En elaboracion',
  pausada: 'Pausada',
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
  /** Quien trajo el pedido (revendedor); null = venta directa. */
  vendedorId?: number | null;
  /** Lista con la que se liquida; null = la del cliente. */
  listaPrecioId?: number | null;
  origen: OrigenPedido;
  fechaEntregaEstimada?: string | null;
  cargadoPor?: string | null;
  notas?: string | null;
  /**
   * Renglones EN PRESENTACIONES (el talonario): "2 cajas B-N-FB". Si vienen,
   * los items en unidades se derivan solos explotando la composicion y NO hay
   * que mandarlos. Los items directos quedan para el celular y compatibilidad.
   *
   * Renglon A MEDIDA: sin presentacionId, con descripcion y composicion propia
   * ("docena con 4 FN + 4 FB + 4 N"). Se liquida por unidades x precio, se
   * explota al stock igual que una surtida, y la descripcion es lo que se
   * imprime en la orden de elaboracion.
   */
  renglones?: {
    presentacionId?: number | null;
    cantidad: number;
    descripcion?: string | null;
    componentes?: { articuloId: number; unidades: number }[] | null;
  }[] | null;
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
  // La UNICA accion manual sobre el estado es CANCELAR. Todo lo demas lo mueve
  // el sistema: en_produccion cuando arranca una tanda, listo cuando todo esta
  // apartado, entregado solo con la venta. Los botones Confirmar / A produccion
  // / Marcar listo eran restos del circuito manual y no hacian nada real.
  // ('confirmado' sobrevive como estado por los pedidos viejos que lo tienen.)
  pendiente: ['cancelado'],
  confirmado: ['cancelado'],
  en_produccion: ['cancelado'],
  listo: ['cancelado'],
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
  en_proceso: ['finalizada', 'pausada', 'cancelada'],
  // Reanudar vuelve a en_proceso sin lote nuevo; tambien se puede finalizar o
  // cancelar directo desde la pausa.
  pausada: ['en_proceso', 'finalizada', 'cancelada'],
  finalizada: [],
  cancelada: [],
};

export const ETIQUETA_TRANSICION_ORDEN: Readonly<Record<EstadoOrdenProduccion, string>> = {
  planificada: 'Planificar',
  en_proceso: 'Ejecutar',
  pausada: 'Pausar',
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
    // Un rechazado se puede volver a presentar, o cerrarse si el cliente lo
    // reemplaza por otro medio.
    rechazado: ['depositado', 'anulado'],
    /*
     * 'endosado' NO es terminal. El cheque que le pasamos a un proveedor sigue
     * siendo de un tercero y puede rebotar: cuando eso pasa el proveedor nos lo
     * devuelve y volvemos a deberle, y el cliente que lo libro nos vuelve a
     * deber a nosotros. Antes no habia ninguna transicion posible desde aca, asi
     * que esas dos cuentas corrientes quedaban mal para siempre.
     */
    endosado: ['rechazado', 'acreditado'],
    entregado: [],
    anulado: [],
  },
  emitido: {
    en_cartera: [],
    depositado: [],
    acreditado: [],
    rechazado: ['acreditado', 'anulado'],
    endosado: [],
    entregado: ['acreditado', 'rechazado', 'anulado'],
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
  /**
   * Regalo o bonificacion: la UNICA forma de vender a precio cero.
   * Sin esta marca un renglon en $0 se rechaza, porque el caso normal de un
   * precio cero no es un regalo sino un articulo sin precio cargado en la
   * lista del cliente — y eso terminaba en una factura de $0,00 con CAE.
   */
  bonificado?: boolean;
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
/**
 * Destino del resto cuando el cliente se lleva MENOS de lo que su pedido tenia
 * apartado: 'liberar' (no lo quiere mas: vuelve a stock disponible y el pedido
 * cierra) o 'mantener' (lo retira despues: sigue apartado y el pedido queda
 * listo con el saldo). Sin resto pendiente, el campo no juega.
 */
export type RestoPedido = 'liberar' | 'mantener';

/* ----------------------------- Presentaciones ------------------------------ */

/**
 * Forma comercial de venta: caja x36, docena, bolsa x6, surtida... El stock
 * cuenta unidades por variedad; la presentacion es la capa que el talonario
 * carga y la venta liquida.
 */
export interface PresentacionVista {
  id: number;
  codigo: string;
  nombre: string;
  /** true = precio de renglon propio por lista (cubanitos, envase). */
  precioPropio: boolean;
  activo: boolean;
  orden: number;
  componentes: {
    articuloId: number;
    articuloCodigo: string;
    articuloNombre: string;
    unidades: number;
  }[];
  unidadesTotales: number;
  /** true = es una promocion (presentacion con ventana de vigencia). */
  esPromocion: boolean;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}

/* -------------------------------- Promociones ------------------------------ */

/** Una promo con su precio por lista y si hoy esta liquidando o no. */
export interface PromocionVista extends PresentacionVista {
  /** Calculado contra la fecha de hoy: activa + dentro de la ventana. */
  vigenteHoy: boolean;
  /** Por que no esta vigente, para mostrarlo sin que el usuario adivine. */
  motivoNoVigente: string | null;
  precios: { listaPrecioId: number; listaNombre: string; precio: number }[];
  /** Suma del costo de los componentes: para ver si la promo deja margen. */
  costoComponentes: number;
}

export interface EntradaPromocion {
  nombre: string;
  codigo: string;
  vigenciaDesde?: string | null;
  vigenciaHasta?: string | null;
  activo?: boolean;
  componentes: { articuloId: number; unidades: number }[];
  /** Precio de la promo en cada lista, en centavos. */
  precios: { listaPrecioId: number; precio: number }[];
}

export type TipoMedioPago =
  | 'efectivo'
  | 'transferencia'
  | 'tarjeta_debito'
  | 'tarjeta_credito'
  | 'cheque'
  | 'otro';

export interface MedioPagoVista {
  id: number;
  nombre: string;
  tipo: TipoMedioPago;
  /** true = billetes al cajon: lo unico que entra al arqueo fisico del cierre. */
  esEfectivoFisico: boolean;
  /** Porcentaje que absorbe el comercio. El cliente paga el importe integro. */
  comisionPct: number;
  activo: boolean;
  orden: number;
}

/** Un pago de la venta. La suma de todos es EXACTAMENTE el total: sin vuelto. */
export interface PagoVentaEntrada {
  medioPagoId: number;
  /** Centavos. */
  importe: number;
  /** Numero de transferencia, ultimos 4 de la tarjeta... */
  referencia?: string | null;
  /** Obligatorio cuando el medio es de tipo cheque: da de alta la cartera. */
  cheque?: {
    numero: string;
    banco?: string | null;
    /** Fecha de cobro del diferido, AAAA-MM-DD. */
    fechaPago: string;
    formato?: 'fisico' | 'echeq';
  } | null;
}

export interface EntradaNuevaVenta {
  clienteId?: number | null;
  formaPago: FormaPago;
  /** Si la venta sale de un pedido listo, se lo marca entregado en el mismo acto. */
  pedidoId?: number | null;
  restoPedido?: RestoPedido | null;
  /**
   * Pagos de la venta de contado (mixtos). Si no viene, se asume todo en
   * Efectivo: compatibilidad con la venta rapida de mostrador.
   */
  pagos?: PagoVentaEntrada[] | null;
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
  | 'promociones:cambio'
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
  tipoDocumento?: string | null;
  numeroDocumento?: string | null;
  condicionIva?: number;
  telefono?: string | null;
  celular?: string | null;
  localidad?: string | null;
  limiteCredito?: number;
  email?: string | null;
  direccion?: string | null;
  tipo: TipoCliente;
  listaPrecioId?: number | null;
  notas?: string | null;
}

export interface EntradaProveedor {
  codigo?: string | null;
  nombre: string;
  cuit?: string | null;
  iibb?: string | null;
  telefono?: string | null;
  celular?: string | null;
  localidad?: string | null;
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

export const ALICUOTAS_IVA_UI = [
  { valor: 21, etiqueta: '21% (general)' },
  { valor: 10.5, etiqueta: '10,5% (reducida)' },
  { valor: 27, etiqueta: '27%' },
  { valor: 0, etiqueta: 'Exento / 0%' },
] as const;

export interface EntradaArticulo {
  codigo: string;
  nombre: string;
  tipo: TipoArticulo;
  unidadBaseId: number;
  stockMin?: number | null;
  stockIdeal?: number | null;
  codigoBarras?: string | null;
  marca?: string | null;
  familiaId?: number | null;
  proveedorHabitualId?: number | null;
  /** Porcentaje de IVA: 0, 10.5, 21 o 27. */
  alicuotaIva?: number;
  porPeso?: boolean;
  notas?: string | null;
  /** Solo tiene sentido en producto_terminado; en el resto se ignora. */
  unidadesPorCaja?: number | null;
  /** Centavos por unidad base. */
  costoActual?: number | null;
}

/** Precio vigente de un articulo en una lista. null = todavia no tiene. */
export interface PrecioDeArticulo {
  listaPrecioId: number;
  listaNombre: string;
  precio: number | null;
}

export interface FamiliaVista {
  id: number;
  nombre: string;
  padreId: number | null;
  cantidadArticulos: number;
}

export interface EntradaFamilia {
  nombre: string;
  padreId?: number | null;
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

export interface ResultadoMovimientoCaja {
  caja: CajaVista;
  /** Avisos que no bloquean, por ejemplo que la caja queda en negativo. */
  advertencias: string[];
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

/**
 * Datos del cheque cuando se cobra o se paga con uno. Sin esto el cheque
 * bajaba la deuda pero no entraba a la cartera: la plata desaparecia del
 * sistema hasta que alguien la cargaba a mano.
 */
export interface DetalleChequeCobroPago {
  numero: string;
  fechaPago: string;
  banco?: string | null;
  cuitEmisor?: string | null;
  formato?: FormatoCheque;
}

/**
 * Un tramo del cobro: cuanto entra por cada medio. Un cliente que paga mitad
 * efectivo y mitad transferencia es lo normal, y antes habia que cargar dos
 * cobros separados —con lo cual la imputacion a la factura quedaba partida.
 */
export interface TramoCobroPago {
  medio: MedioCobroPago;
  importe: number;
  /** Obligatorio cuando el medio del tramo es 'cheque'. */
  cheque?: DetalleChequeCobroPago | null;
}

/** Cobro a un cliente o pago a un proveedor. */
export interface EntradaCobroPago {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  monto: number;
  /** Medio unico. Se mantiene por compatibilidad: si viene `tramos`, manda `tramos`. */
  medio: MedioCobroPago;
  /** Obligatorio cuando `medio` es 'cheque'. */
  cheque?: DetalleChequeCobroPago | null;
  /** Composicion del pago. Si va, la suma tiene que dar `monto`. */
  tramos?: TramoCobroPago[] | null;
  /**
   * false = el cobro NO se imputa a comprobantes, queda como saldo a favor.
   * Por defecto se imputa FIFO (del comprobante mas viejo al mas nuevo).
   */
  imputarFifo?: boolean;
  notas?: string | null;
}

/**
 * Cambio de estado de un cheque. El endoso necesita saber A QUIEN se endosa:
 * entregarle un cheque a un proveedor le baja lo que le debemos, y sin el
 * destino ese asiento no se podia hacer.
 */
export interface EntradaCambioEstadoCheque {
  estado: EstadoCheque;
  destinoEntidadTipo?: TipoEntidadCc | null;
  destinoEntidadId?: number | null;
}

/** Un comprobante que todavia tiene saldo sin cancelar. */
export interface ComprobanteConSaldoVista {
  documentoTipo: string;
  documentoId: number;
  fecha: string;
  total: number;
  imputado: number;
  saldo: number;
  notas: string | null;
}

export interface MovimientoCcDetalleVista {
  id: number;
  fecha: string;
  tipoMovimiento: 'debe' | 'haber';
  monto: number;
  documentoTipo: string;
  documentoId: number | null;
  notas: string | null;
  saldoAcumulado: number;
}

/** Ficha completa de una cuenta corriente. */
export interface DetalleCuentaCorrienteVista {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  entidadNombre: string;
  saldo: number;
  comprobantes: ComprobanteConSaldoVista[];
  saldoAFavor: number;
  movimientos: MovimientoCcDetalleVista[];
}

/** Como se repartiria un cobro, para mostrarlo antes de confirmar. */
export interface SimulacionImputacion {
  imputaciones: {
    documentoTipo: string;
    documentoId: number;
    importe: number;
    fecha: string;
    total: number;
  }[];
  sobrante: number;
}

export interface ResultadoCobroPago {
  entidadNombre: string;
  monto: number;
  advertencias: string[];
  /** Que comprobantes cerro o descargo este cobro, en orden FIFO. */
  imputaciones?: { documentoTipo: string; documentoId: number; importe: number }[];
  /** Lo que sobro despues de cancelar todo: queda a favor. */
  sobrante?: number;
}

/* ========================= PRODUCCION (escritura) ======================== */

export interface EntradaNuevaOrden {
  recetaId: number;
  /**
   * CUANTO se va a producir, en la unidad base del producto (240 alfajores,
   * 18000 g de dulce de leche). Antes se pedia un "factor de escala" —media
   * tanda, doble tanda— que es una cuenta del sistema, no algo que el que
   * produce tenga en la cabeza: el piensa en docenas o en kilos. El factor se
   * calcula solo, dividiendo esta cantidad por el rinde de la receta.
   */
  cantidad: number;
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

/* ================== ACTUALIZACION MASIVA Y REPOSICION =================== */

export const MODOS_ACTUALIZACION = ['porcentaje', 'monto_fijo', 'valor_exacto'] as const;
export type ModoActualizacion = (typeof MODOS_ACTUALIZACION)[number];

export const REDONDEOS_PRECIO = [
  { valor: 'ninguno', etiqueta: 'Sin redondeo' },
  { valor: 'multiplo_10', etiqueta: 'Multiplo de $10' },
  { valor: 'multiplo_50', etiqueta: 'Multiplo de $50' },
  { valor: 'multiplo_100', etiqueta: 'Multiplo de $100' },
  { valor: 'terminado_99', etiqueta: 'Terminado en ,99' },
] as const;

export interface EntradaActualizacionPrecios {
  articuloIds: readonly number[];
  listaPrecioId: number;
  /** true = actualiza el COSTO en vez del precio de la lista. */
  sobreCosto?: boolean;
  modo: ModoActualizacion;
  /** Porcentaje, monto en centavos o precio exacto en centavos, segun el modo. */
  valor: number;
  redondeo?: string;
}

export interface VistaPreviaPrecio {
  articuloId: number;
  codigo: string;
  nombre: string;
  precioActual: number;
  precioNuevo: number;
  /** null cuando no habia precio previo: no hay variacion que calcular. */
  variacionPct: number | null;
}

/** Un articulo que hay que reponer, con su proveedor habitual. */
export interface LineaReposicion {
  articuloId: number;
  codigo: string;
  nombre: string;
  /** Un producto terminado se repone produciendolo, no comprandolo. */
  comoSeRepone: 'comprar' | 'producir';
  unidadAbreviatura: string;
  stock: number;
  objetivo: number;
  aPedir: number;
  costoUnitario: number | null;
  costoEstimado: number | null;
  proveedorId: number | null;
  proveedorNombre: string | null;
}

/** Una actualizacion masiva aplicada, para poder deshacerla. */
export interface LotePrecio {
  id: number;
  fecha: string;
  descripcion: string;
  cantidadArticulos: number;
  revertido: boolean;
}
