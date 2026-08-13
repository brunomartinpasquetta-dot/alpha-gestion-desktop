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

/**
 * Detecta si una request NO viene del escritorio de la propia maquina.
 *
 * No alcanza con mirar `request.ip`: cualquier tunel (Cloudflare, localhost.run,
 * ngrok) reenvia desde loopback y pareceria local. La senial confiable es el
 * HOST por el que entro: el escritorio y la LAN piden por IP o localhost; un
 * tunel siempre trae su dominio publico. Ademas se miran las cabeceras de
 * proxy, que refuerzan la deteccion cuando existen.
 */
function esRemota(request: FastifyRequest): boolean {
  const porCabecera =
    typeof request.headers['cf-connecting-ip'] === 'string' ||
    typeof request.headers['x-forwarded-for'] === 'string' ||
    typeof request.headers['x-real-ip'] === 'string' ||
    typeof request.headers['forwarded'] === 'string';
  if (porCabecera) return true;

  // Host sin puerto, en minusculas: "192.168.1.5", "localhost", "xxx.lhr.life".
  const host = (request.headers.host ?? '').toLowerCase().split(':')[0] ?? '';
  const esIpOLocal =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '[::1]' ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  // Un dominio (tiene letras y punto) SIEMPRE es acceso remoto por tunel.
  if (!esIpOLocal && host !== '') return true;

  return !esLocal(request.ip);
}

function estaPermitidaDesdeRed(metodo: string, ruta: string): boolean {
  return PERMITIDAS_DESDE_RED.some((regla) => regla.metodo === metodo && regla.ruta.test(ruta));
}

export function registrarGuardiaPin(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, listo: () => void) => {
    const ruta = request.url.split('?')[0] ?? '';
    if (!ruta.startsWith('/api/')) return listo();
    // Todo lo que no sea el escritorio de esta maquina pasa por la guardia.
    const remota = esRemota(request);
    const porTunel = remota && esLocal(request.ip);
    if (!remota) return listo();
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

    // Regla 2: PIN. En LAN es opcional (decision del duenio); por el TUNEL es
    // OBLIGATORIO: la fabrica no se publica abierta a internet.
    const config = leerConfig();
    if (config.pinPedidos === undefined) {
      if (!porTunel) return listo();
      return reply.status(401).send({
        error: {
          codigo: 'PIN_REQUERIDO',
          mensaje: 'El acceso remoto necesita un PIN. Configuralo en Archivo -> Configuracion LAN.',
        },
      });
    }
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
