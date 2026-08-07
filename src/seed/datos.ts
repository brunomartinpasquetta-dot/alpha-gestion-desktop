/**
 * Definiciones de los datos de prueba del seed.
 *
 * Este modulo es PURO: solo declara constantes `readonly` y calcula costos a
 * partir de precios legibles. No abre la base, no escribe nada y no tiene
 * efectos secundarios al importarse. Toda la logica de insercion vive en
 * `sembrar.ts`.
 *
 * Convenciones que se respetan en todo el archivo:
 *  - DINERO en centavos enteros (INTEGER), nunca en pesos con decimales.
 *  - COSTOS de articulos en centavos POR UNIDAD BASE (por gramo, por ml, por unidad).
 *  - CANTIDADES de items de receta SIEMPRE en la unidad base del insumo.
 *  - Las entidades se identifican por su CLAVE NATURAL (codigo, abreviatura,
 *    nombre, username), nunca por id: los ids se resuelven en runtime.
 */

import { aCentavos } from '../server/utiles/numeros';
import type { RolUsuario, TipoArticulo, TipoCliente, TipoMagnitud, TipoMovimientoStock } from '../server/db/schema';

/* ------------------------------------------------------------------------- */
/* Helpers de costeo                                                         */
/* ------------------------------------------------------------------------- */

/**
 * Convierte un precio en pesos por kilo (o por litro) a centavos por unidad
 * base, sabiendo que 1 kg = 1000 g y 1 l = 1000 ml.
 *
 * Ejemplo: $1.150 el kilo -> aCentavos(1150) = 115000 centavos el kilo
 *          -> 115000 / 1000 = 115 centavos por gramo.
 *
 * El `Math.round` garantiza que el valor persistido sea SIEMPRE un entero.
 */
function centavosPorUnidadBaseDesdeMil(pesosPorKiloOLitro: number): number {
  return Math.round(aCentavos(pesosPorKiloOLitro) / 1000);
}

/** Convierte un precio en pesos por unidad a centavos por unidad. */
function centavosPorUnidad(pesosPorUnidad: number): number {
  return aCentavos(pesosPorUnidad);
}

/* ------------------------------------------------------------------------- */
/* Unidades de medida                                                        */
/* ------------------------------------------------------------------------- */

export interface DefinicionUnidad {
  readonly nombre: string;
  /** Clave natural: hay un indice unico sobre `abreviatura`. */
  readonly abreviatura: string;
  readonly tipoMagnitud: TipoMagnitud;
}

export const UNIDADES: readonly DefinicionUnidad[] = [
  { nombre: 'Gramo', abreviatura: 'g', tipoMagnitud: 'peso' },
  { nombre: 'Kilogramo', abreviatura: 'kg', tipoMagnitud: 'peso' },
  { nombre: 'Mililitro', abreviatura: 'ml', tipoMagnitud: 'volumen' },
  { nombre: 'Litro', abreviatura: 'l', tipoMagnitud: 'volumen' },
  { nombre: 'Unidad', abreviatura: 'u', tipoMagnitud: 'unidad' },
];

/* ------------------------------------------------------------------------- */
/* Articulos                                                                 */
/* ------------------------------------------------------------------------- */

/** Codigos estables: son la clave natural con la que el seed decide si insertar. */
export const CODIGO_HARINA = 'MP-HAR-0000';
export const CODIGO_LECHE = 'MP-LEC-001';
export const CODIGO_TAPA = 'MP-TAP-001';
export const CODIGO_DULCE_DE_LECHE = 'PE-DDL-001';
export const CODIGO_ALFAJOR_MAICENA = 'PT-ALF-MAI';

export interface DefinicionArticulo {
  /** Clave natural: hay un indice unico sobre `codigo`. */
  readonly codigo: string;
  readonly nombre: string;
  readonly tipo: TipoArticulo;
  /** Abreviatura de la unidad base; el id se resuelve en runtime. */
  readonly abreviaturaUnidadBase: string;
  /** Minimo de stock expresado en la unidad base. */
  readonly stockMin: number;
  /** Unidades por caja cerrada; los clientes piden por caja. Solo terminados. */
  readonly unidadesPorCaja?: number;
  /** Centavos por unidad base (por gramo, por ml o por unidad segun corresponda). */
  readonly costoActual: number;
}

export const ARTICULOS: readonly DefinicionArticulo[] = [
  {
    codigo: CODIGO_HARINA,
    nombre: 'Harina 0000',
    tipo: 'materia_prima',
    abreviaturaUnidadBase: 'g',
    stockMin: 5000, // 5 kg
    // $1.150 el kilo -> 115 centavos el gramo.
    costoActual: centavosPorUnidadBaseDesdeMil(1150),
  },
  {
    codigo: CODIGO_LECHE,
    nombre: 'Leche',
    tipo: 'materia_prima',
    abreviaturaUnidadBase: 'ml',
    stockMin: 10000, // 10 litros
    // $1.750 el litro -> 175 centavos el mililitro.
    costoActual: centavosPorUnidadBaseDesdeMil(1750),
  },
  {
    codigo: CODIGO_TAPA,
    nombre: 'Tapa de alfajor',
    tipo: 'materia_prima',
    abreviaturaUnidadBase: 'u',
    stockMin: 500,
    // Es un insumo COMPRADO, no se produce: no tiene receta propia.
    // $85 la tapa -> 8500 centavos la unidad.
    costoActual: centavosPorUnidad(85),
  },
  {
    codigo: CODIGO_DULCE_DE_LECHE,
    nombre: 'Dulce de leche',
    tipo: 'pre_elaborado',
    abreviaturaUnidadBase: 'g',
    stockMin: 3000, // 3 kg
    // $4.900 el kilo -> 490 centavos el gramo.
    costoActual: centavosPorUnidadBaseDesdeMil(4900),
  },
  {
    codigo: CODIGO_ALFAJOR_MAICENA,
    nombre: 'Alfajor de maicena',
    tipo: 'producto_terminado',
    abreviaturaUnidadBase: 'u',
    stockMin: 100,
    unidadesPorCaja: 12,
    // $950 el alfajor -> 95000 centavos la unidad.
    costoActual: centavosPorUnidad(950),
  },
];

/* ------------------------------------------------------------------------- */
/* Recetas (BOM encadenado)                                                  */
/* ------------------------------------------------------------------------- */

export interface DefinicionRecetaItem {
  /** Codigo del articulo insumo. */
  readonly codigoInsumo: string;
  /**
   * Cantidad SIEMPRE expresada en la UNIDAD BASE DEL INSUMO, no en la unidad de
   * rinde de la receta. Por eso la leche va en ml y el dulce de leche en g.
   */
  readonly cantidad: number;
  readonly mermaEsperadaPct: number;
}

export interface DefinicionReceta {
  /** Clave natural: el articulo que produce (un pre_elaborado o un producto_terminado). */
  readonly codigoArticuloProducido: string;
  readonly rindeCantidad: number;
  readonly abreviaturaRindeUnidad: string;
  readonly notas: string;
  readonly items: readonly DefinicionRecetaItem[];
}

/**
 * Las dos recetas estan ENCADENADAS a proposito: el dulce de leche es insumo de
 * la receta del alfajor, y a su vez tiene su propia receta a partir de leche.
 * Eso es lo que demuestra que el BOM soporta varios niveles.
 */
export const RECETAS: readonly DefinicionReceta[] = [
  {
    codigoArticuloProducido: CODIGO_DULCE_DE_LECHE,
    rindeCantidad: 1000, // 1 kg de dulce de leche
    abreviaturaRindeUnidad: 'g',
    notas: 'Reduccion de leche azucarada a fuego lento hasta punto reposteria.',
    items: [
      // 2500 ml de leche (unidad base del insumo) por cada 1000 g de dulce.
      { codigoInsumo: CODIGO_LECHE, cantidad: 2500, mermaEsperadaPct: 2 },
    ],
  },
  {
    codigoArticuloProducido: CODIGO_ALFAJOR_MAICENA,
    rindeCantidad: 12, // 12 alfajores por tanda
    abreviaturaRindeUnidad: 'u',
    notas: 'Armado de alfajores: dos tapas por unidad, relleno de dulce de leche.',
    items: [
      // 240 g de dulce de leche (unidad base: gramo) = 20 g por alfajor.
      { codigoInsumo: CODIGO_DULCE_DE_LECHE, cantidad: 240, mermaEsperadaPct: 3 },
      // 24 tapas (unidad base: unidad) = dos tapas por alfajor.
      { codigoInsumo: CODIGO_TAPA, cantidad: 24, mermaEsperadaPct: 1 },
    ],
  },
];

/* ------------------------------------------------------------------------- */
/* Terceros, listas y precios                                                */
/* ------------------------------------------------------------------------- */

export interface DefinicionProveedor {
  /** Clave natural del seed. */
  readonly nombre: string;
  readonly cuit: string;
  readonly telefono: string;
  readonly email: string;
  readonly direccion: string;
}

export const PROVEEDOR: DefinicionProveedor = {
  nombre: 'Distribuidora La Espiga',
  cuit: '30-71234567-9',
  telefono: '+54 351 555-0142',
  email: 'ventas@laespiga.test',
  direccion: 'Av. Colon 1234, Cordoba',
};

export interface DefinicionListaPrecio {
  /** Clave natural: hay un indice unico sobre `nombre`. */
  readonly nombre: string;
  readonly activa: boolean;
}

export const LISTA_PRECIO_GENERAL: DefinicionListaPrecio = {
  nombre: 'General',
  activa: true,
};

/**
 * Las tres listas con las que arranca cualquier instalacion. La fabrica no le
 * vende al mismo precio al kiosco de la esquina, al mayorista y al distribuidor
 * que le compra por pallet: con una sola lista, cada venta a otro precio hay que
 * corregirla a mano y se pierde la referencia.
 *
 * "General" es la primera a proposito: es la que se usa cuando el cliente no
 * tiene ninguna asignada.
 */
export const LISTAS_PRECIO_BASE: readonly DefinicionListaPrecio[] = [
  LISTA_PRECIO_GENERAL,
  { nombre: 'Mayorista', activa: true },
  { nombre: 'Distribuidor', activa: true },
];

export interface DefinicionCliente {
  /** Clave natural del seed. */
  readonly nombre: string;
  readonly cuit: string;
  readonly telefono: string;
  readonly email: string;
  readonly tipo: TipoCliente;
  /** Lista de precios asociada, referenciada por nombre. */
  readonly nombreListaPrecio: string;
}

export const CLIENTE_MAYORISTA: DefinicionCliente = {
  nombre: 'Kiosco El Trebol',
  cuit: '20-30111222-3',
  telefono: '+54 351 555-0188',
  email: 'compras@eltrebol.test',
  tipo: 'mayorista',
  nombreListaPrecio: LISTA_PRECIO_GENERAL.nombre,
};

export interface DefinicionPrecio {
  readonly codigoArticulo: string;
  readonly nombreListaPrecio: string;
  /** Centavos por unidad base del articulo. */
  readonly precio: number;
}

export const PRECIOS: readonly DefinicionPrecio[] = [
  {
    codigoArticulo: CODIGO_ALFAJOR_MAICENA,
    nombreListaPrecio: LISTA_PRECIO_GENERAL.nombre,
    // $1.600 el alfajor -> 160000 centavos la unidad.
    precio: centavosPorUnidad(1600),
  },
];

/* ------------------------------------------------------------------------- */
/* Usuario administrador                                                     */
/* ------------------------------------------------------------------------- */

/**
 * !!! CREDENCIAL DE PRUEBA !!!
 *
 * Esta contrasena esta en el codigo fuente a proposito, para poder entrar a una
 * instalacion recien sembrada. HAY QUE CAMBIARLA ANTES DE USAR EL SISTEMA EN
 * PRODUCCION. El seed la hashea con bcrypt (cost 10) antes de persistirla:
 * nunca se guarda en texto plano.
 */
export const CONTRASENA_ADMIN_PRUEBA = 'alfajores123';

/** Costo de bcrypt para el hash del usuario sembrado. */
export const COSTO_BCRYPT = 10;

export interface DefinicionUsuario {
  /** Clave natural: hay un indice unico sobre `username`. */
  readonly username: string;
  readonly rol: RolUsuario;
  readonly activo: boolean;
  /** Contrasena en texto plano SOLO para generar el hash; jamas se persiste asi. */
  readonly contrasenaPlana: string;
}

export const USUARIO_ADMIN: DefinicionUsuario = {
  username: 'admin',
  rol: 'admin',
  activo: true,
  contrasenaPlana: CONTRASENA_ADMIN_PRUEBA,
};

/* ------------------------------------------------------------------------- */
/* Movimientos de stock OPCIONALES                                           */
/* ------------------------------------------------------------------------- */

/**
 * Variable de entorno que habilita el sembrado de movimientos de stock.
 * Por defecto el ledger arranca VACIO: el stock se calcula sumando movimientos,
 * no se inventa. Con `ALFAJORES_SEED_MOVIMIENTOS=1` se cargan unos pocos
 * movimientos de ejemplo para ver stock distinto de cero en pantalla.
 */
export const VARIABLE_ENTORNO_MOVIMIENTOS = 'ALFAJORES_SEED_MOVIMIENTOS';

export interface DefinicionMovimiento {
  readonly codigoArticulo: string;
  readonly tipo: TipoMovimientoStock;
  /** Con signo y en la unidad base del articulo: (+) ingreso, (-) egreso. */
  readonly cantidad: number;
  /** Centavos por unidad base. */
  readonly costoUnitario: number;
  readonly notas: string;
}

/**
 * Movimientos de ejemplo. No llevan `documentoTipo` ni `documentoId` porque no
 * existe una compra ni una orden de produccion real detras: son datos de demo y
 * apuntar a un documento inexistente seria una referencia colgada.
 */
export const MOVIMIENTOS_EJEMPLO: readonly DefinicionMovimiento[] = [
  {
    codigoArticulo: CODIGO_HARINA,
    tipo: 'compra',
    cantidad: 25000, // una bolsa de 25 kg expresada en gramos
    costoUnitario: centavosPorUnidadBaseDesdeMil(1150),
    notas: 'Compra de ejemplo del seed: 1 bolsa de 25 kg.',
  },
  {
    codigoArticulo: CODIGO_LECHE,
    tipo: 'compra',
    cantidad: 20000, // 20 litros expresados en mililitros
    costoUnitario: centavosPorUnidadBaseDesdeMil(1750),
    notas: 'Compra de ejemplo del seed: 20 litros.',
  },
  {
    codigoArticulo: CODIGO_TAPA,
    tipo: 'compra',
    cantidad: 2400,
    costoUnitario: centavosPorUnidad(85),
    notas: 'Compra de ejemplo del seed: 2400 tapas.',
  },
  {
    codigoArticulo: CODIGO_DULCE_DE_LECHE,
    tipo: 'ingreso_produccion',
    cantidad: 1000, // el rinde de una tanda de la receta
    costoUnitario: centavosPorUnidadBaseDesdeMil(4900),
    notas: 'Ingreso de produccion de ejemplo del seed: una tanda de 1 kg.',
  },
];
