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
  | 'proveedores'
  | 'listas-precio'
  | 'caja-general'
  | 'estadisticas'
  | 'contabilidad'
  | 'usuarios';

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
    titulo: 'Tablero',
    etiqueta: 'Tablero',
    icono: 'tablero',
    descripcion: 'Indicadores del dia: stock, pedidos, produccion, ventas, caja y cuentas corrientes.',
  },
  'stock-insumos': {
    clave: 'stock-insumos',
    titulo: 'Stock de insumos',
    etiqueta: 'Insumos',
    icono: 'insumos',
    descripcion: 'Materias primas y pre-elaborados con su saldo calculado desde el ledger.',
  },
  'stock-productos': {
    clave: 'stock-productos',
    titulo: 'Stock de productos',
    etiqueta: 'Productos',
    icono: 'productos',
    descripcion: 'Productos terminados listos para vender.',
  },
  articulos: {
    clave: 'articulos',
    titulo: 'Maestro de articulos',
    etiqueta: 'Articulos',
    icono: 'articulos',
    descripcion: 'Todos los articulos con unidad, minimo, costo actual y stock.',
  },
  recetas: {
    clave: 'recetas',
    titulo: 'Recetas',
    etiqueta: 'Recetas',
    icono: 'recetas',
    descripcion: 'Formulas de produccion con sus insumos, cantidades y merma esperada.',
  },
  ordenes: {
    clave: 'ordenes',
    titulo: 'Ordenes de produccion',
    etiqueta: 'Ordenes',
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
  proveedores: {
    clave: 'proveedores',
    titulo: 'Proveedores',
    etiqueta: 'Proveedores',
    icono: 'proveedores',
    descripcion: 'Datos de contacto y saldo en cuenta corriente.',
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
  { nombre: 'Archivo', items: [{ clave: 'tablero' }, { clave: 'usuarios' }] },
  {
    nombre: 'Stock',
    items: [{ clave: 'stock-insumos' }, { clave: 'stock-productos' }, { clave: 'articulos' }],
  },
  { nombre: 'Produccion', items: [{ clave: 'recetas' }, { clave: 'ordenes' }] },
  { nombre: 'Comercial', items: [{ clave: 'pedidos' }, { clave: 'ventas' }, { clave: 'compras' }] },
  {
    nombre: 'Tesoreria',
    items: [{ clave: 'caja' }, { clave: 'caja-general' }, { clave: 'cuentas-corrientes' }],
  },
  {
    nombre: 'Maestros',
    items: [{ clave: 'clientes' }, { clave: 'proveedores' }, { clave: 'listas-precio' }],
  },
  { nombre: 'Consultas', items: [{ clave: 'estadisticas' }, { clave: 'contabilidad' }] },
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
  { clave: 'articulos', tecla: 'F5' },
  { clave: 'recetas', tecla: 'F6' },
  { clave: 'ordenes', tecla: 'F7' },
  { clave: 'ventas', tecla: 'F8' },
  { clave: 'compras', tecla: 'F9' },
  { clave: 'caja', tecla: 'F10' },
  { clave: 'caja-general', tecla: 'F11' },
  { clave: 'cuentas-corrientes', tecla: 'F12' },
];
