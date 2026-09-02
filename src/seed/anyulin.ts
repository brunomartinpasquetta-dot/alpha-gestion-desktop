/**
 * Catalogo REAL de Anyulin, extraido de las planillas del cliente
 * (TALONARIO VENTA ALFAJORES.xlsx, 11/8/2026). Nada de esto es inventado:
 * las composiciones salen de las formulas de liquidacion del talonario y los
 * precios de la matriz LISTA DE PRECIOS Y CLIENTES.
 *
 * Reglas del negocio que este catalogo fija:
 *  - El stock cuenta UNIDADES por variedad; las presentaciones son la capa
 *    comercial (caja 36, docena 12, bolsa 6, unidad, surtidas).
 *  - La liquidacion es unidades x precio unitario de la lista del cliente,
 *    SALVO los renglones con precio propio (cubanitos, almendras, envase).
 *  - Las listas +% son derivadas: cambia la base, cambia la derivada sola.
 *
 * Idempotente: se busca por codigo/nombre antes de insertar.
 */

import { and, eq, inArray } from 'drizzle-orm';

import type { obtenerDb } from '../server/db/conexion';
import {
  articulos,
  clientes,
  cuentasCorrientes,
  reservasStock,
  listasPrecio,
  pedidos,
  precios,
  preciosPresentacion,
  presentacionComponentes,
  presentaciones,
  unidadesMedida,
  vendedores,
  ventas,
} from '../server/db/schema';

type BaseDatos = ReturnType<typeof obtenerDb>;

/* ------------------------------- Catalogo ---------------------------------- */

/** Variedades de alfajor: el stock vive en unidades de cada una. */
const VARIEDADES = [
  { codigo: 'ALF-B', nombre: 'ALF DdL-BLANCO' },
  { codigo: 'ALF-N', nombre: 'ALF DdL-NEGRO' },
  { codigo: 'ALF-FB', nombre: 'ALF FRUTILLA-BLANCO' },
  { codigo: 'ALF-FN', nombre: 'ALF FRUTILLA-NEGRO' },
] as const;

/**
 * Resto del catalogo. Los cubanitos se stockean POR SABOR (la caja x10/x16 es
 * una presentacion con precio propio); las almendras por variedad de chocolate
 * (la bolsa de 200 g es su presentacion, tambien con precio propio).
 */
const RENGLONES_PROPIOS = [
  { codigo: 'CUB-DDL', nombre: 'CUBANITO DULCE DE LECHE' },
  { codigo: 'CUB-FRU', nombre: 'CUBANITO FRUTILLA' },
  { codigo: 'CUB-MANI', nombre: 'CUBANITO MANI' },
  { codigo: 'CUB-AVE', nombre: 'CUBANITO AVELLANA' },
  { codigo: 'CUB-BAN', nombre: 'CUBANITO BANANITA' },
  { codigo: 'ALM-B', nombre: 'ALMENDRAS CHOC BLANCO' },
  { codigo: 'ALM-CL', nombre: 'ALMENDRAS CHOC C/LECHE' },
  { codigo: 'ALM-SA', nombre: 'ALMENDRAS CHOC SEMI AMARGO' },
  { codigo: 'ENV-ANY', nombre: 'CAJA ANYULIN' },
] as const;

/**
 * Matriz de precios en PESOS por unidad/renglon, tal cual la planilla.
 * Las listas +% NO figuran: son derivadas (+20% sobre su base).
 */
const MATRIZ_PRECIOS: Record<string, Record<string, number>> = {
  'ALF DdL-BLANCO': { 'LISTA 1': 660, 'LISTA 2': 800, 'LISTA 3': 930, 'LISTA 4': 1500, OMANICI: 850, EMPLEADOS: 1200, ROYAL: 680 },
  'ALF DdL-NEGRO': { 'LISTA 1': 660, 'LISTA 2': 800, 'LISTA 3': 930, 'LISTA 4': 1500, OMANICI: 850, EMPLEADOS: 1200, ROYAL: 680 },
  'ALF FRUTILLA-BLANCO': { 'LISTA 1': 660, 'LISTA 2': 800, 'LISTA 3': 930, 'LISTA 4': 1500, OMANICI: 850, EMPLEADOS: 1200, ROYAL: 680 },
  'ALF FRUTILLA-NEGRO': { 'LISTA 1': 660, 'LISTA 2': 800, 'LISTA 3': 930, 'LISTA 4': 1500, OMANICI: 850, EMPLEADOS: 1200, ROYAL: 680 },
  'CAJA ANYULIN': { 'LISTA 1': 800, 'LISTA 2': 800, 'LISTA 3': 800, 'LISTA 4': 1000, OMANICI: 800, EMPLEADOS: 1000 },
  'CUBANITOS X 10 UNID': { 'LISTA 1': 9100, 'LISTA 2': 9100, 'LISTA 3': 10000, 'LISTA 4': 12100, OMANICI: 10000, EMPLEADOS: 1100 },
  'CUBANITOS X 16 UNID': { 'LISTA 1': 9100, 'LISTA 2': 9100, 'LISTA 3': 10000, 'LISTA 4': 12100, OMANICI: 10000, EMPLEADOS: 1100 },
  'ALMENDRAS CHOC BLANCO': { 'LISTA 1': 4500, 'LISTA 2': 5000, 'LISTA 3': 5700, 'LISTA 4': 7100, OMANICI: 5700, EMPLEADOS: 6500 },
  'ALMENDRAS CHOC C/LECHE': { 'LISTA 1': 4500, 'LISTA 2': 5000, 'LISTA 3': 5700, 'LISTA 4': 7100, OMANICI: 5700, EMPLEADOS: 6500 },
  'ALMENDRAS CHOC SEMI AMARGO': { 'LISTA 1': 4500, 'LISTA 2': 5000, 'LISTA 3': 5700, 'LISTA 4': 7100, OMANICI: 5700, EMPLEADOS: 6500 },
};

const LISTAS_BASE = ['LISTA 1', 'LISTA 2', 'LISTA 3', 'LISTA 4', 'OMANICI', 'EMPLEADOS', 'ROYAL'] as const;
const LISTAS_DERIVADAS = [
  { nombre: 'LISTA 1 + %', base: 'LISTA 1', recargoPct: 20 },
  { nombre: 'LISTA 2 + %', base: 'LISTA 2', recargoPct: 20 },
  { nombre: 'LISTA 3 + %', base: 'LISTA 3', recargoPct: 20 },
] as const;

/**
 * Presentaciones con su composicion (unidades por variedad), decodificadas de
 * las formulas del talonario. B/N/FB/FN refieren a los codigos de variedad.
 */
interface DefPresentacion {
  codigo: string;
  nombre: string;
  precioPropio: boolean;
  orden: number;
  /** codigo de articulo -> unidades que aporta UNA presentacion */
  componentes: Record<string, number>;
}

const DEF_PRESENTACIONES: DefPresentacion[] = [
  // Por variedad: caja 36 / docena 12 / bolsa 6 / unidad
  ...VARIEDADES.flatMap((v, i) => [
    { codigo: `CAJA-${v.codigo}`, nombre: `Caja x36 ${v.nombre}`, precioPropio: false, orden: 10 + i, componentes: { [v.codigo]: 36 } },
    { codigo: `DOC-${v.codigo}`, nombre: `Caja x12 ${v.nombre}`, precioPropio: false, orden: 20 + i, componentes: { [v.codigo]: 12 } },
    { codigo: `BOL-${v.codigo}`, nombre: `Bolsa x6 ${v.nombre}`, precioPropio: false, orden: 30 + i, componentes: { [v.codigo]: 6 } },
    { codigo: `BOL12-${v.codigo}`, nombre: `Bolsa x12 ${v.nombre}`, precioPropio: false, orden: 40 + i, componentes: { [v.codigo]: 12 } },
    { codigo: `UNI-${v.codigo}`, nombre: `Unidad ${v.nombre}`, precioPropio: false, orden: 40 + i, componentes: { [v.codigo]: 1 } },
  ]),
  // Surtida B-N-FB: 12+12+12 / 4+4+4 / 2+2+2
  { codigo: 'CAJA-BNFB', nombre: 'Caja surtida B-N-FB', precioPropio: false, orden: 50, componentes: { 'ALF-B': 12, 'ALF-N': 12, 'ALF-FB': 12 } },
  { codigo: 'DOC-BNFB', nombre: 'Caja x12 surtida B-N-FB', precioPropio: false, orden: 51, componentes: { 'ALF-B': 4, 'ALF-N': 4, 'ALF-FB': 4 } },
  { codigo: 'BOL-BNFB', nombre: 'Bolsa surtida B-N-FB', precioPropio: false, orden: 52, componentes: { 'ALF-B': 2, 'ALF-N': 2, 'ALF-FB': 2 } },
  { codigo: 'BOL12-BNFB', nombre: 'Bolsa x12 surtida B-N-FB', precioPropio: false, orden: 53, componentes: { 'ALF-B': 4, 'ALF-N': 4, 'ALF-FB': 4 } },
  // Surtida B-N-FN: 12+12+12 / 4+4+4 / 2+2+2
  { codigo: 'CAJA-BNFN', nombre: 'Caja surtida B-N-FN', precioPropio: false, orden: 55, componentes: { 'ALF-B': 12, 'ALF-N': 12, 'ALF-FN': 12 } },
  { codigo: 'DOC-BNFN', nombre: 'Caja x12 surtida B-N-FN', precioPropio: false, orden: 56, componentes: { 'ALF-B': 4, 'ALF-N': 4, 'ALF-FN': 4 } },
  { codigo: 'BOL-BNFN', nombre: 'Bolsa surtida B-N-FN', precioPropio: false, orden: 57, componentes: { 'ALF-B': 2, 'ALF-N': 2, 'ALF-FN': 2 } },
  { codigo: 'BOL12-BNFN', nombre: 'Bolsa x12 surtida B-N-FN', precioPropio: false, orden: 58, componentes: { 'ALF-B': 4, 'ALF-N': 4, 'ALF-FN': 4 } },
  // Surtida B-N-FN-FB: caja 9+9+9+9 / doc 3+3+3+3 / pack X4 = 1 de cada
  { codigo: 'CAJA-BNFNFB', nombre: 'Caja surtida B-N-FN-FB', precioPropio: false, orden: 60, componentes: { 'ALF-B': 9, 'ALF-N': 9, 'ALF-FN': 9, 'ALF-FB': 9 } },
  { codigo: 'DOC-BNFNFB', nombre: 'Caja x12 surtida B-N-FN-FB', precioPropio: false, orden: 61, componentes: { 'ALF-B': 3, 'ALF-N': 3, 'ALF-FN': 3, 'ALF-FB': 3 } },
  { codigo: 'X4-BNFNFB', nombre: 'Pack x4 surtido (1 de cada)', precioPropio: false, orden: 62, componentes: { 'ALF-B': 1, 'ALF-N': 1, 'ALF-FN': 1, 'ALF-FB': 1 } },
  // Surtida FN-FB: caja 18+18 / doc 6+6 / bolsa 3+3
  { codigo: 'CAJA-FNFB', nombre: 'Caja surtida FN-FB', precioPropio: false, orden: 65, componentes: { 'ALF-FN': 18, 'ALF-FB': 18 } },
  { codigo: 'DOC-FNFB', nombre: 'Caja x12 surtida FN-FB', precioPropio: false, orden: 66, componentes: { 'ALF-FN': 6, 'ALF-FB': 6 } },
  { codigo: 'BOL-FNFB', nombre: 'Bolsa surtida FN-FB', precioPropio: false, orden: 67, componentes: { 'ALF-FN': 3, 'ALF-FB': 3 } },
  { codigo: 'BOL12-FNFB', nombre: 'Bolsa x12 surtida FN-FB', precioPropio: false, orden: 68, componentes: { 'ALF-FN': 6, 'ALF-FB': 6 } },
  // Caja Anyulin: 3 de cada variedad y el ENVASE se cobra aparte (precio propio)
  { codigo: 'CAJA-ANY', nombre: 'Caja Anyulin (3 de cada + envase)', precioPropio: true, orden: 70, componentes: { 'ALF-B': 3, 'ALF-N': 3, 'ALF-FN': 3, 'ALF-FB': 3, 'ENV-ANY': 1 } },
  // Caja vacia: solo el envase, mismo renglon de precio
  { codigo: 'CAJA-VACIA', nombre: 'Caja vacia (solo envase)', precioPropio: true, orden: 71, componentes: { 'ENV-ANY': 1 } },
  // Renglones directos con precio propio
  // La caja de cubanitos ARRANCA toda de dulce de leche; el talonario cambia
  // los sabores adentro y el precio sigue siendo el de la caja.
  { codigo: 'CAJA-CUB-10', nombre: 'Cubanitos caja x10', precioPropio: true, orden: 80, componentes: { 'CUB-DDL': 10 } },
  { codigo: 'CAJA-CUB-16', nombre: 'Cubanitos caja x16', precioPropio: true, orden: 81, componentes: { 'CUB-DDL': 16 } },
  { codigo: 'ALM-CL', nombre: 'Almendras choc c/leche bolsa 200 g', precioPropio: true, orden: 82, componentes: { 'ALM-CL': 1 } },
  { codigo: 'ALM-B', nombre: 'Almendras choc blanco bolsa 200 g', precioPropio: true, orden: 83, componentes: { 'ALM-B': 1 } },
  { codigo: 'ALM-SA', nombre: 'Almendras choc semiamargo bolsa 200 g', precioPropio: true, orden: 84, componentes: { 'ALM-SA': 1 } },
];

/* -------------------------------- Siembra ---------------------------------- */

export interface ResumenAnyulin {
  articulos: number;
  listas: number;
  precios: number;
  presentaciones: number;
}

export function sembrarAnyulin(db: BaseDatos): ResumenAnyulin {
  const resumen: ResumenAnyulin = { articulos: 0, listas: 0, precios: 0, presentaciones: 0 };
  const ahora = new Date().toISOString();

  // Unidad base "u" (tiene que existir; el seed base la crea, pero por las dudas).
  let unidad = db.select().from(unidadesMedida).where(eq(unidadesMedida.abreviatura, 'u')).get();
  if (!unidad) {
    unidad = db
      .insert(unidadesMedida)
      .values({ nombre: 'Unidad', abreviatura: 'u', tipoMagnitud: 'unidad' })
      .returning()
      .all()[0]!;
  }

  // Articulos del catalogo (todo producto_terminado, stock en unidades).
  const idPorCodigo = new Map<string, number>();
  for (const def of [...VARIEDADES, ...RENGLONES_PROPIOS]) {
    let articulo = db.select().from(articulos).where(eq(articulos.codigo, def.codigo)).get();
    if (!articulo) {
      articulo = db
        .insert(articulos)
        .values({
          codigo: def.codigo,
          nombre: def.nombre,
          tipo: 'producto_terminado',
          unidadBaseId: unidad.id,
          // La caja comercial de la variedad es de 36; los renglones propios
          // se venden de a 1 (la caja ES la unidad de venta).
          unidadesPorCaja: def.codigo.startsWith('ALF-') ? 36 : null,
          alicuotaIva: 21,
          activo: true,
        })
        .returning()
        .all()[0]!;
      resumen.articulos += 1;
    }
    idPorCodigo.set(def.codigo, articulo.id);
  }

  // Listas base y derivadas.
  const listaPorNombre = new Map<string, number>();
  for (const nombre of LISTAS_BASE) {
    let lista = db.select().from(listasPrecio).where(eq(listasPrecio.nombre, nombre)).get();
    if (!lista) {
      lista = db.insert(listasPrecio).values({ nombre, activa: true }).returning().all()[0]!;
      resumen.listas += 1;
    }
    listaPorNombre.set(nombre, lista.id);
  }
  for (const def of LISTAS_DERIVADAS) {
    let lista = db.select().from(listasPrecio).where(eq(listasPrecio.nombre, def.nombre)).get();
    if (!lista) {
      lista = db
        .insert(listasPrecio)
        .values({
          nombre: def.nombre,
          baseListaId: listaPorNombre.get(def.base)!,
          recargoPct: def.recargoPct,
          activa: true,
        })
        .returning()
        .all()[0]!;
      resumen.listas += 1;
    }
    listaPorNombre.set(def.nombre, lista.id);
  }

  // Precios unitarios por articulo y lista (solo listas base: las derivadas
  // se calculan). En centavos.
  for (const [nombreArticulo, porLista] of Object.entries(MATRIZ_PRECIOS)) {
    const articulo = db.select().from(articulos).where(eq(articulos.nombre, nombreArticulo)).get();
    if (!articulo) continue;
    for (const [nombreLista, pesos] of Object.entries(porLista)) {
      const listaId = listaPorNombre.get(nombreLista);
      if (listaId === undefined) continue;
      const existente = db
        .select()
        .from(precios)
        .where(eq(precios.articuloId, articulo.id))
        .all()
        .find((fila) => fila.listaPrecioId === listaId);
      if (!existente) {
        db.insert(precios)
          .values({
            articuloId: articulo.id,
            listaPrecioId: listaId,
            precio: Math.round(pesos * 100),
            vigenteDesde: ahora,
          })
          .run();
        resumen.precios += 1;
      }
    }
  }

  // Presentaciones con sus componentes.
  for (const def of DEF_PRESENTACIONES) {
    const existente = db
      .select()
      .from(presentaciones)
      .where(eq(presentaciones.codigo, def.codigo))
      .get();
    if (existente) continue;
    const fila = db
      .insert(presentaciones)
      .values({
        codigo: def.codigo,
        nombre: def.nombre,
        precioPropio: def.precioPropio,
        activo: true,
        orden: def.orden,
      })
      .returning()
      .all()[0]!;
    for (const [codigoArticulo, unidades] of Object.entries(def.componentes)) {
      db.insert(presentacionComponentes)
        .values({
          presentacionId: fila.id,
          articuloId: idPorCodigo.get(codigoArticulo)!,
          unidades,
        })
        .run();
    }
    resumen.presentaciones += 1;
  }

  // Precio propio de renglon: para cubanitos/almendras/envase la matriz YA es
  // el precio del renglon (no unitario de alfajor): se copia a la tabla de
  // precios de presentacion, lista por lista.
  const renglonesPropios: Record<string, string> = {
    'CAJA-CUB-10': 'CUBANITOS X 10 UNID',
    'CAJA-CUB-16': 'CUBANITOS X 16 UNID',
    'ALM-B': 'ALMENDRAS CHOC BLANCO',
    'ALM-CL': 'ALMENDRAS CHOC C/LECHE',
    'ALM-SA': 'ALMENDRAS CHOC SEMI AMARGO',
    'CAJA-ANY': 'CAJA ANYULIN',
    'CAJA-VACIA': 'CAJA ANYULIN',
  };
  for (const [codigoPresentacion, renglon] of Object.entries(renglonesPropios)) {
    const presentacion = db
      .select()
      .from(presentaciones)
      .where(eq(presentaciones.codigo, codigoPresentacion))
      .get();
    if (!presentacion) continue;
    const yaTiene = db
      .select()
      .from(preciosPresentacion)
      .where(eq(preciosPresentacion.presentacionId, presentacion.id))
      .all();
    if (yaTiene.length > 0) continue;
    for (const [nombreLista, pesos] of Object.entries(MATRIZ_PRECIOS[renglon] ?? {})) {
      const listaId = listaPorNombre.get(nombreLista);
      if (listaId === undefined) continue;
      db.insert(preciosPresentacion)
        .values({
          presentacionId: presentacion.id,
          listaPrecioId: listaId,
          precio: Math.round(pesos * 100),
          vigenteDesde: ahora,
        })
        .run();
    }
  }

  // Correcciones de catalogo (idempotentes). Los cubanitos dejaron de ser
  // "caja como articulo": se apagan el articulo y la presentacion viejos para
  // que no aparezcan en pantallas nuevas (los pedidos historicos los siguen
  // viendo). Las almendras pasaron a llamarse por su bolsa de 200 g.
  db.update(articulos)
    .set({ activo: false })
    .where(inArray(articulos.codigo, ['CUB-10', 'CUB-16']))
    .run();
  db.update(presentaciones)
    .set({ activo: false })
    .where(inArray(presentaciones.codigo, ['CUB-10', 'CUB-16']))
    .run();
  const nombresBolsa: Record<string, string> = {
    'ALM-CL': 'Almendras choc c/leche bolsa 200 g',
    'ALM-B': 'Almendras choc blanco bolsa 200 g',
    'ALM-SA': 'Almendras choc semiamargo bolsa 200 g',
  };
  for (const [codigo, nombre] of Object.entries(nombresBolsa)) {
    db.update(presentaciones).set({ nombre }).where(eq(presentaciones.codigo, codigo)).run();
  }

  return resumen;
}

/* ------------------------------ Padron real -------------------------------- */

/**
 * Padron de clientes del Excel del cliente (hoja LISTA DE PRECIOS Y CLIENTES
 * del talonario). La tercera columna del Excel mezcla vendedor asignado
 * (MAURO CASAL, Denipote) con notas de precio ("caja vacia L1"): aca ya viene
 * separado. La lista se referencia por nombre de lista del sistema.
 */
const VENDEDORES_ANYULIN = ['MAURO CASAL', 'WALTER DENIPOTE'] as const;

const PADRON_ANYULIN: readonly {
  nombre: string;
  lista: string | null;
  vendedor: string | null;
  notas: string | null;
}[] = [
  { nombre: 'ABASTECER DISTRIBUIDORA', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Agustin Alarcon', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Alberto Visconti', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Alejandra Rija', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Andres Silva', lista: 'LISTA 2', vendedor: 'MAURO CASAL', notas: null },
  { nombre: 'Antonio Sanchez', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Ariel Torres', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Claudia Gomez', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Daniel Pernuzzi', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Daniel Pazzuolo', lista: 'LISTA 2', vendedor: 'MAURO CASAL', notas: null },
  { nombre: 'Diego Horrozs', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Distribuidora Bieri', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Fabian Manjka', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Fabio Romero', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Florencia Cavallo', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Gabriel Raimondi', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Gaston Noriega', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Gerardo Sfeir', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Golosinas HN S.A.S', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Hugo Daporta', lista: 'LISTA 2', vendedor: 'MAURO CASAL', notas: null },
  { nombre: 'Iglesia Principe de Paz', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Jorge Antonio Huerga', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Jose Omanici', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Juan Carlos Haberkon', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Juan Manuel Horisberger', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Lorena Villareal', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Luci Lopez', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Luz (Rosario)', lista: 'LISTA 2', vendedor: 'MAURO CASAL', notas: null },
  { nombre: 'Manuel Mikleg', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Marcelo Gimenez', lista: 'LISTA 1 + %', vendedor: null, notas: 'Caja vacia a precio de LISTA 1' },
  { nombre: 'Marcelo Moietta', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Martin Ahumada', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Martina Sta. Fe', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Matias Herrera', lista: 'EMPLEADOS', vendedor: null, notas: null },
  { nombre: 'Mauro Casal', lista: 'LISTA 2', vendedor: null, notas: 'Tambien es vendedor' },
  { nombre: 'Municipalidad', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Natalia Rija', lista: 'LISTA 1', vendedor: null, notas: null },
  { nombre: 'Nemesis', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Pablo Claussen', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Pablo Duarte (Rosario)', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Pablo Tumbarello', lista: null, vendedor: 'WALTER DENIPOTE', notas: 'Sin lista asignada en el Excel' },
  { nombre: 'RAUL GALLARDO', lista: 'LISTA 2', vendedor: 'MAURO CASAL', notas: null },
  { nombre: 'Royal Aristobulo 6286 (Sta Fe)', lista: 'ROYAL', vendedor: null, notas: null },
  { nombre: 'Royal Parana - San Martin 666', lista: 'ROYAL', vendedor: null, notas: null },
  { nombre: 'Royal San Martin 2275 (Sta Fe)', lista: 'ROYAL', vendedor: null, notas: null },
  { nombre: 'Royal San Martin 2665 (Sta Fe)', lista: 'ROYAL', vendedor: null, notas: null },
  { nombre: 'Sebastian Gomez', lista: 'LISTA 1', vendedor: null, notas: 'Lista distribuidora' },
  { nombre: 'Sergio Malvestidi', lista: 'LISTA 2', vendedor: null, notas: null },
  { nombre: 'Silvia Villalba', lista: 'LISTA 3', vendedor: null, notas: null },
  { nombre: 'Walter Denipote', lista: 'LISTA 1', vendedor: null, notas: 'Tambien es vendedor' },
  { nombre: 'Empleados', lista: 'LISTA 2', vendedor: null, notas: null },
];

export interface ResumenPadron {
  vendedores: number;
  clientesCargados: number;
  clientesBorrados: number;
  clientesDesactivados: number;
}

/**
 * Reemplaza el padron de clientes por el REAL del Excel. Los clientes viejos
 * (demo) se borran; el que tenga historia (pedidos, ventas, cuenta corriente)
 * no se puede borrar sin mentir la historia, asi que se desactiva.
 * Idempotente: correrlo de nuevo no duplica nada.
 */
export function sembrarPadronAnyulin(db: BaseDatos): ResumenPadron {
  const resumen: ResumenPadron = {
    vendedores: 0,
    clientesCargados: 0,
    clientesBorrados: 0,
    clientesDesactivados: 0,
  };

  // Vendedores.
  const vendedorPorNombre = new Map<string, number>();
  for (const nombre of VENDEDORES_ANYULIN) {
    let fila = db.select().from(vendedores).where(eq(vendedores.nombre, nombre)).get();
    if (!fila) {
      fila = db.insert(vendedores).values({ nombre, activo: true }).returning().all()[0]!;
      resumen.vendedores += 1;
    }
    vendedorPorNombre.set(nombre, fila.id);
  }

  const listaPorNombre = new Map(
    db.select().from(listasPrecio).all().map((l) => [l.nombre, l.id]),
  );
  const nombresPadron = new Set(PADRON_ANYULIN.map((c) => c.nombre));

  /*
   * Afuera los clientes que no son del padron: borrar si no tienen historia,
   * DESACTIVAR si la tienen.
   *
   * Antes esto se delegaba en el try/catch, confiando en que la foreign key
   * frenara el borrado de un cliente con movimientos. No lo frena: ventas,
   * pedidos y reservas tienen onDelete SET NULL, y cuentas_corrientes ni
   * siquiera tiene FK fisica (es polimorfica, entidad_tipo + entidad_id). O sea
   * que el delete SALIA BIEN y se llevaba puesta la historia: las ventas
   * quedaban sin cliente y los asientos de cuenta corriente apuntando a un id
   * que ya no existe. El resumen general seguia sumando esa deuda —porque hace
   * SUM sobre toda la tabla, sin join— mientras la pantalla de clientes no
   * mostraba a nadie que la debiera. Plata por cobrar sin dueño.
   *
   * Ahora se pregunta explicitamente, tabla por tabla, antes de borrar.
   */
  const tieneHistoria = (clienteId: number): boolean => {
    const hayVenta = db.select({ id: ventas.id }).from(ventas).where(eq(ventas.clienteId, clienteId)).get();
    if (hayVenta !== undefined) return true;
    const hayPedido = db.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.clienteId, clienteId)).get();
    if (hayPedido !== undefined) return true;
    const hayReserva = db
      .select({ id: reservasStock.id })
      .from(reservasStock)
      .where(eq(reservasStock.clienteId, clienteId))
      .get();
    if (hayReserva !== undefined) return true;
    // Cuenta corriente: sin FK, hay que mirarla a mano o la deuda queda huerfana.
    const hayAsiento = db
      .select({ id: cuentasCorrientes.id })
      .from(cuentasCorrientes)
      .where(
        and(
          eq(cuentasCorrientes.entidadTipo, 'cliente'),
          eq(cuentasCorrientes.entidadId, clienteId),
        ),
      )
      .get();
    return hayAsiento !== undefined;
  };

  for (const viejo of db.select().from(clientes).all()) {
    if (nombresPadron.has(viejo.nombre)) continue;
    if (tieneHistoria(viejo.id)) {
      db.update(clientes).set({ activo: false }).where(eq(clientes.id, viejo.id)).run();
      resumen.clientesDesactivados += 1;
      continue;
    }
    try {
      db.delete(clientes).where(eq(clientes.id, viejo.id)).run();
      resumen.clientesBorrados += 1;
    } catch {
      db.update(clientes).set({ activo: false }).where(eq(clientes.id, viejo.id)).run();
      resumen.clientesDesactivados += 1;
    }
  }

  // Adentro el padron real.
  for (const def of PADRON_ANYULIN) {
    const listaId = def.lista !== null ? (listaPorNombre.get(def.lista) ?? null) : null;
    const vendedorId = def.vendedor !== null ? (vendedorPorNombre.get(def.vendedor) ?? null) : null;
    const existente = db.select().from(clientes).where(eq(clientes.nombre, def.nombre)).get();
    if (existente) {
      db.update(clientes)
        .set({ listaPrecioId: listaId, vendedorId, notas: def.notas, activo: true })
        .where(eq(clientes.id, existente.id))
        .run();
    } else {
      db.insert(clientes)
        .values({
          nombre: def.nombre,
          condicionIva: 5,
          tipo: 'mostrador',
          listaPrecioId: listaId,
          vendedorId,
          notas: def.notas,
          activo: true,
        })
        .run();
      resumen.clientesCargados += 1;
    }
  }

  // Vinculo vendedor <-> su ficha de cliente (Mauro Casal y Walter Denipote
  // tambien compran): es la ficha receptora cuando el pedido se les factura.
  const vinculos: Record<string, string> = {
    'MAURO CASAL': 'Mauro Casal',
    'WALTER DENIPOTE': 'Walter Denipote',
  };
  for (const [nombreVendedor, nombreCliente] of Object.entries(vinculos)) {
    const vendedor = db.select().from(vendedores).where(eq(vendedores.nombre, nombreVendedor)).get();
    const cliente = db.select().from(clientes).where(eq(clientes.nombre, nombreCliente)).get();
    if (vendedor && cliente && vendedor.clienteId === null) {
      db.update(vendedores).set({ clienteId: cliente.id }).where(eq(vendedores.id, vendedor.id)).run();
    }
  }

  return resumen;
}
