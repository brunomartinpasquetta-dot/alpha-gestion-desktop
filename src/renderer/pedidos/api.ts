/**
 * Cliente HTTP de la PWA de pedidos.
 *
 * Diferencias con el cliente del escritorio:
 *  - Manda el PIN en cada escritura (la superficie expuesta al tunel lo exige).
 *  - Cachea el catalogo en localStorage: si se abre la app sin conexion, los
 *    dropdowns se pueblan con la ultima foto conocida y el pedido igual se
 *    puede cargar (va a la cola offline).
 */

import type { ArticuloConStock, ClienteVista, EntradaNuevoPedido } from '../../compartido/contratos';

const CLAVE_PIN = 'alpha-pedidos-pin';
const CLAVE_NOMBRE = 'alpha-pedidos-nombre';
const CLAVE_CATALOGO = 'alpha-pedidos-catalogo';

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
export async function obtenerCatalogo(): Promise<{ catalogo: Catalogo; desdeCache: boolean }> {
  try {
    const [rProductos, rClientes] = await Promise.all([
      fetch('/api/articulos?grupo=productos&soloActivos=true'),
      fetch('/api/clientes'),
    ]);
    if (!rProductos.ok || !rClientes.ok) throw new Error('catalogo no disponible');

    const productos = ((await rProductos.json()) as { datos: ArticuloConStock[] }).datos;
    const clientes = ((await rClientes.json()) as { datos: ClienteVista[] }).datos;
    const catalogo: Catalogo = { productos, clientes, actualizadoEn: new Date().toISOString() };
    localStorage.setItem(CLAVE_CATALOGO, JSON.stringify(catalogo));
    return { catalogo, desdeCache: false };
  } catch (error) {
    const cache = catalogoCacheado();
    if (cache !== null) return { catalogo: cache, desdeCache: true };
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/* --------------------------------- Envio ----------------------------------- */

export type ResultadoEnvio = 'ok' | 'rechazado' | 'pin-invalido';

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
  return 'rechazado';
}
