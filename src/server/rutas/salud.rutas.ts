/**
 * Endpoint de salud. Lo consulta el proceso main de Electron antes de mostrar la
 * ventana, y sirve de diagnostico rapido cuando algo anda mal en la maquina del
 * cliente: dice que version corre, contra que archivo .db y cuantas tablas ve.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { VERSION_APP } from '../../compartido/config';
import { leerConfig } from '../config';
import { verificarSaludDb } from '../db/conexion';

export interface SaludDb {
  readonly ok: boolean;
  readonly rutaDb: string;
  readonly tablas: number;
  readonly error?: string;
}

export interface RespuestaSalud {
  readonly ok: boolean;
  readonly version: string;
  readonly entorno: 'desarrollo' | 'produccion';
  readonly db: SaludDb;
}

export function registrarRutasSalud(app: FastifyInstance): void {
  app.get('/health', (_request: FastifyRequest, reply: FastifyReply) => {
    const config = leerConfig();
    const salud = verificarSaludDb();

    const db: SaludDb =
      salud.error === undefined
        ? { ok: salud.ok, rutaDb: salud.rutaDb, tablas: salud.tablas }
        : { ok: salud.ok, rutaDb: salud.rutaDb, tablas: salud.tablas, error: salud.error };

    const cuerpo: RespuestaSalud = {
      ok: salud.ok,
      version: VERSION_APP,
      entorno: config.esDesarrollo ? 'desarrollo' : 'produccion',
      db,
    };

    // Si la base no responde, el servidor esta arriba pero el sistema no sirve: 503.
    return reply.status(salud.ok ? 200 : 503).send(cuerpo);
  });
}
