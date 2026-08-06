/**
 * Cliente HTTP del renderer.
 *
 * Siempre se usan rutas RELATIVAS: en desarrollo el dev server de Vite proxea
 * /health y /api al Fastify embebido, y en produccion el renderer se sirve desde
 * el mismo origen. Asi no hay CORS ni URLs hardcodeadas segun el entorno.
 *
 * Sobre la validacion: se verifica la ENVOLTURA de cada respuesta (que sea JSON,
 * que traiga `datos`, y que sea lista u objeto segun corresponda) y se traduce
 * cualquier error del servidor a un Error con mensaje util. No se revalida campo
 * por campo: los tipos salen de `src/compartido/contratos.ts`, el mismo modulo
 * que compila el servidor, asi que un desajuste de forma es un error de
 * compilacion y no algo que descubrir en runtime. Lo que si puede pasar en
 * runtime —servidor caido, HTML de error, 4xx/5xx— esta contemplado.
 */

import type {
  ArticuloConStock,
  ChequeVista,
  EntradaNuevoCheque,
  EntradaNuevaVenta,
  ResultadoVenta,
  ResumenCartera,
  TrazabilidadLote,
  CajaMovimientoVista,
  CajaVista,
  ClienteVista,
  CompraVista,
  ErrorApi,
  Estadisticas,
  GrupoStock,
  ListaPrecioVista,
  MovimientoStockVista,
  OrdenProduccionVista,
  PedidoVista,
  ProveedorVista,
  RecetaVista,
  RespuestaSalud,
  ResumenCajaGeneral,
  ResumenCuentaCorriente,
  ResumenGeneral,
  UsuarioVista,
  SaldoStock,
  VentaVista,
} from '../../compartido/contratos';

function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function comoTexto(valor: unknown): string | null {
  return typeof valor === 'string' ? valor : null;
}

/** Reconoce el cuerpo estandar de error de la API. */
function comoErrorApi(cuerpo: unknown): ErrorApi | null {
  if (!esRegistro(cuerpo)) return null;
  const error = cuerpo['error'];
  if (!esRegistro(error)) return null;
  const codigo = comoTexto(error['codigo']);
  const mensaje = comoTexto(error['mensaje']);
  if (codigo === null || mensaje === null) return null;
  return { error: { codigo, mensaje, detalles: error['detalles'] } };
}

/**
 * Lee el cuerpo como JSON. Si no es JSON (HTML de error de un proxy, respuesta
 * vacia, etc.) lanza con el comienzo del texto, que suele decir que paso.
 */
async function leerJson(respuesta: Response, ruta: string): Promise<unknown> {
  const texto = await respuesta.text();
  if (texto.trim() === '') {
    throw new Error(`El servidor respondio con un cuerpo vacio en ${ruta} (estado ${respuesta.status}).`);
  }
  try {
    return JSON.parse(texto) as unknown;
  } catch {
    throw new Error(
      `El servidor devolvio una respuesta que no es JSON en ${ruta}. ` +
        `Verifica que el servidor este corriendo. Comienzo de la respuesta: ${texto.slice(0, 80)}`,
    );
  }
}

function errorDesdeRespuesta(ruta: string, respuesta: Response, cuerpo: unknown): Error {
  const apiError = comoErrorApi(cuerpo);
  if (apiError !== null) return new Error(`${apiError.error.mensaje} (${apiError.error.codigo})`);
  return new Error(`El servidor respondio ${respuesta.status} en ${ruta}.`);
}

/** GET que devuelve el contenido de `datos` como lista. */
async function pedirLista<T>(ruta: string): Promise<T[]> {
  const respuesta = await fetch(ruta);
  const cuerpo = await leerJson(respuesta, ruta);

  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
  if (!esRegistro(cuerpo) || !Array.isArray(cuerpo['datos'])) {
    throw new Error(`Respuesta inesperada en ${ruta}: se esperaba una lista en "datos".`);
  }
  return cuerpo['datos'] as T[];
}

/** GET que devuelve el contenido de `datos` como objeto. */
async function pedirItem<T>(ruta: string): Promise<T> {
  const respuesta = await fetch(ruta);
  const cuerpo = await leerJson(respuesta, ruta);

  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
  if (!esRegistro(cuerpo) || !esRegistro(cuerpo['datos'])) {
    throw new Error(`Respuesta inesperada en ${ruta}: se esperaba un objeto en "datos".`);
  }
  return cuerpo['datos'] as T;
}

/**
 * Salud del servidor. Es el unico endpoint que NO lanza ante un estado de error:
 * un 503 con cuerpo de salud valido es informacion util (la base esta caida) y la
 * barra de estado la tiene que poder mostrar.
 */
export async function obtenerSalud(): Promise<RespuestaSalud> {
  const respuesta = await fetch('/health');
  const cuerpo = await leerJson(respuesta, '/health');

  if (esRegistro(cuerpo) && typeof cuerpo['ok'] === 'boolean' && esRegistro(cuerpo['db'])) {
    return cuerpo as unknown as RespuestaSalud;
  }
  throw errorDesdeRespuesta('/health', respuesta, cuerpo);
}

export const obtenerResumen = (): Promise<ResumenGeneral> => pedirItem<ResumenGeneral>('/api/resumen');

export const obtenerArticulos = (): Promise<ArticuloConStock[]> =>
  pedirLista<ArticuloConStock>('/api/articulos');

export const obtenerStock = (grupo: GrupoStock): Promise<SaldoStock[]> =>
  pedirLista<SaldoStock>(`/api/stock?grupo=${grupo}`);

export const obtenerMovimientosDeArticulo = (articuloId: number): Promise<MovimientoStockVista[]> =>
  pedirLista<MovimientoStockVista>(`/api/articulos/${articuloId}/movimientos`);

export const obtenerRecetas = (): Promise<RecetaVista[]> => pedirLista<RecetaVista>('/api/recetas');

export const obtenerOrdenesProduccion = (): Promise<OrdenProduccionVista[]> =>
  pedirLista<OrdenProduccionVista>('/api/produccion/ordenes');

export const obtenerPedidos = (): Promise<PedidoVista[]> => pedirLista<PedidoVista>('/api/pedidos');

export const obtenerVentas = (): Promise<VentaVista[]> => pedirLista<VentaVista>('/api/ventas');

export const obtenerCompras = (): Promise<CompraVista[]> => pedirLista<CompraVista>('/api/compras');

export const obtenerCajas = (): Promise<CajaVista[]> => pedirLista<CajaVista>('/api/caja/cajas');

export const obtenerMovimientosCaja = (cajaId: number): Promise<CajaMovimientoVista[]> =>
  pedirLista<CajaMovimientoVista>(`/api/caja/movimientos?cajaId=${cajaId}`);

export const obtenerCuentasCorrientes = (): Promise<ResumenCuentaCorriente[]> =>
  pedirLista<ResumenCuentaCorriente>('/api/cuentas-corrientes');

export const obtenerClientes = (): Promise<ClienteVista[]> => pedirLista<ClienteVista>('/api/clientes');

export const obtenerProveedores = (): Promise<ProveedorVista[]> =>
  pedirLista<ProveedorVista>('/api/proveedores');

export const obtenerListasPrecio = (): Promise<ListaPrecioVista[]> =>
  pedirLista<ListaPrecioVista>('/api/listas-precio');

export const obtenerCajaGeneral = (): Promise<ResumenCajaGeneral> =>
  pedirItem<ResumenCajaGeneral>('/api/caja/general');

export const obtenerEstadisticas = (): Promise<Estadisticas> =>
  pedirItem<Estadisticas>('/api/estadisticas');

export const obtenerUsuarios = (): Promise<UsuarioVista[]> => pedirLista<UsuarioVista>('/api/usuarios');

/** Aplica una transicion de estado a un pedido. Lanza con el mensaje del servidor si es invalida. */
export async function cambiarEstadoPedido(pedidoId: number, estado: string): Promise<void> {
  const ruta = `/api/pedidos/${pedidoId}/estado`;
  const respuesta = await fetch(ruta, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
}

/* ----------------------- Produccion, trazabilidad, cheques ------------------ */

export async function cambiarEstadoOrden(
  ordenId: number,
  estado: string,
  rindeReal?: number | null,
): Promise<string[]> {
  const ruta = `/api/produccion/ordenes/${ordenId}/estado`;
  const respuesta = await fetch(ruta, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rindeReal === undefined ? { estado } : { estado, rindeReal }),
  });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
  const datos = (cuerpo as { datos?: { advertencias?: string[] } }).datos;
  return datos?.advertencias ?? [];
}

export const obtenerTrazabilidad = (lote: string): Promise<TrazabilidadLote> =>
  pedirItem<TrazabilidadLote>(`/api/trazabilidad/${encodeURIComponent(lote)}`);

export const obtenerCheques = (): Promise<ChequeVista[]> => pedirLista<ChequeVista>('/api/cheques');

export const obtenerResumenCartera = (): Promise<ResumenCartera> =>
  pedirItem<ResumenCartera>('/api/cheques/resumen');

export async function crearCheque(entrada: EntradaNuevoCheque): Promise<void> {
  const respuesta = await fetch('/api/cheques', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entrada),
  });
  const cuerpo = await leerJson(respuesta, '/api/cheques');
  if (!respuesta.ok) throw errorDesdeRespuesta('/api/cheques', respuesta, cuerpo);
}

export async function cambiarEstadoCheque(chequeId: number, estado: string): Promise<void> {
  const ruta = `/api/cheques/${chequeId}/estado`;
  const respuesta = await fetch(ruta, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ estado }),
  });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
}

export async function crearVenta(entrada: EntradaNuevaVenta): Promise<ResultadoVenta> {
  const respuesta = await fetch('/api/ventas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entrada),
  });
  const cuerpo = await leerJson(respuesta, '/api/ventas');
  if (!respuesta.ok) throw errorDesdeRespuesta('/api/ventas', respuesta, cuerpo);
  return (cuerpo as { datos: ResultadoVenta }).datos;
}

export async function anularVenta(ventaId: number): Promise<ResultadoVenta> {
  const ruta = `/api/ventas/${ventaId}/anular`;
  const respuesta = await fetch(ruta, { method: 'PATCH' });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
  return (cuerpo as { datos: ResultadoVenta }).datos;
}
