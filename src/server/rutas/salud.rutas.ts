/**
 * Endpoint de salud. Lo consulta el proceso main de Electron antes de mostrar la
 * ventana, y sirve de diagnostico rapido cuando algo anda mal en la maquina del
 * cliente: dice que version corre, contra que archivo .db y cuantas tablas ve.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import os from 'node:os';

import { VERSION_APP } from '../../compartido/config';
// La forma de la respuesta vive en el contrato compartido con el renderer:
// un desajuste aca es un error de compilacion, no una sorpresa en runtime.
import type { RespuestaSalud } from '../../compartido/contratos';
import { leerConfig } from '../config';
import { verificarSaludDb } from '../db/conexion';

type SaludDb = RespuestaSalud['db'];

/**
 * Primera IPv4 no interna de la maquina, o null si no hay red. Es la direccion
 * que el celular usa para llegar a la PWA dentro de la misma WiFi.
 */
function ipLan(): string | null {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const red of interfaces ?? []) {
      if (red.family === 'IPv4' && !red.internal) return red.address;
    }
  }
  return null;
}

export function registrarRutasSalud(app: FastifyInstance): void {
  app.get('/health', (_request: FastifyRequest, reply: FastifyReply) => {
    const config = leerConfig();
    const salud = verificarSaludDb();

    const db: SaludDb =
      salud.error === undefined
        ? { ok: salud.ok, rutaDb: salud.rutaDb, tablas: salud.tablas }
        : { ok: salud.ok, rutaDb: salud.rutaDb, tablas: salud.tablas, error: salud.error };

    // La URL del celular solo existe si el servidor escucha mas alla de loopback.
    const ip = config.host === '127.0.0.1' || config.host === 'localhost' ? null : ipLan();

    const cuerpo: RespuestaSalud = {
      ok: salud.ok,
      version: VERSION_APP,
      entorno: config.esDesarrollo ? 'desarrollo' : 'produccion',
      db,
      urlPedidos: ip === null ? null : `http://${ip}:${config.puerto}/pedidos`,
    };

    // Si la base no responde, el servidor esta arriba pero el sistema no sirve: 503.
    return reply.status(salud.ok ? 200 : 503).send(cuerpo);
  });
}
