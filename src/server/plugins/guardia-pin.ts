/**
 * Guardia de acceso desde la red.
 *
 * El servidor escucha en 0.0.0.0 para que el celular llegue a la PWA de pedidos,
 * y eso deja TODA la API visible para cualquiera en la misma red: sin este
 * guardia, un vecino del WiFi podia leer ventas, cuentas corrientes y stock
 * (deuda DEUDA-01 de la auditoria).
 *
 * Regla: si hay PIN configurado, cualquier request a /api que NO venga de la
 * maquina local exige el header `x-pin-pedidos`. Sin PIN configurado el sistema
 * queda como estaba, porque en la LAN de la fabrica es una decision del dueño;
 * antes de exponer el tunel a internet, el PIN es obligatorio.
 *
 * Unica excepcion: `/api/eventos` (SSE), porque EventSource no permite mandar
 * headers. El stream no transporta datos, solo el NOMBRE del evento
 * ('pedidos:cambio'), asi que saber que algo cambio no filtra nada del negocio.
 * `/health` y la PWA quedan afuera por no colgar de `/api/`.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { leerConfig } from '../config';

const RUTAS_LIBRES = ['/api/eventos'];

/**
 * Direcciones de la propia maquina: el renderer de Electron entra por aca.
 *
 * OJO con el tunel de Cloudflare que viene: el tunel termina en la maquina, asi
 * que sus requests llegan como loopback y este guardia las dejaria pasar. Por eso
 * `POST /api/pedidos` mantiene ADEMAS su propio chequeo de PIN sin excepcion de
 * origen (ver pedidos.rutas.ts): es el unico endpoint que hoy se expone afuera.
 * Cuando se monte el tunel hay que endurecer esto para toda la API.
 */
function esLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function registrarGuardiaPin(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, listo: () => void) => {
    const config = leerConfig();
    if (config.pinPedidos === undefined) return listo();

    const ruta = request.url.split('?')[0] ?? '';
    if (!ruta.startsWith('/api/')) return listo();
    if (RUTAS_LIBRES.some((libre) => ruta === libre || ruta.startsWith(`${libre}/`))) return listo();
    if (esLocal(request.ip)) return listo();

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
