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
  EntradaArticulo,
  EntradaCierreCaja,
  EntradaCliente,
  EntradaCobroPago,
  EntradaMovimientoCaja,
  EntradaNuevaCompra,
  EntradaNuevaOrden,
  EntradaNuevoPedido,
  EntradaProveedor,
  EntradaUsuario,
  EntradaAjusteStock,
  EntradaListaPrecio,
  EntradaPrecio,
  EntradaReceta,
  ResultadoAjuste,
  ComprobanteImprimible,
  DatosExistentes,
  EntradaActualizacionPrecios,
  FamiliaVista,
  LineaReposicion,
  LotePrecio,
  PrecioDeArticulo,
  VistaPreviaPrecio,
  ResultadoInicializacion,
  ResultadoCobroPago,
  ResultadoCompra,
  UnidadMedidaVista,
  ChequeVista,
  ConfiguracionFiscalVista,
  EntradaConfiguracionFiscal,
  EntradaNuevoCheque,
  EntradaNuevaVenta,
  ResultadoPruebaArca,
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

export const obtenerUnidades = (): Promise<UnidadMedidaVista[]> =>
  pedirLista<UnidadMedidaVista>('/api/unidades');

export const obtenerComprobante = (ventaId: number): Promise<ComprobanteImprimible> =>
  pedirItem<ComprobanteImprimible>(`/api/ventas/${ventaId}/comprobante`);

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

/* ------------------------------ Fiscal / ARCA ----------------------------- */

export const obtenerConfigFiscal = (): Promise<ConfiguracionFiscalVista> =>
  pedirItem<ConfiguracionFiscalVista>('/api/fiscal/config');

export async function guardarConfigFiscal(
  entrada: EntradaConfiguracionFiscal,
): Promise<ConfiguracionFiscalVista> {
  const respuesta = await fetch('/api/fiscal/config', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entrada),
  });
  const cuerpo = await leerJson(respuesta, '/api/fiscal/config');
  if (!respuesta.ok) throw errorDesdeRespuesta('/api/fiscal/config', respuesta, cuerpo);
  return (cuerpo as { datos: ConfiguracionFiscalVista }).datos;
}

export async function probarConexionArca(): Promise<ResultadoPruebaArca> {
  const respuesta = await fetch('/api/fiscal/probar', { method: 'POST' });
  const cuerpo = await leerJson(respuesta, '/api/fiscal/probar');
  if (!respuesta.ok) throw errorDesdeRespuesta('/api/fiscal/probar', respuesta, cuerpo);
  return (cuerpo as { datos: ResultadoPruebaArca }).datos;
}

export async function anularVenta(ventaId: number): Promise<ResultadoVenta> {
  const ruta = `/api/ventas/${ventaId}/anular`;
  const respuesta = await fetch(ruta, { method: 'PATCH' });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
  return (cuerpo as { datos: ResultadoVenta }).datos;
}

/* ======================= ESCRITURA: maestros y operacion ================== */

/**
 * Envia un cuerpo JSON y devuelve `datos`, traduciendo el error del servidor.
 *
 * Cuando NO hay cuerpo tampoco se manda el content-type: Fastify rechaza con
 * 400 una peticion que se declara JSON y llega vacia. Eso rompia en silencio
 * las acciones sin cuerpo —anular una compra, deshacer una actualizacion de
 * precios—: el boton confirmaba y no pasaba nada.
 */
async function enviar<T>(ruta: string, metodo: 'POST' | 'PUT' | 'PATCH', cuerpo?: unknown): Promise<T> {
  const respuesta = await fetch(ruta, {
    method: metodo,
    ...(cuerpo === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) }),
  });
  const datos = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, datos);
  return (datos as { datos: T }).datos;
}

/* -------------------------------- Maestros -------------------------------- */

export const crearCliente = (entrada: EntradaCliente): Promise<ClienteVista> =>
  enviar<ClienteVista>('/api/clientes', 'POST', entrada);

export const actualizarCliente = (id: number, entrada: EntradaCliente): Promise<ClienteVista> =>
  enviar<ClienteVista>(`/api/clientes/${id}`, 'PUT', entrada);

export const cambiarActivoCliente = (id: number, activo: boolean): Promise<ClienteVista> =>
  enviar<ClienteVista>(`/api/clientes/${id}/activo`, 'PATCH', { activo });

export const crearProveedor = (entrada: EntradaProveedor): Promise<ProveedorVista> =>
  enviar<ProveedorVista>('/api/proveedores', 'POST', entrada);

export const actualizarProveedor = (id: number, entrada: EntradaProveedor): Promise<ProveedorVista> =>
  enviar<ProveedorVista>(`/api/proveedores/${id}`, 'PUT', entrada);

export const cambiarActivoProveedor = (id: number, activo: boolean): Promise<ProveedorVista> =>
  enviar<ProveedorVista>(`/api/proveedores/${id}/activo`, 'PATCH', { activo });

export const crearArticulo = (entrada: EntradaArticulo): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/articulos', 'POST', entrada);

export const actualizarArticulo = (id: number, entrada: EntradaArticulo): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/articulos/${id}`, 'PUT', entrada);

export const cambiarActivoArticulo = (id: number, activo: boolean): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/articulos/${id}/activo`, 'PATCH', { activo });

/* --------------------------------- Compras -------------------------------- */

export const crearCompra = (entrada: EntradaNuevaCompra): Promise<ResultadoCompra> =>
  enviar<ResultadoCompra>('/api/compras', 'POST', entrada);

export const anularCompra = (id: number): Promise<ResultadoCompra> =>
  enviar<ResultadoCompra>(`/api/compras/${id}/anular`, 'PATCH');

/* -------------------------------- Tesoreria ------------------------------- */

export const abrirCaja = (montoApertura: number, usuario?: string | null): Promise<CajaVista> =>
  enviar<CajaVista>('/api/caja/abrir', 'POST', { montoApertura, usuario: usuario ?? null });

export const cerrarCaja = (id: number, entrada: EntradaCierreCaja): Promise<CajaVista> =>
  enviar<CajaVista>(`/api/caja/${id}/cerrar`, 'PATCH', entrada);

export const registrarMovimientoCaja = (entrada: EntradaMovimientoCaja): Promise<CajaVista> =>
  enviar<CajaVista>('/api/caja/movimientos', 'POST', entrada);

export const registrarCobroPago = (entrada: EntradaCobroPago): Promise<ResultadoCobroPago> =>
  enviar<ResultadoCobroPago>('/api/cuentas-corrientes/movimientos', 'POST', entrada);

/* ------------------------------- Produccion ------------------------------- */

export const crearOrdenProduccion = (entrada: EntradaNuevaOrden): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/produccion/ordenes', 'POST', entrada);

/* ------------------- Ajustes de stock, recetas y precios ------------------ */

export const ajustarStock = (entrada: EntradaAjusteStock): Promise<ResultadoAjuste> =>
  enviar<ResultadoAjuste>('/api/stock/ajustes', 'POST', entrada);

export const crearReceta = (entrada: EntradaReceta): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/recetas', 'POST', entrada);

export const actualizarReceta = (id: number, entrada: EntradaReceta): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/recetas/${id}`, 'PUT', entrada);

export const cambiarActivaReceta = (id: number, activo: boolean): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/recetas/${id}/activa`, 'PATCH', { activo });

export const crearListaPrecio = (entrada: EntradaListaPrecio): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/listas-precio', 'POST', entrada);

export const fijarPrecio = (entrada: EntradaPrecio): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/listas-precio/precios', 'POST', entrada);

export const actualizarListaPrecio = (
  id: number,
  nombre: string,
  activa: boolean,
): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/listas-precio/${id}`, 'PUT', { nombre, activa });

export async function borrarPrecio(precioId: number): Promise<void> {
  const ruta = `/api/listas-precio/precios/${precioId}`;
  const respuesta = await fetch(ruta, { method: 'DELETE' });
  const cuerpo = await leerJson(respuesta, ruta);
  if (!respuesta.ok) throw errorDesdeRespuesta(ruta, respuesta, cuerpo);
}

/* --------------------- Arranque con los datos del cliente ----------------- */

export const obtenerDatosDemo = (): Promise<DatosExistentes[]> =>
  pedirLista<DatosExistentes>('/api/sistema/datos-demo');

export const empezarDeCero = (confirmacion: string): Promise<ResultadoInicializacion> =>
  enviar<ResultadoInicializacion>('/api/sistema/empezar-de-cero', 'POST', { confirmacion });

/* -------------------------------- Usuarios -------------------------------- */

export const crearUsuario = (entrada: EntradaUsuario): Promise<UsuarioVista> =>
  enviar<UsuarioVista>('/api/usuarios', 'POST', entrada);

export const actualizarUsuario = (id: number, entrada: EntradaUsuario): Promise<UsuarioVista> =>
  enviar<UsuarioVista>(`/api/usuarios/${id}`, 'PUT', entrada);

export const cambiarActivoUsuario = (id: number, activo: boolean): Promise<UsuarioVista> =>
  enviar<UsuarioVista>(`/api/usuarios/${id}/activo`, 'PATCH', { activo });

/* --------------------------------- Pedidos -------------------------------- */

export const crearPedido = (entrada: EntradaNuevoPedido): Promise<PedidoVista> =>
  enviar<PedidoVista>('/api/pedidos', 'POST', entrada);

export const actualizarPedido = (id: number, entrada: EntradaNuevoPedido): Promise<{ id: number }> =>
  enviar<{ id: number }>(`/api/pedidos/${id}`, 'PUT', entrada);

/* -------------------------------- Familias -------------------------------- */

export const obtenerFamilias = (): Promise<FamiliaVista[]> =>
  pedirLista<FamiliaVista>('/api/familias');

export const crearFamilia = (nombre: string, padreId?: number | null): Promise<{ id: number }> =>
  enviar<{ id: number }>('/api/familias', 'POST', { nombre, padreId: padreId ?? null });

export const obtenerPreciosDeArticulo = (articuloId: number): Promise<PrecioDeArticulo[]> =>
  pedirLista<PrecioDeArticulo>(`/api/articulos/${articuloId}/precios`);

export const fijarPreciosDeArticulo = (
  articuloId: number,
  precios: readonly { listaPrecioId: number; precio: number }[],
): Promise<{ cambiados: number }> =>
  enviar<{ cambiados: number }>(`/api/articulos/${articuloId}/precios`, 'PUT', { precios });

/* ---------------- Actualizacion masiva de precios y reposicion ------------- */

export const vistaPreviaPrecios = (
  entrada: EntradaActualizacionPrecios,
): Promise<VistaPreviaPrecio[]> => {
  return fetch('/api/precios/vista-previa', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(entrada),
  })
    .then(async (r) => {
      const cuerpo = await leerJson(r, '/api/precios/vista-previa');
      if (!r.ok) throw errorDesdeRespuesta('/api/precios/vista-previa', r, cuerpo);
      return (cuerpo as { datos: VistaPreviaPrecio[] }).datos;
    });
};

export const aplicarPrecios = (entrada: EntradaActualizacionPrecios): Promise<{ actualizados: number }> =>
  enviar<{ actualizados: number }>('/api/precios/aplicar', 'POST', entrada);

export const obtenerReposicion = (criterio: 'minimo' | 'ideal'): Promise<LineaReposicion[]> =>
  pedirLista<LineaReposicion>(`/api/reposicion?criterio=${criterio}`);

export const obtenerLotesPrecio = (): Promise<LotePrecio[]> =>
  pedirLista<LotePrecio>('/api/precios/lotes');

export const revertirLotePrecio = (id: number): Promise<{ revertidos: number }> =>
  enviar<{ revertidos: number }>(`/api/precios/lotes/${id}/revertir`, 'POST');
