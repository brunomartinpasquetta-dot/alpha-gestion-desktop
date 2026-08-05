/**
 * Bootstrap del servidor Fastify embebido.
 *
 * Este modulo NO conoce Electron: corre igual en un proceso Node pelado, lo que
 * permite probarlo con un script suelto o exponerlo despues como servicio para
 * la PWA de pedidos sin tocar una linea.
 */

import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { leerConfig, type ConfigServidor } from './config';
import { registrarEstaticos } from './plugins/estaticos';
import { registrarManejadorErrores } from './plugins/manejador-errores';
import { registrarRutas } from './rutas';

export interface OpcionesServidor {
  readonly puerto?: number;
  readonly host?: string;
  /**
   * Carpeta del renderer compilado. `null` desactiva el servido de estaticos
   * (modo desarrollo, donde el renderer lo sirve Vite). Si se omite, se usa
   * `dist/renderer` relativo a este archivo compilado.
   */
  readonly carpetaEstaticos?: string | null;
}

export interface ServidorEnMarcha {
  readonly url: string;
  readonly puerto: number;
  readonly host: string;
  cerrar(): Promise<void>;
}

/**
 * Cuantos puertos consecutivos probamos si el elegido esta ocupado. Un ERP de
 * escritorio no puede negarse a arrancar porque quedo un proceso zombie de la
 * corrida anterior tomando el 4600.
 */
const MAX_INTENTOS_PUERTO = 10;

/** Carpeta por defecto del renderer compilado, relativa al JS ya buildeado. */
function carpetaEstaticosPorDefecto(): string {
  // En runtime este archivo vive en dist/server/servidor.js -> dist/renderer.
  return path.resolve(__dirname, '..', 'renderer');
}

interface TransportePino {
  readonly target: string;
  readonly options: Record<string, unknown>;
}

/**
 * Usamos pino-pretty solo si esta instalado. Hoy no lo esta y no vamos a sumar
 * dependencias por estetica de logs: en ese caso queda el JSON por defecto.
 */
function transportePretty(): TransportePino | undefined {
  try {
    require.resolve('pino-pretty');
    return {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  } catch {
    return undefined;
  }
}

function construirOpcionesLogger(config: ConfigServidor): FastifyServerOptions['logger'] {
  const transport = config.esDesarrollo ? transportePretty() : undefined;
  if (transport === undefined) return { level: config.nivelLog };
  return { level: config.nivelLog, transport };
}

/**
 * Construye la instancia de Fastify con errores, rutas y estaticos ya montados,
 * pero sin escuchar todavia. Util para tests y para inyectar peticiones.
 */
export function crearServidor(opciones: OpcionesServidor = {}): FastifyInstance {
  const config = leerConfig();

  const app = Fastify({
    logger: construirOpcionesLogger(config),
    // El renderer local es el unico cliente: no necesitamos confiar en proxies.
    trustProxy: false,
  });
  // El log por request sale en nivel `info`: en produccion el nivel es `warn`,
  // asi que se apaga solo sin necesidad de la opcion `disableRequestLogging`
  // (deprecada en Fastify 5 y removida en la 6).

  // Primero los manejadores de error: si algo falla al registrar rutas, ya hay red.
  registrarManejadorErrores(app);
  registrarRutas(app);

  const carpeta =
    opciones.carpetaEstaticos === undefined
      ? carpetaEstaticosPorDefecto()
      : opciones.carpetaEstaticos;

  if (carpeta === null) {
    app.log.info('Servido de estaticos desactivado: el renderer lo sirve Vite.');
  } else {
    registrarEstaticos(app, carpeta);
  }

  return app;
}

/** True si el fallo de `listen` es por puerto ocupado. */
function esPuertoOcupado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  return (error as { code?: unknown }).code === 'EADDRINUSE';
}

/**
 * Levanta el servidor. Si el puerto esta ocupado prueba con el siguiente hasta
 * MAX_INTENTOS_PUERTO veces y devuelve el puerto en el que efectivamente quedo
 * escuchando: el proceso main lee ese valor para armar la URL de la ventana.
 */
export async function iniciarServidor(opciones: OpcionesServidor = {}): Promise<ServidorEnMarcha> {
  const config = leerConfig();
  const puertoInicial = opciones.puerto ?? config.puerto;
  const host = opciones.host ?? config.host;

  let ultimoError: unknown;

  for (let intento = 0; intento < MAX_INTENTOS_PUERTO; intento += 1) {
    const puerto = puertoInicial + intento;
    // Instancia nueva por intento: un `listen` fallido deja la anterior inservible.
    const app = crearServidor(opciones);

    try {
      await app.listen({ port: puerto, host });
      // La ventana de Electron necesita una URL navegable: 0.0.0.0 es una
      // direccion de ESCUCHA, no de destino. Para cargar, loopback.
      const hostNavegable = host === '0.0.0.0' ? '127.0.0.1' : host;
      const url = `http://${hostNavegable}:${puerto}`;
      app.log.info({ url, puerto, host }, 'Servidor del ERP escuchando');

      return {
        url,
        puerto,
        host,
        cerrar: async () => {
          await app.close();
        },
      };
    } catch (error) {
      ultimoError = error;
      await app.close().catch(() => undefined);

      if (!esPuertoOcupado(error)) throw error;

      app.log.warn(
        { puerto, siguiente: puerto + 1 },
        'Puerto ocupado, reintentando con el siguiente',
      );
    }
  }

  const detalle = ultimoError instanceof Error ? ultimoError.message : String(ultimoError);
  throw new Error(
    `No se pudo abrir ningun puerto entre ${puertoInicial} y ${puertoInicial + MAX_INTENTOS_PUERTO - 1} en ${host}. Ultimo error: ${detalle}`,
  );
}
