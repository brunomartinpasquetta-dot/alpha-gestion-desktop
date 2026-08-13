/**
 * Guardia de acceso desde la red.
 *
 * El servidor escucha en 0.0.0.0 para que el celular llegue a la PWA de pedidos
 * y la tablet al monitor de elaboracion. Eso dejaba TODA la API visible para
 * cualquiera en la misma red (ventas, caja, respaldos, restauracion de la
 * base). Este guardia lo corta con DOS reglas:
 *
 *  1. LISTA BLANCA por origen: una request que NO viene de la propia maquina
 *     solo puede tocar lo que necesitan el celular (cargar y gestionar
 *     pedidos) y la tablet (el monitor de elaboracion). Todo lo demas es 403,
 *     haya PIN o no: el resto del sistema se opera desde el escritorio.
 *  2. PIN opcional: si hay PIN configurado, ademas de la lista blanca se exige
 *     el header `x-pin-pedidos` en cada request de red.
 *
 * Unica excepcion al PIN: `/api/eventos` (SSE), porque EventSource no permite
 * mandar headers. El stream no transporta datos, solo el NOMBRE del evento.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { leerConfig } from '../config';

const RUTAS_LIBRES = ['/api/eventos'];

/**
 * Lo UNICO que se puede hacer desde la red. Cargar pedidos, gestionarlos (ver,
 * editar, cancelar "por si se equivoca") y operar el monitor de elaboracion.
 * Las lecturas de catalogo son las que esas pantallas necesitan para armarse.
 */
const PERMITIDAS_DESDE_RED: readonly { metodo: string; ruta: RegExp }[] = [
  // Catalogo que necesitan la PWA y el monitor.
  { metodo: 'GET', ruta: /^\/api\/articulos(\?|$)/ },
  { metodo: 'GET', ruta: /^\/api\/clientes$/ },
  { metodo: 'GET', ruta: /^\/api\/presentaciones$/ },
  { metodo: 'GET', ruta: /^\/api\/vendedores$/ },
  // Pedidos: cargar y gestionar.
  { metodo: 'GET', ruta: /^\/api\/pedidos$/ },
  { metodo: 'POST', ruta: /^\/api\/pedidos$/ },
  { metodo: 'PUT', ruta: /^\/api\/pedidos\/\d+$/ },
  { metodo: 'PATCH', ruta: /^\/api\/pedidos\/\d+\/estado$/ },
  // Monitor de elaboracion (tablet).
  { metodo: 'GET', ruta: /^\/api\/produccion\/ordenes$/ },
  { metodo: 'PATCH', ruta: /^\/api\/produccion\/ordenes\/\d+\/estado$/ },
  // El asistente puede responder tambien en el celular o la tablet.
  { metodo: 'POST', ruta: /^\/api\/asistente$/ },
];

/** Direcciones de la propia maquina: el renderer de Electron entra por aca. */
function esLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function estaPermitidaDesdeRed(metodo: string, ruta: string): boolean {
  return PERMITIDAS_DESDE_RED.some((regla) => regla.metodo === metodo && regla.ruta.test(ruta));
}

export function registrarGuardiaPin(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, listo: () => void) => {
    const ruta = request.url.split('?')[0] ?? '';
    if (!ruta.startsWith('/api/')) return listo();
    if (esLocal(request.ip)) return listo();
    if (RUTAS_LIBRES.some((libre) => ruta === libre || ruta.startsWith(`${libre}/`))) return listo();

    // Regla 1: desde la red solo pedidos y monitor, sin importar el PIN.
    const rutaConQuery = request.url;
    if (!estaPermitidaDesdeRed(request.method, ruta) && !estaPermitidaDesdeRed(request.method, rutaConQuery)) {
      return reply.status(403).send({
        error: {
          codigo: 'SOLO_PEDIDOS_DESDE_RED',
          mensaje:
            'Desde la red solo se pueden cargar y gestionar pedidos (y el monitor de elaboracion). El resto del sistema se opera desde el escritorio.',
        },
      });
    }

    // Regla 2: PIN, si esta configurado.
    const config = leerConfig();
    if (config.pinPedidos === undefined) return listo();
    const pin = request.headers['x-pin-pedidos'];
    if (typeof pin === 'string' && pin === config.pinPedidos) return listo();

    reply.status(401).send({
      error: {
        codigo: 'PIN_INVALIDO',
        mensaje: 'Esta conexion viene de la red y necesita el PIN de acceso.',
      },
    });
  });
}
