/**
 * Servicio de stock: reglas de negocio del ledger.
 *
 * Invariante central del sistema: el stock de un articulo NO se guarda, se
 * deriva. Todo cambio de existencias es un asiento nuevo en `movimientos_stock`
 * con signo (+ ingreso / - egreso) y el saldo es `SUM(cantidad)`. Esto hace
 * imposible que "el stock quede mal" por un update perdido: el saldo siempre es
 * reconstruible desde la historia, y toda diferencia tiene un asiento que la
 * explica.
 *
 * Este archivo no conoce Drizzle ni HTTP: habla solo con los repositorios.
 */

import type { MovimientoStock, NuevoMovimientoStock, TipoArticulo } from '../db/schema';
import { TIPOS_ARTICULO, TIPOS_DOCUMENTO_STOCK, TIPOS_MOVIMIENTO_STOCK } from '../db/schema';
import type { TipoMovimientoStock } from '../db/schema';
import { ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import {
  TIPOS_POR_GRUPO,
  esGrupoStock,
  estaBajoMinimo,
  type ArticuloConStock,
  type GrupoStock,
  type ReferenciaDocumento,
  type SaldoStock,
} from '../dominio/tipos';
import * as articulosRepositorio from '../repositorios/articulos.repositorio';
import type { FilaArticuloConStock } from '../repositorios/articulos.repositorio';
import * as movimientosRepositorio from '../repositorios/movimientos-stock.repositorio';
import { esCantidadCero, esCentavosValido, redondearCantidad } from '../utiles/numeros';

export interface EntradaMovimientoStock {
  articuloId: number;
  tipo: TipoMovimientoStock;
  /** Con signo: (+) ingreso, (-) egreso. En unidad base del artículo. */
  cantidad: number;
  /** Centavos por unidad base. Opcional. */
  costoUnitario?: number | null;
  documento?: ReferenciaDocumento | null;
  /** ISO-8601. Si se omite, la base pone el timestamp actual. */
  fecha?: string;
  notas?: string | null;
}

export interface OpcionesListadoArticulos {
  soloActivos?: boolean;
  tipo?: TipoArticulo;
  grupo?: GrupoStock;
}

/** Signo que cada tipo de movimiento puede llevar. */
type SignoPermitido = 'positivo' | 'negativo' | 'ambos';

/**
 * Coherencia semantica entre el tipo de movimiento y el signo de la cantidad.
 *
 * Sin esta tabla nada impide asentar una "venta" de +50, que inflaria el stock y
 * ademas mentiria en cualquier reporte por tipo de movimiento. `ajuste` es el
 * unico bidireccional justamente porque existe para corregir en ambos sentidos.
 */
const SIGNO_POR_TIPO: Readonly<Record<TipoMovimientoStock, SignoPermitido>> = {
  compra: 'positivo',
  ingreso_produccion: 'positivo',
  venta: 'negativo',
  consumo_produccion: 'negativo',
  merma: 'negativo',
  ajuste: 'ambos',
};

const DESCRIPCION_SIGNO: Readonly<Record<Exclude<SignoPermitido, 'ambos'>, string>> = {
  positivo: 'positiva (ingreso)',
  negativo: 'negativa (egreso)',
};

/**
 * Cuanto falta para llegar al stock ideal. Es la respuesta a la pregunta que
 * sigue a "falta harina": cuanta comprar. Solo tiene sentido si el articulo esta
 * por debajo del ideal; en cualquier otro caso es cero.
 */
function calcularAReponer(stock: number, ideal: number | null): number {
  if (ideal === null || ideal <= 0 || stock >= ideal) return 0;
  return redondearCantidad(ideal - stock);
}

/** Convierte la fila cruda del repositorio en la vista de dominio del saldo. */
function aSaldoStock(fila: FilaArticuloConStock): SaldoStock {
  return {
    articuloId: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    tipo: fila.tipo,
    unidadAbreviatura: fila.unidadAbreviatura,
    stock: fila.stock,
    stockMin: fila.stockMin,
    stockIdeal: fila.stockIdeal,
    marca: fila.marca,
    familiaNombre: fila.familiaNombre,
    proveedorHabitualNombre: fila.proveedorHabitualNombre,
    unidadesPorCaja: fila.unidadesPorCaja,
    bajoMinimo: estaBajoMinimo(fila.stock, fila.stockMin),
    aReponer: calcularAReponer(fila.stock, fila.stockIdeal),
  };
}

/** Convierte la fila cruda del repositorio en el articulo con stock para listados. */
function aArticuloConStock(fila: FilaArticuloConStock): ArticuloConStock {
  return {
    id: fila.id,
    codigo: fila.codigo,
    nombre: fila.nombre,
    tipo: fila.tipo,
    unidadBaseId: fila.unidadBaseId,
    unidadAbreviatura: fila.unidadAbreviatura,
    stockMin: fila.stockMin,
    stockIdeal: fila.stockIdeal,
    codigoBarras: fila.codigoBarras,
    marca: fila.marca,
    familiaId: fila.familiaId,
    familiaNombre: fila.familiaNombre,
    proveedorHabitualId: fila.proveedorHabitualId,
    proveedorHabitualNombre: fila.proveedorHabitualNombre,
    alicuotaIva: fila.alicuotaIva,
    porPeso: fila.porPeso,
    notas: fila.notas,
    unidadesPorCaja: fila.unidadesPorCaja,
    costoActual: fila.costoActual,
    activo: fila.activo,
    stock: fila.stock,
    reservado: fila.reservado,
    disponible: redondearCantidad(Math.max(0, fila.stock - fila.reservado)),
    recetaId: fila.recetaId,
    recetaRinde: fila.recetaRinde,
    recetaInsumos: fila.recetaInsumos,
    bajoMinimo: estaBajoMinimo(fila.stock, fila.stockMin),
    aReponer: calcularAReponer(fila.stock, fila.stockIdeal),
  };
}

/** Valida el tipo de movimiento aunque venga de afuera del dominio (HTTP, seed, scripts). */
function validarTipoMovimiento(tipo: TipoMovimientoStock): void {
  if (!TIPOS_MOVIMIENTO_STOCK.includes(tipo)) {
    throw new ErrorValidacion(
      `Tipo de movimiento de stock invalido: "${String(tipo)}". Validos: ${TIPOS_MOVIMIENTO_STOCK.join(', ')}.`,
      { tipo },
    );
  }
}

/** Normaliza y valida la cantidad. Devuelve la cantidad ya redondeada. */
function validarCantidad(cantidad: number): number {
  if (typeof cantidad !== 'number' || !Number.isFinite(cantidad)) {
    throw new ErrorValidacion('La cantidad del movimiento debe ser un numero finito.', { cantidad });
  }
  // Se redondea ANTES de comparar con cero: un residuo de 1e-15 no es un movimiento.
  const normalizada = redondearCantidad(cantidad);
  if (esCantidadCero(normalizada)) {
    throw new ErrorValidacion('La cantidad del movimiento no puede ser cero.', { cantidad });
  }
  return normalizada;
}

/** Aplica la tabla de signos permitidos por tipo de movimiento. */
function validarSigno(tipo: TipoMovimientoStock, cantidad: number): void {
  const esperado = SIGNO_POR_TIPO[tipo];
  if (esperado === 'ambos') return;
  const esPositiva = cantidad > 0;
  if ((esperado === 'positivo' && !esPositiva) || (esperado === 'negativo' && esPositiva)) {
    throw new ErrorReglaNegocio(
      `El movimiento de tipo "${tipo}" requiere una cantidad ${DESCRIPCION_SIGNO[esperado]}; se recibio ${cantidad}.`,
      { tipo, cantidad, signoEsperado: esperado },
    );
  }
}

/** El costo se guarda en centavos enteros: un costo con decimales seria dinero en REAL. */
function validarCostoUnitario(costoUnitario: number | null | undefined): number | null {
  if (costoUnitario === undefined || costoUnitario === null) return null;
  if (!esCentavosValido(costoUnitario)) {
    throw new ErrorValidacion(
      'El costo unitario debe ser un entero de centavos mayor o igual a cero.',
      { costoUnitario },
    );
  }
  return costoUnitario;
}

/** El documento es opcional, pero si viene tiene que ser un origen conocido. */
function validarDocumento(
  documento: ReferenciaDocumento | null | undefined,
): { tipo: ReferenciaDocumento['tipo'] | null; id: number | null } {
  if (documento === undefined || documento === null) return { tipo: null, id: null };
  if (!TIPOS_DOCUMENTO_STOCK.includes(documento.tipo)) {
    throw new ErrorValidacion(
      `Tipo de documento de stock invalido: "${String(documento.tipo)}". Validos: ${TIPOS_DOCUMENTO_STOCK.join(', ')}.`,
      { documento },
    );
  }
  if (documento.id !== null && !Number.isInteger(documento.id)) {
    throw new ErrorValidacion('El identificador del documento debe ser un entero o null.', {
      documento,
    });
  }
  return { tipo: documento.tipo, id: documento.id };
}

/** Resuelve los tipos de articulo a filtrar segun grupo y/o tipo puntual. */
function resolverTipos(opciones: OpcionesListadoArticulos): readonly TipoArticulo[] | undefined {
  const { tipo, grupo } = opciones;

  if (tipo !== undefined && !TIPOS_ARTICULO.includes(tipo)) {
    throw new ErrorValidacion(
      `Tipo de articulo invalido: "${String(tipo)}". Validos: ${TIPOS_ARTICULO.join(', ')}.`,
      { tipo },
    );
  }
  if (grupo === undefined) return tipo === undefined ? undefined : [tipo];

  if (!esGrupoStock(grupo)) {
    throw new ErrorValidacion(
      `Grupo de stock invalido: "${String(grupo)}". Validos: ${Object.keys(TIPOS_POR_GRUPO).join(', ')}.`,
      { grupo },
    );
  }
  // El grupo ya se valido arriba, asi que la clave existe; el `?? []` es para
  // que el chequeo de indices de TypeScript no obligue a un assert.
  const tiposDelGrupo = TIPOS_POR_GRUPO[grupo] ?? [];
  if (tipo === undefined) return tiposDelGrupo;

  // Pedir un tipo que no pertenece al grupo es una contradiccion, no un filtro vacio.
  if (!tiposDelGrupo.includes(tipo)) {
    throw new ErrorValidacion(
      `El tipo de articulo "${tipo}" no pertenece al grupo de stock "${grupo}".`,
      { tipo, grupo },
    );
  }
  return [tipo];
}

/**
 * Asienta un movimiento en el ledger. Es el UNICO camino permitido para que el
 * stock de un articulo cambie: no hay updates de existencias en ningun lado.
 */
function registrarMovimiento(entrada: EntradaMovimientoStock): MovimientoStock {
  const { articuloId, tipo } = entrada;

  if (!Number.isInteger(articuloId) || articuloId <= 0) {
    throw new ErrorValidacion('El identificador de articulo debe ser un entero positivo.', {
      articuloId,
    });
  }
  if (!articulosRepositorio.existe(articuloId)) {
    throw new ErrorNoEncontrado('articulo', articuloId);
  }

  validarTipoMovimiento(tipo);
  const cantidad = validarCantidad(entrada.cantidad);
  validarSigno(tipo, cantidad);
  const costoUnitario = validarCostoUnitario(entrada.costoUnitario);
  const documento = validarDocumento(entrada.documento);

  const valores: NuevoMovimientoStock = {
    articuloId,
    tipo,
    cantidad,
    costoUnitario,
    documentoTipo: documento.tipo,
    documentoId: documento.id,
    // `undefined` deja que SQLite aplique el default (timestamp actual).
    fecha: entrada.fecha,
    notas: entrada.notas ?? null,
  };

  return movimientosRepositorio.insertar(valores);
}

/** Saldo del articulo agregado en SQL. No valida existencia: un articulo sin ledger da 0. */
function saldoActual(articuloId: number): number {
  return movimientosRepositorio.sumarCantidadPorArticulo(articuloId);
}

/**
 * Saldos de un grupo de stock ("Stock de Insumos" / "Stock de Productos").
 *
 * El grupo es una vista derivada del campo `tipo` del articulo, no una tabla
 * aparte. Se listan solo los articulos activos porque es la vista operativa:
 * los dados de baja no se reponen ni se producen.
 */
function saldosPorGrupo(grupo: GrupoStock): SaldoStock[] {
  if (!esGrupoStock(grupo)) {
    throw new ErrorValidacion(
      `Grupo de stock invalido: "${String(grupo)}". Validos: ${Object.keys(TIPOS_POR_GRUPO).join(', ')}.`,
      { grupo },
    );
  }
  return articulosRepositorio
    .listarConStock({ soloActivos: true, tipos: TIPOS_POR_GRUPO[grupo] })
    .map(aSaldoStock);
}

/** Detalle de stock de un articulo puntual. Lanza 404 si el articulo no existe. */
function detalleStock(articuloId: number): SaldoStock {
  const fila = articulosRepositorio.obtenerConStockPorId(articuloId);
  if (!fila) throw new ErrorNoEncontrado('articulo', articuloId);
  return aSaldoStock(fila);
}

/** Listado general de articulos con su saldo resuelto en una sola consulta. */
function listarArticulosConStock(opciones: OpcionesListadoArticulos = {}): ArticuloConStock[] {
  const tipos = resolverTipos(opciones);
  return articulosRepositorio
    .listarConStock({
      soloActivos: opciones.soloActivos === true,
      ...(tipos === undefined ? {} : { tipos }),
    })
    .map(aArticuloConStock);
}

export const stockServicio = {
  registrarMovimiento,
  saldoActual,
  saldosPorGrupo,
  detalleStock,
  listarArticulosConStock,
};
