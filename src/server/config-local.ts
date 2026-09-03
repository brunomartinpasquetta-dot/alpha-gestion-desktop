/**
 * Configuracion PERSISTENTE del sistema (userData/configuracion.json).
 *
 * A diferencia de config.ts (variables de entorno, para desarrollo y deploy),
 * esto es lo que el DUENIO configura desde la pantalla y tiene que sobrevivir
 * a reinicios y actualizaciones: hoy, el PIN de acceso remoto y si el tunel
 * queda activado. La variable de entorno, si existe, sigue mandando.
 */

import fs from 'node:fs';
import path from 'node:path';

import { resolverCarpetaUserData } from './db/rutas-db';

export interface ConfigLocal {
  /** PIN que exige el acceso desde la red y (obligatorio) desde el tunel. */
  pinPedidos?: string;
  /** true = el tunel de pedidos remotos se levanta al iniciar el sistema. */
  tunelActivado?: boolean;
  /**
   * Marca de la correccion por unica vez de la 1.9.6: las 1.9.4/1.9.5 guardaban
   * tunelActivado=false cuando el primer intento fallaba aunque el duenio lo
   * hubiera activado. Con esta marca puesta, no se vuelve a re-armar.
   */
  tunelAutoarmado?: boolean;
}

function rutaArchivo(): string {
  return path.join(resolverCarpetaUserData(), 'configuracion.json');
}

export function leerConfigLocal(): ConfigLocal {
  try {
    const crudo = fs.readFileSync(rutaArchivo(), 'utf8');
    const dato = JSON.parse(crudo) as ConfigLocal;
    return {
      pinPedidos: typeof dato.pinPedidos === 'string' && dato.pinPedidos.trim() !== '' ? dato.pinPedidos.trim() : undefined,
      tunelActivado: dato.tunelActivado === true,
      tunelAutoarmado: dato.tunelAutoarmado === true,
    };
  } catch {
    return {};
  }
}

export function escribirConfigLocal(cambios: Partial<ConfigLocal>): ConfigLocal {
  const actual = leerConfigLocal();
  const nuevo: ConfigLocal = { ...actual, ...cambios };
  // Un PIN vacio significa "sacar el PIN": no se persiste la clave.
  if (nuevo.pinPedidos !== undefined && nuevo.pinPedidos.trim() === '') delete nuevo.pinPedidos;
  fs.mkdirSync(resolverCarpetaUserData(), { recursive: true });
  fs.writeFileSync(rutaArchivo(), JSON.stringify(nuevo, null, 2), 'utf8');
  return nuevo;
}
