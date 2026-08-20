/**
 * Tunel de pedidos remotos: publica la pantalla de pedidos en una URL FIJA
 * (https://pedidos.anyulinalfajores.com) sin abrir puertos del router.
 *
 * Como funciona: el sistema abre un tunel SSH REVERSO contra el VPS de BPSG.
 * El VPS ya tiene nginx + SSL apuntando a 127.0.0.1:8110, que es la punta del
 * tunel. Cuando el tunel esta arriba, el celular entra desde cualquier lado
 * (4G, otra ciudad); cuando la PC esta apagada, el VPS muestra un cartel de
 * "sistema apagado" en vez de un error.
 *
 * Por que asi y no con un servicio gratis (trycloudflare, localhost.run): esos
 * cambian la URL en cada arranque y se caen solos. Esta es propia, fija y con
 * el SSL de Let's Encrypt del dominio del cliente.
 *
 * Seguridad:
 *  - La clave SSH esta RESTRINGIDA en el VPS: solo puede abrir el puerto 8110
 *    hacia loopback. No da shell ni acceso a nada mas.
 *  - Las requests que entran por el tunel llegan con el Host del dominio: la
 *    guardia las trata como REMOTAS (solo pedidos + PIN obligatorio).
 *
 * Reconexion: `ssh` sale cuando se corta internet; este modulo lo vuelve a
 * levantar con espera creciente (5s, 10s, 20s... hasta 60s) mientras el
 * duenio lo tenga activado. Asi sobrevive a cortes y a cambios de IP.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Punta del tunel en el VPS y URL publica que ve el celular. */
const HOST_VPS = process.env.ALFAJORES_TUNEL_HOST?.trim() || '187.127.20.131';
const USUARIO_VPS = process.env.ALFAJORES_TUNEL_USUARIO?.trim() || 'tunelalpha';
const PUERTO_REMOTO = Number(process.env.ALFAJORES_TUNEL_PUERTO ?? 8110);
const URL_PUBLICA =
  process.env.ALFAJORES_TUNEL_URL?.trim() || 'https://pedidos.anyulinalfajores.com';

export interface EstadoTunel {
  activo: boolean;
  /** URL publica fija; no cambia nunca. */
  url: string | null;
  error: string | null;
  /** true mientras esta reintentando despues de un corte. */
  reconectando?: boolean;
}

let proceso: ChildProcess | null = null;
let quiereActivo = false;
let intentos = 0;
let temporizador: NodeJS.Timeout | null = null;
let estado: EstadoTunel = { activo: false, url: null, error: null };

/** La clave viaja con la app (extraResources) y es de un solo uso: el tunel. */
function rutaClave(): string | null {
  const candidatas = [
    process.env.ALFAJORES_TUNEL_CLAVE?.trim(),
    path.join(process.resourcesPath ?? '', 'tunel', 'tunel_alpha'),
    path.join(process.cwd(), 'recursos', 'tunel', 'tunel_alpha'),
  ].filter((r): r is string => typeof r === 'string' && r !== '');
  for (const ruta of candidatas) {
    try {
      fs.accessSync(ruta, fs.constants.R_OK);
      return ruta;
    } catch {
      // probar la siguiente
    }
  }
  return null;
}

/** En Windows el ssh nativo vive en System32\OpenSSH. */
function rutaSsh(): string {
  if (process.platform !== 'win32') return 'ssh';
  const nativo = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'OpenSSH',
    'ssh.exe',
  );
  return fs.existsSync(nativo) ? nativo : 'ssh';
}

export function estadoTunel(): EstadoTunel {
  return { ...estado };
}

function programarReintento(puertoLocal: number): void {
  if (!quiereActivo) return;
  intentos += 1;
  const espera = Math.min(5000 * 2 ** (intentos - 1), 60_000);
  estado = { activo: false, url: null, error: estado.error, reconectando: true };
  temporizador = setTimeout(() => {
    if (quiereActivo) void levantar(puertoLocal);
  }, espera);
}

/** Lanza el proceso ssh. La promesa resuelve cuando el tunel quedo en pie. */
function levantar(puertoLocal: number): Promise<EstadoTunel> {
  const clave = rutaClave();
  if (clave === null) {
    quiereActivo = false;
    estado = {
      activo: false,
      url: null,
      error: 'Falta la clave del tunel en esta instalacion. Avisale a BPSG Sistemas.',
    };
    return Promise.resolve(estadoTunel());
  }
  // La clave tiene que ser privada o ssh la rechaza (en Windows no aplica).
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(clave, 0o600);
    } catch {
      // Si no se puede, ssh avisara.
    }
  }

  return new Promise((resolver) => {
    const hijo = spawn(
      rutaSsh(),
      [
        '-N',
        '-T',
        '-i',
        clave,
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        `UserKnownHostsFile=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
        // Keepalives: el VPS no los manda, asi que los manda el cliente. Sin
        // esto, tras un corte de internet el puerto queda tomado por una
        // sesion zombi y la reconexion falla en silencio.
        '-o',
        'ServerAliveInterval=30',
        '-o',
        'ServerAliveCountMax=3',
        '-o',
        'ExitOnForwardFailure=yes',
        '-R',
        `${PUERTO_REMOTO}:127.0.0.1:${puertoLocal}`,
        `${USUARIO_VPS}@${HOST_VPS}`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    proceso = hijo;

    let resuelto = false;
    let salida = '';
    hijo.stderr?.on('data', (p: Buffer) => {
      salida += p.toString('utf8');
    });

    hijo.on('exit', (codigo) => {
      proceso = null;
      const motivo = salida.trim().split('\n').pop() ?? '';
      estado = {
        activo: false,
        url: null,
        error:
          codigo === 0 || !quiereActivo
            ? null
            : `Se corto la conexion con el servidor${motivo === '' ? '' : `: ${motivo}`}`,
      };
      if (!resuelto) {
        resuelto = true;
        resolver(estadoTunel());
      }
      programarReintento(puertoLocal);
    });
    hijo.on('error', (causa) => {
      proceso = null;
      estado = { activo: false, url: null, error: `No se pudo abrir el tunel: ${causa.message}` };
      if (!resuelto) {
        resuelto = true;
        resolver(estadoTunel());
      }
      programarReintento(puertoLocal);
    });

    // ssh -N no imprime nada al conectar bien: si sigue vivo a los 3 segundos,
    // el tunel quedo en pie.
    setTimeout(() => {
      if (!resuelto && proceso === hijo) {
        intentos = 0;
        estado = { activo: true, url: URL_PUBLICA, error: null };
        resuelto = true;
        resolver(estadoTunel());
      }
    }, 3000);
  });
}

export function iniciarTunel(puertoLocal: number): Promise<EstadoTunel> {
  if (proceso !== null && estado.activo) return Promise.resolve(estadoTunel());
  quiereActivo = true;
  intentos = 0;
  return levantar(puertoLocal);
}

export function detenerTunel(): EstadoTunel {
  quiereActivo = false;
  if (temporizador !== null) {
    clearTimeout(temporizador);
    temporizador = null;
  }
  if (proceso !== null) {
    proceso.kill();
    proceso = null;
  }
  estado = { activo: false, url: null, error: null };
  return estadoTunel();
}
