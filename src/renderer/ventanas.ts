/**
 * Registro de modulos.
 *
 * Cada entrada es una ventana que se puede abrir. La clave viaja en la ruta
 * `#/embedded/<clave>` y es la que usa el proceso main para no duplicar ventanas
 * del mismo modulo.
 *
 * Este archivo NO importa los componentes: solo describe los modulos. El mapeo
 * clave -> componente vive en `VentanaEmbebida.tsx`, para que el chrome de la
 * ventana principal no arrastre el codigo de todas las pantallas.
 */

export type ClaveModulo =
  | 'tablero'
  | 'stock-insumos'
  | 'stock-productos'
  | 'articulos'
  | 'recetas'
  | 'ordenes'
  | 'pedidos'
  | 'ventas'
  | 'compras'
  | 'caja'
  | 'cuentas-corrientes'
  | 'clientes'
  | 'vendedores'
  | 'proveedores'
  | 'listas-precio'
  | 'promociones'
  | 'caja-general'
  | 'estadisticas'
  | 'contabilidad'
  | 'usuarios'
  | 'trazabilidad'
  | 'cheques'
  | 'facturacion'
  | 'ayuda'
  | 'actualizacion-precios'
  | 'reposicion'
  | 'configuracion-lan'
  | 'respaldo'
  | 'configuracion-impresion'
  | 'medios-pago'
  | 'ajustes-insumos'
  | 'ajustes-productos'
  | 'movimientos-stock'
  /** Ventana de un documento concreto: recibe ?ventaId=N. No va en los menus. */
  | 'comprobante'
  | 'ticket-pedido'
  | 'sitio-web';

export interface DefinicionModulo {
  readonly clave: ClaveModulo;
  /** Titulo de la ventana del sistema operativo y de la barra de tareas. */
  readonly titulo: string;
  /** Etiqueta corta para menus y accesos directos. */
  readonly etiqueta: string;
  /** Nombre del icono, resuelto en componentes/Icono.tsx. */
  readonly icono: string;
  /** Una linea que explica que se ve. Se muestra en el encabezado de la ventana. */
  readonly descripcion: string;
}

export const MODULOS: Readonly<Record<ClaveModulo, DefinicionModulo>> = {
  tablero: {
    clave: 'tablero',
    titulo: 'Ver tablero',
    etiqueta: 'Tablero',
    icono: 'tablero',
    descripcion: 'Indicadores del dia: stock, pedidos y produccion.',
  },
  'stock-insumos': {
    clave: 'stock-insumos',
    titulo: 'Stock Insumos',
    etiqueta: 'Stock Insumos',
    icono: 'insumos',
    descripcion: 'Materias primas y pre-elaborados con su saldo calculado desde el ledger.',
  },
  'stock-productos': {
    clave: 'stock-productos',
    titulo: 'Stock Productos',
    etiqueta: 'Stock Productos',
    icono: 'productos',
    descripcion: 'Productos terminados para vender, con pestania del catalogo completo.',
  },
  /**
   * FUSIONADO en Stock Productos (pestania "Todos los articulos"). La entrada
   * queda solo para que las ventanas viejas con esta clave no mueran: abre lo
   * mismo que Stock Productos. No aparece en menus ni atajos.
   */
  articulos: {
    clave: 'articulos',
    titulo: 'Stock Productos',
    etiqueta: 'Stock Productos',
    icono: 'productos',
    descripcion: 'Fusionado en Stock Productos.',
  },
  recetas: {
    clave: 'recetas',
    titulo: 'Recetas y costos',
    etiqueta: 'Recetas y costos',
    icono: 'recetas',
    descripcion: 'Formulas de produccion con sus insumos, cantidades y merma esperada.',
  },
  ordenes: {
    clave: 'ordenes',
    titulo: 'Elaboracion',
    etiqueta: 'Elaboracion',
    icono: 'ordenes',
    descripcion: 'Ordenes planificadas, en proceso y finalizadas.',
  },
  pedidos: {
    clave: 'pedidos',
    titulo: 'Pedidos',
    etiqueta: 'Pedidos',
    icono: 'pedidos',
    descripcion: 'Pedidos de clientes, incluidos los que entran desde el celular.',
  },
  ventas: {
    clave: 'ventas',
    titulo: 'Ventas',
    etiqueta: 'Ventas',
    icono: 'ventas',
    descripcion: 'Comprobantes de venta emitidos.',
  },
  compras: {
    clave: 'compras',
    titulo: 'Compras',
    etiqueta: 'Compras',
    icono: 'compras',
    descripcion: 'Compras a proveedores y su estado de recepcion.',
  },
  caja: {
    clave: 'caja',
    titulo: 'Caja',
    etiqueta: 'Caja',
    icono: 'caja',
    descripcion: 'Aperturas y cierres de caja con el detalle de sus movimientos.',
  },
  'cuentas-corrientes': {
    clave: 'cuentas-corrientes',
    titulo: 'Cuentas corrientes',
    etiqueta: 'Ctas. Ctes.',
    icono: 'cuentas',
    descripcion: 'Saldos por cliente y por proveedor.',
  },
  clientes: {
    clave: 'clientes',
    titulo: 'Clientes',
    etiqueta: 'Clientes',
    icono: 'clientes',
    descripcion: 'Datos de contacto, lista de precios asignada y saldo en cuenta corriente.',
  },
  vendedores: {
    clave: 'vendedores',
    titulo: 'Vendedores',
    etiqueta: 'Vendedores',
    icono: 'clientes',
    descripcion: 'Revendedores que traen pedidos: datos y clientes asignados.',
  },
  proveedores: {
    clave: 'proveedores',
    titulo: 'Proveedores',
    etiqueta: 'Proveedores',
    icono: 'proveedores',
    descripcion: 'Datos de contacto y saldo en cuenta corriente.',
  },
  promociones: {
    clave: 'promociones',
    titulo: 'Promociones',
    etiqueta: 'Promos',
    icono: 'promociones',
    descripcion: 'Combos con precio propio y vigencia.',
  },
  'listas-precio': {
    clave: 'listas-precio',
    titulo: 'Listas de precio',
    etiqueta: 'Precios',
    icono: 'precios',
    descripcion: 'Listas vigentes con el precio de cada articulo.',
  },
  'caja-general': {
    clave: 'caja-general',
    titulo: 'Caja general',
    etiqueta: 'Caja Gral.',
    icono: 'caja-general',
    descripcion: 'Tesoreria consolidada: todas las cajas sumadas, con su diferencia acumulada.',
  },
  estadisticas: {
    clave: 'estadisticas',
    titulo: 'Estadisticas',
    etiqueta: 'Estadisticas',
    icono: 'estadisticas',
    descripcion: 'Ventas y compras por mes, articulos mas vendidos y valorizacion del inventario.',
  },
  contabilidad: {
    clave: 'contabilidad',
    titulo: 'Contabilidad',
    etiqueta: 'Contabilidad',
    icono: 'contabilidad',
    descripcion: 'Asientos, plan de cuentas y libro IVA. Modulo pendiente de construir.',
  },
  usuarios: {
    clave: 'usuarios',
    titulo: 'Usuarios',
    etiqueta: 'Usuarios',
    icono: 'usuarios',
    descripcion: 'Usuarios del sistema con su rol y estado.',
  },
  trazabilidad: {
    clave: 'trazabilidad',
    titulo: 'Trazabilidad',
    etiqueta: 'Trazabilidad',
    icono: 'trazabilidad',
    descripcion: 'Historia completa de una tanda a partir de su numero de lote.',
  },
  cheques: {
    clave: 'cheques',
    titulo: 'Cheques',
    etiqueta: 'Cheques',
    icono: 'cheques',
    descripcion: 'Cartera de cheques recibidos y emitidos, con control de vencimientos.',
  },
  'actualizacion-precios': {
    clave: 'actualizacion-precios',
    titulo: 'Actualizacion de precios',
    etiqueta: 'Actualizar precios',
    icono: 'precios',
    descripcion: 'Cambia los precios de muchos articulos a la vez, viendo antes como quedan.',
  },
  reposicion: {
    clave: 'reposicion',
    titulo: 'Ver faltantes',
    etiqueta: 'Ver faltantes',
    icono: 'compras',
    descripcion: 'Lo que falta para llegar al stock minimo o al ideal, agrupado por proveedor.',
  },
  ayuda: {
    clave: 'ayuda',
    titulo: 'Ayuda',
    etiqueta: 'Manual de uso',
    icono: 'ayuda',
    descripcion: 'Como se usa el sistema, version instalada y actualizaciones.',
  },
  'ticket-pedido': {
    clave: 'ticket-pedido',
    titulo: 'Ticket de elaboracion',
    etiqueta: 'Ticket',
    icono: 'ordenes',
    descripcion: 'Orden de trabajo del pedido en papel de 80 mm, para la sala de elaboracion.',
  },
  'sitio-web': {
    clave: 'sitio-web',
    titulo: 'Sitio web Anyulin',
    etiqueta: 'Sitio web',
    icono: 'productos',
    descripcion: 'La pagina publica de la marca, para mostrarla o compartirla con un cliente.',
  },
  comprobante: {
    clave: 'comprobante',
    titulo: 'Comprobante',
    etiqueta: 'Comprobante',
    icono: 'ventas',
    descripcion: 'Remito o factura de una venta, listo para imprimir.',
  },
  facturacion: {
    clave: 'facturacion',
    titulo: 'Mi Empresa',
    etiqueta: 'Mi Empresa',
    icono: 'facturacion',
    descripcion: 'Datos de la empresa y facturacion electronica ARCA (emisor y certificado).',
  },
  'configuracion-lan': {
    clave: 'configuracion-lan',
    titulo: 'Configuracion LAN',
    etiqueta: 'Configuracion LAN',
    icono: 'configuracion',
    descripcion: 'Direcciones para el celular y la tablet, y el PIN de acceso desde la red.',
  },
  respaldo: {
    clave: 'respaldo',
    titulo: 'Backup / Restaurar',
    etiqueta: 'Backup / Restaurar',
    icono: 'configuracion',
    descripcion: 'Copia de seguridad de la base de datos y restauracion desde un archivo.',
  },
  'ajustes-insumos': {
    clave: 'ajustes-insumos',
    titulo: 'Ajustes de Stock Insumos',
    etiqueta: 'Ajustes insumos',
    icono: 'insumos',
    descripcion: 'Toma de inventario de insumos: se cuenta lo fisico y se registran las diferencias.',
  },
  'ajustes-productos': {
    clave: 'ajustes-productos',
    titulo: 'Ajustes de Stock Productos',
    etiqueta: 'Ajustes productos',
    icono: 'productos',
    descripcion: 'Toma de inventario de productos terminados, en unidades.',
  },
  'movimientos-stock': {
    clave: 'movimientos-stock',
    titulo: 'Movimientos de stock',
    etiqueta: 'Movimientos',
    icono: 'trazabilidad',
    descripcion: 'Todos los ingresos, egresos y ajustes del stock, por grupo.',
  },
  'medios-pago': {
    clave: 'medios-pago',
    titulo: 'Medios de pago',
    etiqueta: 'Medios de pago',
    icono: 'caja',
    descripcion: 'Formas de pago del cobro: tipo, comision/interes, arqueo y orden.',
  },
  'configuracion-impresion': {
    clave: 'configuracion-impresion',
    titulo: 'Configuracion de impresion',
    etiqueta: 'Config. impresion',
    icono: 'configuracion',
    descripcion: 'Formato de los comprobantes impresos: papel, copias y encabezado.',
  },
};

export function esClaveModulo(valor: string): valor is ClaveModulo {
  return Object.prototype.hasOwnProperty.call(MODULOS, valor);
}

export function definicionDeModulo(clave: ClaveModulo): DefinicionModulo {
  return MODULOS[clave];
}

/* -------------------------------------------------------------------------- */
/* Menu superior                                                              */
/* -------------------------------------------------------------------------- */

export interface ItemMenu {
  readonly clave: ClaveModulo;
}

export interface MenuSuperior {
  readonly nombre: string;
  readonly items: readonly ItemMenu[];
}

export const MENUS: readonly MenuSuperior[] = [
  // Archivo copia la estructura de StockFlow: la empresa, las configuraciones
  // y el respaldo viven aca, no dispersos.
  {
    nombre: 'Archivo',
    items: [
      { clave: 'tablero' },
      { clave: 'facturacion' },
      { clave: 'configuracion-impresion' },
      { clave: 'configuracion-lan' },
      { clave: 'respaldo' },
      { clave: 'usuarios' },
    ],
  },
  {
    nombre: 'Stock',
    items: [
      { clave: 'stock-insumos' },
      { clave: 'stock-productos' },
      { clave: 'ajustes-insumos' },
      { clave: 'ajustes-productos' },
      { clave: 'movimientos-stock' },
    ],
  },
  {
    nombre: 'Produccion',
    items: [{ clave: 'recetas' }, { clave: 'ordenes' }, { clave: 'trazabilidad' }],
  },
  {
    nombre: 'Comercial',
    items: [
      { clave: 'pedidos' },
      { clave: 'ventas' },
      { clave: 'vendedores' },
      { clave: 'clientes' },
      { clave: 'listas-precio' },
      { clave: 'promociones' },
      { clave: 'actualizacion-precios' },
    ],
  },
  {
    nombre: 'Compras',
    items: [{ clave: 'compras' }, { clave: 'proveedores' }, { clave: 'reposicion' }],
  },
  {
    nombre: 'Tesoreria',
    items: [
      { clave: 'caja' },
      { clave: 'caja-general' },
      { clave: 'cheques' },
      { clave: 'cuentas-corrientes' },
      { clave: 'medios-pago' },
    ],
  },
  {
    nombre: 'Consultas',
    items: [{ clave: 'estadisticas' }, { clave: 'contabilidad' }],
  },
  // Ultimo por convencion: es donde todo el mundo busca la ayuda.
  { nombre: 'Ayuda', items: [{ clave: 'sitio-web' }, { clave: 'ayuda' }] },
];

/* -------------------------------------------------------------------------- */
/* Accesos directos                                                           */
/* -------------------------------------------------------------------------- */

export interface AccesoDirecto {
  readonly clave: ClaveModulo;
  /** Tecla de funcion que abre el modulo. */
  readonly tecla: string;
}

/**
 * Los modulos de uso diario, en el orden en que se trabaja la jornada. No estan
 * todos: los que se abren una vez por semana viven solo en el menu, para que la
 * barra no se convierta en una lista imposible de escanear.
 */
export const ACCESOS_DIRECTOS: readonly AccesoDirecto[] = [
  { clave: 'tablero', tecla: 'F1' },
  { clave: 'pedidos', tecla: 'F2' },
  { clave: 'stock-insumos', tecla: 'F3' },
  { clave: 'stock-productos', tecla: 'F4' },
  { clave: 'clientes', tecla: 'F5' },
  { clave: 'recetas', tecla: 'F6' },
  { clave: 'ordenes', tecla: 'F7' },
  { clave: 'ventas', tecla: 'F8' },
  { clave: 'compras', tecla: 'F9' },
  { clave: 'caja', tecla: 'F10' },
  { clave: 'caja-general', tecla: 'F11' },
  { clave: 'cuentas-corrientes', tecla: 'F12' },
];
