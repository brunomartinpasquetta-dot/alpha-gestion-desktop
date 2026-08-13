/**
 * Tunel de pedidos remotos (Cloudflare quick tunnel).
 *
 * Levanta `cloudflared tunnel --url http://127.0.0.1:<puerto>` como proceso
 * hijo y publica el sistema en una URL https publica SIN abrir puertos ni
 * tocar el router. Con eso el duenio carga pedidos desde el celular en
 * CUALQUIER lado (4G, otra red), no solo en el WiFi de la fabrica.
 *
 * Seguridad: las requests que entran por el tunel llegan como loopback pero
 * traen el header `cf-connecting-ip`; la guardia las trata como REMOTAS
 * (lista blanca de pedidos + PIN OBLIGATORIO). Sin PIN configurado, el tunel
 * responde 401 a todo: publicar la fabrica abierta a internet no es opcion.
 *
 * Limite conocido del quick tunnel: la URL cambia en cada arranque del tunel
 * (para una URL fija hace falta un tunel con nombre + cuenta de Cloudflare;
 * tarea de BPSG). La pantalla lo avisa.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface EstadoTunel {
  activo: boolean;
  /** URL publica (https://xxx.trycloudflare.com) cuando el tunel levanto. */
  url: string | null;
  /** Ultimo error legible, para mostrar en pantalla. */
  error: string | null;
}

let proceso: ChildProcess | null = null;
let estado: EstadoTunel = { activo: false, url: null, error: null };

/** Rutas tipicas de cloudflared; la variable de entorno pisa todo. */
function rutaCloudflared(): string | null {
  const candidatas = [
    process.env.ALFAJORES_CLOUDFLARED?.trim(),
    path.join(os.homedir(), '.local', 'bin', 'cloudflared'),
    '/opt/homebrew/bin/cloudflared',
    '/usr/local/bin/cloudflared',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  ].filter((r): r is string => typeof r === 'string' && r !== '');
  for (const ruta of candidatas) {
    try {
      fs.accessSync(ruta, fs.constants.X_OK);
      return ruta;
    } catch {
      // probar la siguiente
    }
  }
  return null;
}

export function estadoTunel(): EstadoTunel {
  return { ...estado };
}

/** Levanta el tunel y espera la URL publica (o el error) hasta 20 segundos. */
export function iniciarTunel(puerto: number): Promise<EstadoTunel> {
  if (proceso !== null && estado.activo) return Promise.resolve(estadoTunel());

  const binario = rutaCloudflared();
  if (binario === null) {
    estado = {
      activo: false,
      url: null,
      error:
        'No se encontro cloudflared en esta maquina. En Mac: brew install cloudflared. En Windows: winget install Cloudflare.cloudflared. Despues reintenta.',
    };
    return Promise.resolve(estadoTunel());
  }

  return new Promise((resolver) => {
    const hijo = spawn(binario, ['tunnel', '--url', `http://127.0.0.1:${puerto}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proceso = hijo;
    estado = { activo: true, url: null, error: null };

    let resuelto = false;
    const terminar = (): void => {
      if (!resuelto) {
        resuelto = true;
        resolver(estadoTunel());
      }
    };

    // cloudflared escribe la URL en stderr, en un recuadro de asteriscos.
    const alLeer = (pedazo: Buffer): void => {
      const texto = pedazo.toString('utf8');
      // OJO: cloudflared tambien loguea api.trycloudflare.com (su propio API);
      // la URL asignada al tunel es la de palabras con guiones.
      const m = texto.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && m[0] !== 'https://api.trycloudflare.com' && estado.url === null) {
        estado = { activo: true, url: m[0], error: null };
        terminar();
      }
    };
    hijo.stderr?.on('data', alLeer);
    hijo.stdout?.on('data', alLeer);

    hijo.on('exit', (codigo) => {
      const eraActivo = estado.activo;
      proceso = null;
      estado = {
        activo: false,
        url: null,
        error: eraActivo && codigo !== 0 ? `El tunel se corto (codigo ${codigo ?? '?'}). Reintenta.` : estado.error,
      };
      terminar();
    });
    hijo.on('error', (causa) => {
      proceso = null;
      estado = { activo: false, url: null, error: `No se pudo lanzar cloudflared: ${causa.message}` };
      terminar();
    });

    // Si en 20 segundos no hay URL, se informa igual (queda "levantando").
    setTimeout(() => {
      if (!resuelto) {
        if (estado.url === null && estado.activo) {
          estado = { ...estado, error: 'El tunel no publico la URL en 20 segundos. Revisa la conexion a internet.' };
        }
        terminar();
      }
    }, 20_000);
  });
}

export function detenerTunel(): EstadoTunel {
  if (proceso !== null) {
    proceso.kill();
    proceso = null;
  }
  estado = { activo: false, url: null, error: null };
  return estadoTunel();
}
