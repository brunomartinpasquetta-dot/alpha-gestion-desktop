/**
 * Sembrado IDEMPOTENTE de los datos de prueba.
 *
 * Reglas de la casa:
 *  - Se puede correr N veces: cada entidad se busca por su CLAVE NATURAL
 *    (codigo, abreviatura, nombre, username) y solo se inserta si no existe.
 *    Si ya existe se reutiliza su id, no se pisa nada.
 *  - Todo ocurre dentro de UNA transaccion: si algo falla a mitad de camino la
 *    base queda exactamente como estaba, sin datos a medias.
 *  - Los ids NUNCA se hardcodean: se resuelven leyendo la base despues de
 *    insertar, porque son autoincrementales y dependen del estado previo.
 *  - El ledger de stock arranca VACIO salvo que se pida lo contrario por
 *    variable de entorno: el stock se calcula, no se inventa.
 */

import { count, eq, and } from 'drizzle-orm';
import { hashSync } from 'bcrypt';

import { obtenerDb, type BaseDatos } from '../server/db/conexion';
import {
  articulos,
  clientes,
  listasPrecio,
  movimientosStock,
  precios,
  proveedores,
  recetaItems,
  recetas,
  unidadesMedida,
  usuarios,
} from '../server/db/schema';
import { ErrorDatos } from '../server/dominio/errores';
import {
  ARTICULOS,
  CLIENTE_MAYORISTA,
  COSTO_BCRYPT,
  LISTA_PRECIO_GENERAL,
  MOVIMIENTOS_EJEMPLO,
  PRECIOS,
  PROVEEDOR,
  RECETAS,
  UNIDADES,
  USUARIO_ADMIN,
  VARIABLE_ENTORNO_MOVIMIENTOS,
  type DefinicionArticulo,
  type DefinicionReceta,
  type DefinicionUnidad,
} from './datos';

/* ------------------------------------------------------------------------- */
/* Tipos publicos                                                            */
/* ------------------------------------------------------------------------- */

/** Contador por entidad: cuantas filas creo esta corrida y cuantas ya estaban. */
export interface ContadorSeed {
  readonly creadas: number;
  readonly existentes: number;
}

export interface ResumenSeed {
  readonly unidades: ContadorSeed;
  readonly articulos: ContadorSeed;
  readonly recetas: ContadorSeed;
  readonly recetaItems: ContadorSeed;
  readonly proveedores: ContadorSeed;
  readonly listasPrecio: ContadorSeed;
  readonly clientes: ContadorSeed;
  readonly precios: ContadorSeed;
  readonly usuarios: ContadorSeed;
  readonly movimientosStock: ContadorSeed;
  /** True si esta corrida tenia habilitado el sembrado de movimientos de ejemplo. */
  readonly movimientosHabilitados: boolean;
}

/**
 * Handle de transaccion de Drizzle sobre better-sqlite3. Se deriva del tipo del
 * metodo `transaction` para no tener que escribir a mano la firma generica
 * completa de SQLiteTransaction (que ademas cambia entre versiones).
 */
type Transaccion = Parameters<Parameters<BaseDatos['transaction']>[0]>[0];

/** Contador mutable de uso interno; se congela en ContadorSeed al devolverlo. */
interface Contador {
  creadas: number;
  existentes: number;
}

function nuevoContador(): Contador {
  return { creadas: 0, existentes: 0 };
}

function congelar(contador: Contador): ContadorSeed {
  return { creadas: contador.creadas, existentes: contador.existentes };
}

/* ------------------------------------------------------------------------- */
/* Utilidades de resolucion                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Falla ruidosamente si una lectura posterior a un INSERT no devuelve la fila.
 * No deberia pasar nunca; si pasa, es un bug y no queremos seguir con un id roto.
 */
function exigir<T>(valor: T | undefined, descripcion: string): T {
  if (valor === undefined) {
    throw new ErrorDatos(`El seed no pudo resolver ${descripcion} despues de insertarlo`);
  }
  return valor;
}

/* ------------------------------------------------------------------------- */
/* Unidades de medida                                                        */
/* ------------------------------------------------------------------------- */

function buscarIdUnidad(tx: Transaccion, abreviatura: string): number | undefined {
  return tx
    .select({ id: unidadesMedida.id })
    .from(unidadesMedida)
    .where(eq(unidadesMedida.abreviatura, abreviatura))
    .limit(1)
    .all()[0]?.id;
}

function sembrarUnidad(tx: Transaccion, definicion: DefinicionUnidad, contador: Contador): number {
  const existente = buscarIdUnidad(tx, definicion.abreviatura);
  if (existente !== undefined) {
    contador.existentes += 1;
    return existente;
  }

  tx.insert(unidadesMedida)
    .values({
      nombre: definicion.nombre,
      abreviatura: definicion.abreviatura,
      tipoMagnitud: definicion.tipoMagnitud,
    })
    .onConflictDoNothing()
    .run();

  contador.creadas += 1;
  return exigir(buscarIdUnidad(tx, definicion.abreviatura), `la unidad "${definicion.abreviatura}"`);
}

/** Devuelve un mapa abreviatura -> id con TODAS las unidades del seed resueltas. */
function sembrarUnidades(tx: Transaccion, contador: Contador): Map<string, number> {
  const porAbreviatura = new Map<string, number>();
  for (const definicion of UNIDADES) {
    porAbreviatura.set(definicion.abreviatura, sembrarUnidad(tx, definicion, contador));
  }
  return porAbreviatura;
}

/* ------------------------------------------------------------------------- */
/* Articulos                                                                 */
/* ------------------------------------------------------------------------- */

function buscarIdArticulo(tx: Transaccion, codigo: string): number | undefined {
  return tx.select({ id: articulos.id }).from(articulos).where(eq(articulos.codigo, codigo)).limit(1).all()[0]?.id;
}

function sembrarArticulo(
  tx: Transaccion,
  definicion: DefinicionArticulo,
  unidadesPorAbreviatura: ReadonlyMap<string, number>,
  contador: Contador,
): number {
  const existente = buscarIdArticulo(tx, definicion.codigo);
  if (existente !== undefined) {
    contador.existentes += 1;
    return existente;
  }

  const unidadBaseId = unidadesPorAbreviatura.get(definicion.abreviaturaUnidadBase);
  if (unidadBaseId === undefined) {
    throw new ErrorDatos(
      `El articulo "${definicion.codigo}" referencia la unidad "${definicion.abreviaturaUnidadBase}", que no esta definida en el seed`,
    );
  }

  tx.insert(articulos)
    .values({
      codigo: definicion.codigo,
      nombre: definicion.nombre,
      tipo: definicion.tipo,
      unidadBaseId,
      stockMin: definicion.stockMin,
      // Centavos por unidad base: entero, nunca pesos con decimales.
      costoActual: definicion.costoActual,
      activo: true,
    })
    .onConflictDoNothing()
    .run();

  contador.creadas += 1;
  return exigir(buscarIdArticulo(tx, definicion.codigo), `el articulo "${definicion.codigo}"`);
}

/** Devuelve un mapa codigo -> id con TODOS los articulos del seed resueltos. */
function sembrarArticulos(
  tx: Transaccion,
  unidadesPorAbreviatura: ReadonlyMap<string, number>,
  contador: Contador,
): Map<string, number> {
  const porCodigo = new Map<string, number>();
  for (const definicion of ARTICULOS) {
    porCodigo.set(definicion.codigo, sembrarArticulo(tx, definicion, unidadesPorAbreviatura, contador));
  }
  return porCodigo;
}

function exigirArticulo(articulosPorCodigo: ReadonlyMap<string, number>, codigo: string): number {
  const id = articulosPorCodigo.get(codigo);
  if (id === undefined) {
    throw new ErrorDatos(`El seed referencia el articulo "${codigo}", que no esta definido`);
  }
  return id;
}

/* ------------------------------------------------------------------------- */
/* Recetas y sus items                                                       */
/* ------------------------------------------------------------------------- */

function buscarIdReceta(tx: Transaccion, articuloProducidoId: number): number | undefined {
  return tx
    .select({ id: recetas.id })
    .from(recetas)
    .where(eq(recetas.articuloProducidoId, articuloProducidoId))
    .limit(1)
    .all()[0]?.id;
}

function existeItemReceta(tx: Transaccion, recetaId: number, articuloInsumoId: number): boolean {
  const fila = tx
    .select({ id: recetaItems.id })
    .from(recetaItems)
    .where(and(eq(recetaItems.recetaId, recetaId), eq(recetaItems.articuloInsumoId, articuloInsumoId)))
    .limit(1)
    .all()[0];
  return fila !== undefined;
}

function sembrarReceta(
  tx: Transaccion,
  definicion: DefinicionReceta,
  articulosPorCodigo: ReadonlyMap<string, number>,
  unidadesPorAbreviatura: ReadonlyMap<string, number>,
  contadorRecetas: Contador,
  contadorItems: Contador,
): void {
  const articuloProducidoId = exigirArticulo(articulosPorCodigo, definicion.codigoArticuloProducido);

  // Clave natural de la receta en el seed: el articulo que produce.
  let recetaId = buscarIdReceta(tx, articuloProducidoId);
  if (recetaId !== undefined) {
    contadorRecetas.existentes += 1;
  } else {
    const rindeUnidadId = unidadesPorAbreviatura.get(definicion.abreviaturaRindeUnidad);
    if (rindeUnidadId === undefined) {
      throw new ErrorDatos(
        `La receta de "${definicion.codigoArticuloProducido}" rinde en "${definicion.abreviaturaRindeUnidad}", unidad no definida en el seed`,
      );
    }

    tx.insert(recetas)
      .values({
        articuloProducidoId,
        rindeCantidad: definicion.rindeCantidad,
        rindeUnidadId,
        activa: true,
        notas: definicion.notas,
      })
      .run();

    contadorRecetas.creadas += 1;
    recetaId = exigir(
      buscarIdReceta(tx, articuloProducidoId),
      `la receta de "${definicion.codigoArticuloProducido}"`,
    );
  }

  for (const item of definicion.items) {
    const articuloInsumoId = exigirArticulo(articulosPorCodigo, item.codigoInsumo);

    if (existeItemReceta(tx, recetaId, articuloInsumoId)) {
      contadorItems.existentes += 1;
      continue;
    }

    tx.insert(recetaItems)
      .values({
        recetaId,
        articuloInsumoId,
        // La cantidad va SIEMPRE en la unidad base del insumo (g, ml o u),
        // no en la unidad de rinde de la receta.
        cantidad: item.cantidad,
        mermaEsperadaPct: item.mermaEsperadaPct,
      })
      .onConflictDoNothing()
      .run();

    contadorItems.creadas += 1;
  }
}

/* ------------------------------------------------------------------------- */
/* Terceros, listas y precios                                                */
/* ------------------------------------------------------------------------- */

function buscarIdProveedor(tx: Transaccion, nombre: string): number | undefined {
  return tx.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.nombre, nombre)).limit(1).all()[0]?.id;
}

function sembrarProveedor(tx: Transaccion, contador: Contador): number {
  const existente = buscarIdProveedor(tx, PROVEEDOR.nombre);
  if (existente !== undefined) {
    contador.existentes += 1;
    return existente;
  }

  tx.insert(proveedores)
    .values({
      nombre: PROVEEDOR.nombre,
      cuit: PROVEEDOR.cuit,
      telefono: PROVEEDOR.telefono,
      email: PROVEEDOR.email,
      direccion: PROVEEDOR.direccion,
      activo: true,
    })
    .run();

  contador.creadas += 1;
  return exigir(buscarIdProveedor(tx, PROVEEDOR.nombre), `el proveedor "${PROVEEDOR.nombre}"`);
}

function buscarIdListaPrecio(tx: Transaccion, nombre: string): number | undefined {
  return tx
    .select({ id: listasPrecio.id })
    .from(listasPrecio)
    .where(eq(listasPrecio.nombre, nombre))
    .limit(1)
    .all()[0]?.id;
}

function sembrarListaPrecio(tx: Transaccion, contador: Contador): number {
  const existente = buscarIdListaPrecio(tx, LISTA_PRECIO_GENERAL.nombre);
  if (existente !== undefined) {
    contador.existentes += 1;
    return existente;
  }

  tx.insert(listasPrecio)
    .values({ nombre: LISTA_PRECIO_GENERAL.nombre, activa: LISTA_PRECIO_GENERAL.activa })
    .onConflictDoNothing()
    .run();

  contador.creadas += 1;
  return exigir(
    buscarIdListaPrecio(tx, LISTA_PRECIO_GENERAL.nombre),
    `la lista de precios "${LISTA_PRECIO_GENERAL.nombre}"`,
  );
}

function buscarIdCliente(tx: Transaccion, nombre: string): number | undefined {
  return tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.nombre, nombre)).limit(1).all()[0]?.id;
}

function sembrarCliente(tx: Transaccion, listaPrecioId: number, contador: Contador): void {
  if (buscarIdCliente(tx, CLIENTE_MAYORISTA.nombre) !== undefined) {
    contador.existentes += 1;
    return;
  }

  tx.insert(clientes)
    .values({
      nombre: CLIENTE_MAYORISTA.nombre,
      cuit: CLIENTE_MAYORISTA.cuit,
      telefono: CLIENTE_MAYORISTA.telefono,
      email: CLIENTE_MAYORISTA.email,
      tipo: CLIENTE_MAYORISTA.tipo,
      listaPrecioId,
      activo: true,
    })
    .run();

  contador.creadas += 1;
}

/**
 * Precios. La tabla admite historico por `vigente_desde`, asi que la clave
 * natural del seed es el par (articulo, lista): si ya hay un precio cargado no
 * se agrega otro, para no inflar el historico corrida tras corrida.
 */
function sembrarPrecios(
  tx: Transaccion,
  articulosPorCodigo: ReadonlyMap<string, number>,
  listasPorNombre: ReadonlyMap<string, number>,
  contador: Contador,
): void {
  for (const definicion of PRECIOS) {
    const articuloId = exigirArticulo(articulosPorCodigo, definicion.codigoArticulo);
    const listaPrecioId = listasPorNombre.get(definicion.nombreListaPrecio);
    if (listaPrecioId === undefined) {
      throw new ErrorDatos(
        `El precio de "${definicion.codigoArticulo}" referencia la lista "${definicion.nombreListaPrecio}", que no esta definida en el seed`,
      );
    }

    const existente = tx
      .select({ id: precios.id })
      .from(precios)
      .where(and(eq(precios.articuloId, articuloId), eq(precios.listaPrecioId, listaPrecioId)))
      .limit(1)
      .all()[0];

    if (existente !== undefined) {
      contador.existentes += 1;
      continue;
    }

    tx.insert(precios)
      .values({ articuloId, listaPrecioId, precio: definicion.precio })
      .run();

    contador.creadas += 1;
  }
}

/* ------------------------------------------------------------------------- */
/* Usuario administrador                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Usuario admin de arranque. La contrasena se hashea con bcrypt (cost 10) y
 * NUNCA se guarda en texto plano.
 *
 * ATENCION: es una CREDENCIAL DE PRUEBA, publica en el repositorio. Hay que
 * cambiarla antes de poner el sistema en produccion.
 */
function sembrarUsuarioAdmin(tx: Transaccion, contador: Contador): void {
  const existente = tx
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(eq(usuarios.username, USUARIO_ADMIN.username))
    .limit(1)
    .all()[0];

  if (existente !== undefined) {
    // Si ya existe NO se le pisa el hash: puede que ya la hayan cambiado.
    contador.existentes += 1;
    return;
  }

  tx.insert(usuarios)
    .values({
      username: USUARIO_ADMIN.username,
      passwordHash: hashSync(USUARIO_ADMIN.contrasenaPlana, COSTO_BCRYPT),
      rol: USUARIO_ADMIN.rol,
      activo: USUARIO_ADMIN.activo,
    })
    .onConflictDoNothing()
    .run();

  contador.creadas += 1;
}

/* ------------------------------------------------------------------------- */
/* Movimientos de stock (opcionales)                                         */
/* ------------------------------------------------------------------------- */

/** True solo si la variable de entorno pide explicitamente los movimientos. */
export function movimientosHabilitados(): boolean {
  return process.env[VARIABLE_ENTORNO_MOVIMIENTOS]?.trim() === '1';
}

/**
 * Siembra movimientos de ejemplo SOLO si el ledger esta completamente vacio.
 * Ese es el chequeo de idempotencia: el ledger es un historico append-only, asi
 * que la unica lectura segura es "si ya hay movimientos, no toco nada".
 */
function sembrarMovimientos(
  tx: Transaccion,
  articulosPorCodigo: ReadonlyMap<string, number>,
  contador: Contador,
): void {
  const total = tx.select({ total: count() }).from(movimientosStock).all()[0]?.total ?? 0;
  if (total > 0) {
    contador.existentes += total;
    return;
  }

  for (const definicion of MOVIMIENTOS_EJEMPLO) {
    tx.insert(movimientosStock)
      .values({
        articuloId: exigirArticulo(articulosPorCodigo, definicion.codigoArticulo),
        tipo: definicion.tipo,
        cantidad: definicion.cantidad,
        costoUnitario: definicion.costoUnitario,
        notas: definicion.notas,
      })
      .run();

    contador.creadas += 1;
  }
}

/* ------------------------------------------------------------------------- */
/* Punto de entrada                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Siembra los datos de prueba y devuelve el resumen de lo hecho.
 *
 * Es idempotente y transaccional: correrlo dos veces seguidas deja exactamente
 * el mismo estado que correrlo una sola vez, y un fallo a mitad revierte todo.
 */
export function sembrar(): ResumenSeed {
  const db = obtenerDb();
  const conMovimientos = movimientosHabilitados();

  const contadores = {
    unidades: nuevoContador(),
    articulos: nuevoContador(),
    recetas: nuevoContador(),
    recetaItems: nuevoContador(),
    proveedores: nuevoContador(),
    listasPrecio: nuevoContador(),
    clientes: nuevoContador(),
    precios: nuevoContador(),
    usuarios: nuevoContador(),
    movimientosStock: nuevoContador(),
  };

  db.transaction((tx) => {
    const unidadesPorAbreviatura = sembrarUnidades(tx, contadores.unidades);
    const articulosPorCodigo = sembrarArticulos(tx, unidadesPorAbreviatura, contadores.articulos);

    for (const definicion of RECETAS) {
      sembrarReceta(
        tx,
        definicion,
        articulosPorCodigo,
        unidadesPorAbreviatura,
        contadores.recetas,
        contadores.recetaItems,
      );
    }

    sembrarProveedor(tx, contadores.proveedores);

    const listaPrecioId = sembrarListaPrecio(tx, contadores.listasPrecio);
    const listasPorNombre = new Map<string, number>([[LISTA_PRECIO_GENERAL.nombre, listaPrecioId]]);

    sembrarCliente(tx, listaPrecioId, contadores.clientes);
    sembrarPrecios(tx, articulosPorCodigo, listasPorNombre, contadores.precios);
    sembrarUsuarioAdmin(tx, contadores.usuarios);

    if (conMovimientos) {
      sembrarMovimientos(tx, articulosPorCodigo, contadores.movimientosStock);
    }
  });

  return {
    unidades: congelar(contadores.unidades),
    articulos: congelar(contadores.articulos),
    recetas: congelar(contadores.recetas),
    recetaItems: congelar(contadores.recetaItems),
    proveedores: congelar(contadores.proveedores),
    listasPrecio: congelar(contadores.listasPrecio),
    clientes: congelar(contadores.clientes),
    precios: congelar(contadores.precios),
    usuarios: congelar(contadores.usuarios),
    movimientosStock: congelar(contadores.movimientosStock),
    movimientosHabilitados: conMovimientos,
  };
}
