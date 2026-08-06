/**
 * Formateo unico para toda la interfaz.
 *
 * Reglas del producto:
 *  - Los importes viajan en CENTAVOS y se convierten a pesos SOLO al mostrarse.
 *  - Las fechas viajan como texto ISO-8601 en UTC y se muestran en hora local.
 *  - Un dato ausente nunca se muestra vacio: siempre se ve el guion largo.
 *
 * Los objetos Intl se crean una sola vez: instanciarlos por celda es caro y en
 * este ERP se pintan miles de celdas por pantalla.
 */

/** Marcador visible para valores nulos. Evita celdas vacias ambiguas. */
export const SIN_DATO = '—';

const formateadorMoneda = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
});

/** Cantidades en unidad base: kg, litros, unidades. Hasta 3 decimales. */
const formateadorCantidad = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const formateadorEntero = new Intl.NumberFormat('es-AR', {
  maximumFractionDigits: 0,
});

const formateadorFecha = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const formateadorFechaHora = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function esNumeroUtil(valor: number | null | undefined): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

/** Convierte centavos a pesos y los formatea como moneda argentina. */
export function formatearMoneda(centavos: number | null | undefined): string {
  if (!esNumeroUtil(centavos)) return SIN_DATO;
  return formateadorMoneda.format(centavos / 100);
}

/** Igual que `formatearMoneda`, pero con signo explicito (util en la caja). */
export function formatearMonedaConSigno(centavos: number | null | undefined): string {
  if (!esNumeroUtil(centavos)) return SIN_DATO;
  const texto = formatearMoneda(Math.abs(centavos));
  if (centavos === 0) return texto;
  return `${centavos > 0 ? '+' : '-'} ${texto}`;
}

/** Cantidad en la unidad base del articulo. */
export function formatearCantidad(valor: number | null | undefined): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  return formateadorCantidad.format(valor);
}

/** Cantidad con signo: el ledger necesita distinguir entradas de salidas. */
export function formatearCantidadConSigno(valor: number | null | undefined): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  if (valor === 0) return formateadorCantidad.format(0);
  const signo = valor > 0 ? '+' : '-';
  return `${signo}${formateadorCantidad.format(Math.abs(valor))}`;
}

/** Cantidad seguida de la abreviatura de la unidad. */
export function formatearCantidadConUnidad(
  valor: number | null | undefined,
  unidad: string | null,
): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  const cantidad = formateadorCantidad.format(valor);
  return unidad === null || unidad === '' ? cantidad : `${cantidad} ${unidad}`;
}

/** Conteos y otros enteros. */
export function formatearEntero(valor: number | null | undefined): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  return formateadorEntero.format(valor);
}

/** Porcentaje ya expresado en unidades de 0 a 100 (como la merma de receta). */
export function formatearPorcentaje(valor: number | null | undefined): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  return `${formateadorCantidad.format(valor)} %`;
}

/** Factor de escala de una orden de produccion (x1,5). */
export function formatearFactor(valor: number | null | undefined): string {
  if (!esNumeroUtil(valor)) return SIN_DATO;
  return `x${formateadorCantidad.format(valor)}`;
}

function comoFecha(iso: string | null | undefined): Date | null {
  if (typeof iso !== 'string' || iso.trim() === '') return null;
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/** Fecha corta dd/mm/aaaa. */
export function formatearFecha(iso: string | null | undefined): string {
  const fecha = comoFecha(iso);
  return fecha === null ? SIN_DATO : formateadorFecha.format(fecha);
}

/** Fecha con hora dd/mm/aaaa hh:mm. Para movimientos y aperturas de caja. */
export function formatearFechaHora(iso: string | null | undefined): string {
  const fecha = comoFecha(iso);
  return fecha === null ? SIN_DATO : formateadorFechaHora.format(fecha);
}

/** Texto opcional: devuelve el guion cuando esta vacio o ausente. */
export function formatearTexto(valor: string | null | undefined): string {
  if (typeof valor !== 'string') return SIN_DATO;
  const limpio = valor.trim();
  return limpio === '' ? SIN_DATO : limpio;
}

/** Pluraliza en castellano un conteo simple: "3 pedidos", "1 pedido". */
export function pluralizar(cantidad: number, singular: string, plural: string): string {
  return `${formatearEntero(cantidad)} ${cantidad === 1 ? singular : plural}`;
}

/**
 * Presenta un stock en cajas cerradas: "4 cajas + 3 u", "5 cajas", "7 u".
 * Los clientes piden por caja cerrada; el resto es resto.
 */
export function formatearCajas(unidades: number, unidadesPorCaja: number | null): string {
  if (unidadesPorCaja === null || unidadesPorCaja <= 0) return SIN_DATO;
  const cajas = Math.floor(unidades / unidadesPorCaja);
  const resto = Math.round(unidades - cajas * unidadesPorCaja);
  if (cajas === 0) return `${formatearEntero(resto)} u`;
  const base = `${formatearEntero(cajas)} ${cajas === 1 ? 'caja' : 'cajas'}`;
  return resto === 0 ? base : `${base} + ${formatearEntero(resto)} u`;
}

/** Convierte pesos (con decimales) a centavos enteros, para enviar al servidor. */
export function aCentavos(pesos: number): number {
  if (!Number.isFinite(pesos)) return 0;
  return Math.round(pesos * 100);
}
