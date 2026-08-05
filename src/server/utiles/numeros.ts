/**
 * Utilidades numericas centralizadas.
 *
 * Reglas del producto:
 *  - DINERO: siempre INTEGER en centavos. Nunca punto flotante para importes.
 *  - CANTIDADES: REAL, pero SIEMPRE redondeadas con `redondearCantidad` antes de
 *    persistir o comparar, para evitar drift de punto flotante acumulado
 *    (ej: 0.1 + 0.2 = 0.30000000000000004).
 */

/** Decimales significativos para cantidades de stock/recetas. */
export const DECIMALES_CANTIDAD = 4;

/** Tolerancia por debajo de la cual una cantidad se considera cero. */
export const EPSILON_CANTIDAD = 1e-9;

/** Redondea a `decimales` posiciones evitando el sesgo de toFixed sobre binarios. */
export function redondear(valor: number, decimales: number): number {
  if (!Number.isFinite(valor)) return 0;
  const factor = 10 ** decimales;
  // El +Number.EPSILON corrige casos como 1.005 que en binario cae apenas por debajo.
  return Math.round((valor + Number.EPSILON * Math.sign(valor)) * factor) / factor;
}

/** Redondeo canonico de cantidades de stock, recetas y produccion. */
export function redondearCantidad(valor: number): number {
  return redondear(valor, DECIMALES_CANTIDAD);
}

/** Suma una lista de cantidades redondeando el resultado una sola vez al final. */
export function sumarCantidades(valores: readonly number[]): number {
  let total = 0;
  for (const valor of valores) total += valor;
  return redondearCantidad(total);
}

/** True si la cantidad es cero dentro de la tolerancia de punto flotante. */
export function esCantidadCero(valor: number): boolean {
  return Math.abs(valor) < EPSILON_CANTIDAD;
}

/* --------------------------------- Dinero -------------------------------- */

/** Convierte pesos (numero con decimales) a centavos enteros. Solo para entrada de datos. */
export function aCentavos(pesos: number): number {
  if (!Number.isFinite(pesos)) return 0;
  return Math.round(pesos * 100);
}

/** Convierte centavos a pesos. Solo para display; nunca para persistir. */
export function aPesos(centavos: number): number {
  return redondear(centavos / 100, 2);
}

/**
 * Multiplica un precio unitario en centavos por una cantidad REAL y devuelve
 * centavos enteros. Es el unico camino permitido para calcular subtotales.
 */
export function calcularSubtotalCentavos(precioUnitarioCentavos: number, cantidad: number): number {
  return Math.round(precioUnitarioCentavos * cantidad);
}

/** Valida que un importe sea un entero de centavos no negativo. */
export function esCentavosValido(valor: number): boolean {
  return Number.isInteger(valor) && valor >= 0;
}
