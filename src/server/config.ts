/**
 * Configuracion del servidor leida del entorno.
 *
 * Vive del lado Node (main + servidor + seed), no en `src/compartido`, porque
 * usa `process.env` y ese modulo tambien lo consume el renderer, que corre en
 * un contexto sandboxeado sin acceso a Node.
 *
 * Es el UNICO lugar donde se leen variables de entorno de configuracion.
 */

import {
  HOST_SERVIDOR_DEFAULT,
  PUERTO_SERVIDOR_DEFAULT,
} from '../compartido/config';

export interface ConfigServidor {
  readonly puerto: number;
  readonly host: string;
  /** Ruta absoluta al archivo SQLite. Si no se define, la resuelve la capa de db. */
  readonly rutaDb: string | undefined;
  readonly esDesarrollo: boolean;
  readonly nivelLog: string;
  /**
   * PIN que protege la carga de pedidos desde el celular. Si no esta definido,
   * los endpoints de escritura de pedidos quedan abiertos: aceptable mientras el
   * servidor solo escucha en localhost/LAN, obligatorio antes de exponer el
   * tunel a internet.
   */
  readonly pinPedidos: string | undefined;
}

function enteroDesdeEntorno(clave: string, porDefecto: number): number {
  const bruto = process.env[clave];
  if (bruto === undefined || bruto.trim() === '') return porDefecto;
  const valor = Number.parseInt(bruto, 10);
  return Number.isFinite(valor) && valor > 0 && valor < 65536 ? valor : porDefecto;
}

export function leerConfig(): ConfigServidor {
  const esDesarrollo = process.env.NODE_ENV !== 'production';
  return {
    puerto: enteroDesdeEntorno('ALFAJORES_PUERTO', PUERTO_SERVIDOR_DEFAULT),
    host: process.env.ALFAJORES_HOST?.trim() || HOST_SERVIDOR_DEFAULT,
    rutaDb: process.env.ALFAJORES_DB_PATH?.trim() || undefined,
    esDesarrollo,
    nivelLog: process.env.ALFAJORES_LOG_LEVEL?.trim() || (esDesarrollo ? 'info' : 'warn'),
    pinPedidos: process.env.ALFAJORES_PIN_PEDIDOS?.trim() || undefined,
  };
}
