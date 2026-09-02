/**
 * Mapa de navegacion del ERP.
 *
 * El ruteo es propio y minimo (sin librerias): el modulo activo es un valor de
 * `ClaveModulo` que vive en el estado de `App` y se refleja en `location.hash`,
 * asi el refresh y el HMR no pierden la pantalla en la que estaba el usuario.
 */

export type ClaveModulo =
  | 'inicio'
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
  | 'listas-precio';

export interface DefinicionModulo {
  readonly clave: ClaveModulo;
  /** Texto corto para la navegacion lateral. */
  readonly etiqueta: string;
  /** Titulo de la pantalla. */
  readonly titulo: string;
  /** Una linea que explica que se ve en la pantalla. */
  readonly descripcion: string;
}

export interface GrupoNavegacion {
  readonly titulo: string;
  readonly modulos: readonly DefinicionModulo[];
}

export const GRUPOS_NAVEGACION: readonly GrupoNavegacion[] = [
  {
    titulo: 'General',
    modulos: [
      {
        clave: 'inicio',
        etiqueta: 'Inicio',
        titulo: 'Tablero',
        descripcion: 'Indicadores del dia: stock, pedidos y produccion.',
      },
    ],
  },
  {
    titulo: 'Stock',
    modulos: [
      {
        clave: 'stock-insumos',
        etiqueta: 'Stock Insumos',
        titulo: 'Stock Insumos',
        descripcion: 'Materias primas y pre-elaborados con su saldo calculado desde el ledger.',
      },
      // "Articulos" se fusiono aca: era la union de Insumos y Productos, y dos
      // modulos con las mismas funciones sobre los mismos datos confunden. La
      // vista combinada vive como pestania dentro de Stock Productos.
      {
        clave: 'stock-productos',
        etiqueta: 'Stock Productos',
        titulo: 'Stock Productos',
        descripcion: 'Productos terminados listos para vender, con la pestania del catalogo completo.',
      },
    ],
  },
  {
    titulo: 'Produccion',
    modulos: [
      {
        clave: 'recetas',
        etiqueta: 'Recetas y costos',
        titulo: 'Recetas y costos',
        descripcion: 'Formulas de produccion con sus insumos, cantidades y merma esperada.',
      },
      {
        clave: 'ordenes',
        etiqueta: 'Elaboracion',
        titulo: 'Elaboracion',
        descripcion: 'Ordenes planificadas, en proceso y finalizadas.',
      },
    ],
  },
  {
    titulo: 'Comercial',
    modulos: [
      {
        clave: 'pedidos',
        etiqueta: 'Pedidos',
        titulo: 'Pedidos',
        descripcion: 'Pedidos de clientes, incluidos los que entran desde el celular.',
      },
      {
        clave: 'ventas',
        etiqueta: 'Ventas',
        titulo: 'Ventas',
        descripcion: 'Comprobantes de venta emitidos.',
      },
      {
        clave: 'vendedores',
        etiqueta: 'Vendedores',
        titulo: 'Vendedores',
        descripcion: 'Revendedores que traen pedidos: datos y clientes asignados.',
      },
      {
        clave: 'compras',
        etiqueta: 'Compras',
        titulo: 'Compras',
        descripcion: 'Compras a proveedores y su estado de recepcion.',
      },
    ],
  },
  {
    titulo: 'Finanzas',
    modulos: [
      {
        clave: 'caja',
        etiqueta: 'Caja',
        titulo: 'Caja',
        descripcion: 'Aperturas y cierres de caja con el detalle de sus movimientos.',
      },
      {
        clave: 'cuentas-corrientes',
        etiqueta: 'Cuentas corrientes',
        titulo: 'Cuentas corrientes',
        descripcion: 'Saldos por cliente y por proveedor.',
      },
    ],
  },
  {
    titulo: 'Maestros',
    modulos: [
      {
        clave: 'clientes',
        etiqueta: 'Clientes',
        titulo: 'Clientes',
        descripcion: 'Datos de contacto, lista de precios asignada y saldo en cuenta corriente.',
      },

      {
        clave: 'proveedores',
        etiqueta: 'Proveedores',
        titulo: 'Proveedores',
        descripcion: 'Datos de contacto y saldo en cuenta corriente.',
      },
      {
        clave: 'listas-precio',
        etiqueta: 'Precios',
        titulo: 'Listas de precio',
        descripcion: 'Listas vigentes con el precio de cada articulo.',
      },
    ],
  },
];

/** Modulo que se abre cuando no hay hash o el hash es desconocido. */
export const MODULO_INICIAL: ClaveModulo = 'inicio';

const MODULOS_POR_CLAVE: ReadonlyMap<ClaveModulo, DefinicionModulo> = new Map(
  GRUPOS_NAVEGACION.flatMap((grupo) => grupo.modulos).map((modulo) => [modulo.clave, modulo]),
);

export function esClaveModulo(valor: string): valor is ClaveModulo {
  return MODULOS_POR_CLAVE.has(valor as ClaveModulo);
}

/** Definicion completa del modulo. Nunca devuelve undefined: la clave es del tipo union. */
export function definicionDeModulo(clave: ClaveModulo): DefinicionModulo {
  const definicion = MODULOS_POR_CLAVE.get(clave);
  if (definicion === undefined) {
    // Inalcanzable mientras el mapa se construya desde GRUPOS_NAVEGACION.
    throw new Error(`Modulo sin definicion: ${clave}`);
  }
  return definicion;
}

/** Hash canonico de un modulo, por ejemplo "#/pedidos". */
export function hashDeModulo(clave: ClaveModulo): string {
  return `#/${clave}`;
}

/** Lee el modulo desde un hash cualquiera, tolerando "#x", "#/x" y basura. */
export function moduloDesdeHash(hash: string): ClaveModulo {
  const limpio = hash.replace(/^#\/?/, '').trim();
  return esClaveModulo(limpio) ? limpio : MODULO_INICIAL;
}
