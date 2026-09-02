/**
 * Cliente HTTP de la PWA de pedidos.
 *
 * Diferencias con el cliente del escritorio:
 *  - Manda el PIN en cada escritura (la superficie expuesta al tunel lo exige).
 *  - Cachea el catalogo en localStorage: si se abre la app sin conexion, los
 *    dropdowns se pueblan con la ultima foto conocida y el pedido igual se
 *    puede cargar (va a la cola offline).
 */

import type { ArticuloConStock, ClienteVista, EntradaNuevoPedido, PresentacionVista, VendedorVista } from '../../compartido/contratos';

const CLAVE_PIN = 'alpha-pedidos-pin';
const CLAVE_NOMBRE = 'alpha-pedidos-nombre';
// v2: el catalogo ahora incluye presentaciones y vendedores (talonario movil).
const CLAVE_CATALOGO = 'alpha-pedidos-catalogo-v2';

/* ------------------------------- Preferencias ------------------------------ */

export function leerPin(): string {
  return localStorage.getItem(CLAVE_PIN) ?? '';
}

export function guardarPin(pin: string): void {
  localStorage.setItem(CLAVE_PIN, pin);
}

export function leerNombre(): string {
  return localStorage.getItem(CLAVE_NOMBRE) ?? '';
}

export function guardarNombre(nombre: string): void {
  localStorage.setItem(CLAVE_NOMBRE, nombre);
}

/* --------------------------------- Catalogo -------------------------------- */

export interface Catalogo {
  readonly productos: ArticuloConStock[];
  readonly clientes: ClienteVista[];
  /** Catalogo de presentaciones para el talonario (cajas, docenas, bolsas). */
  readonly presentaciones: PresentacionVista[];
  /** Vendedores activos, para el desplegable del pedido. */
  readonly vendedores: VendedorVista[];
  /** ISO de la ultima actualizacion exitosa. */
  readonly actualizadoEn: string;
}

function catalogoCacheado(): Catalogo | null {
  try {
    const crudo = localStorage.getItem(CLAVE_CATALOGO);
    return crudo === null ? null : (JSON.parse(crudo) as Catalogo);
  } catch {
    return null;
  }
}

/**
 * Trae productos y clientes. Con red: pide, cachea y devuelve fresco. Sin red:
 * devuelve el cache si existe, con la marca de cuando fue. Sin red ni cache,
 * lanza: no hay con que armar el formulario.
 */
/** El servidor pidio PIN: hay conexion, falta autenticarse. */
export class ErrorPinRequerido extends Error {
  constructor() {
    super('Esta conexion necesita el PIN de acceso.');
  }
}

export async function obtenerCatalogo(): Promise<{ catalogo: Catalogo; desdeCache: boolean }> {
  try {
    // El PIN viaja tambien en las LECTURAS: desde la red, la API entera lo pide.
    const cabeceras = { 'x-pin-pedidos': leerPin() };
    const [rProductos, rClientes, rPresentaciones, rVendedores] = await Promise.all([
      fetch('/api/articulos?grupo=productos&soloActivos=true', { headers: cabeceras }),
      fetch('/api/clientes', { headers: cabeceras }),
      fetch('/api/presentaciones', { headers: cabeceras }),
      fetch('/api/vendedores', { headers: cabeceras }),
    ]);
    // 401 = hay conexion pero falta el PIN: se distingue para pedirlo, en vez
    // de mentir "sin conexion" (pasaba al entrar por el tunel desde afuera).
    if ([rProductos, rClientes, rPresentaciones, rVendedores].some((r) => r.status === 401)) {
      throw new ErrorPinRequerido();
    }
    if (!rProductos.ok || !rClientes.ok || !rPresentaciones.ok || !rVendedores.ok) {
      throw new Error('catalogo no disponible');
    }

    const productos = ((await rProductos.json()) as { datos: ArticuloConStock[] }).datos;
    const clientes = ((await rClientes.json()) as { datos: ClienteVista[] }).datos;
    const presentaciones = ((await rPresentaciones.json()) as { datos: PresentacionVista[] }).datos;
    const vendedores = ((await rVendedores.json()) as { datos: VendedorVista[] }).datos.filter((v) => v.activo);
    const catalogo: Catalogo = {
      productos,
      clientes,
      presentaciones,
      vendedores,
      actualizadoEn: new Date().toISOString(),
    };
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(catalogo));
    return { catalogo, desdeCache: false };
  } catch (error) {
    // Falta el PIN: NO se sirve el cache, hay que autenticarse primero.
    if (error instanceof ErrorPinRequerido) throw error;
    const cache = catalogoCacheado();
    if (cache !== null) return { catalogo: cache, desdeCache: true };
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/* --------------------------------- Envio ----------------------------------- */

export type ResultadoEnvio =
  | 'ok'
  /** El servidor lo rechazo por invalido: reintentarlo no cambia nada. */
  | 'rechazado'
  /** Falla transitoria (5xx / 429): el pedido se conserva y se reintenta. */
  | 'reintentar'
  | 'pin-invalido';

/**
 * Envia un pedido. Devuelve el resultado semantico; SOLO lanza ante fallo de
 * red, que es la señal que usa la cola offline para frenar la sincronizacion.
 */
export async function enviarPedido(pedido: EntradaNuevoPedido): Promise<ResultadoEnvio> {
  const respuesta = await fetch('/api/pedidos', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pin-pedidos': leerPin(),
    },
    body: JSON.stringify(pedido),
  });

  // 201 = creado; 200 = la clave de idempotencia ya se habia procesado (reintento).
  if (respuesta.status === 201 || respuesta.status === 200) return 'ok';
  if (respuesta.status === 401) return 'pin-invalido';
  /*
   * 5xx y 429 son TRANSITORIOS: la computadora de la fabrica esta apagada, el
   * tunel se cayo o el servidor esta saturado. Antes caian en 'rechazado' y el
   * pedido se BORRABA de la cola: el vendedor lo cargaba, la app le decia que
   * salio, y el pedido no llegaba nunca. Ahora se reintenta.
   */
  if (respuesta.status >= 500 || respuesta.status === 429) return 'reintentar';
  return 'rechazado';
}
