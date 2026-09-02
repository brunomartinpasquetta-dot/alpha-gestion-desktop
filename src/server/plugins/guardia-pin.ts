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

import { timingSafeEqual } from 'node:crypto';

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
  { metodo: 'GET', ruta: /^\/api\/promociones$/ },
  { metodo: 'GET', ruta: /^\/api\/vendedores$/ },
  // Pedidos: cargar y gestionar.
  { metodo: 'GET', ruta: /^\/api\/pedidos$/ },
  { metodo: 'POST', ruta: /^\/api\/pedidos$/ },
  { metodo: 'PUT', ruta: /^\/api\/pedidos\/\d+$/ },
  { metodo: 'PATCH', ruta: /^\/api\/pedidos\/\d+\/estado$/ },
  // Monitor de elaboracion (tablet).
  { metodo: 'GET', ruta: /^\/api\/produccion\/ordenes$/ },
  { metodo: 'PATCH', ruta: /^\/api\/produccion\/ordenes\/\d+\/estado$/ },
  // El asistente NO va: Alfi responde con datos reales de la fabrica (cuanto se
  // vendio hoy, quien debe, que cheques hay en cartera). Por el tunel eso es un
  // canal de exfiltracion con formato de chat. Se opera desde el escritorio.
];

/**
 * Ruta REAL de la request, la misma que va a resolver el router.
 *
 * Esto no es cosmetica: `request.url` llega CRUDO (sin decodificar) y el router
 * de Fastify SI decodifica. Comparar el crudo contra '/api/' dejaba pasar
 * '/%61pi/usuarios' —la 'a' escrita en porcentaje— que para la guardia no
 * empezaba con '/api/' pero para el router ERA '/api/usuarios'. Con eso se
 * salteaba la guardia entera: origen, lista blanca y PIN de un saque.
 *
 * Se decodifica hasta punto fijo (y no una sola vez como el router) para no
 * quedar nunca por detras de lo que el router termine resolviendo, y se
 * resuelven '.', '..' y las barras repetidas. Ante una codificacion invalida se
 * devuelve una ruta imposible: una URL que ni se puede decodificar no merece el
 * beneficio de la duda.
 */
function rutaNormalizada(url: string): string {
  let ruta = url.split('?')[0] ?? '';
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    let siguiente: string;
    try {
      siguiente = decodeURIComponent(ruta);
    } catch {
      return '/__ruta_invalida__';
    }
    if (siguiente === ruta) break;
    ruta = siguiente;
  }
  const partes: string[] = [];
  for (const parte of ruta.split('/')) {
    if (parte === '' || parte === '.') continue;
    if (parte === '..') {
      partes.pop();
      continue;
    }
    partes.push(parte);
  }
  return `/${partes.join('/')}`;
}

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
export function esRemota(request: FastifyRequest): boolean {
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

/**
 * Compara el PIN sin filtrar por tiempo cuanto acerto. Con `===` el motor corta
 * en el primer caracter distinto, y esa diferencia de microsegundos, medida
 * muchas veces, revela el PIN digito por digito.
 */
function pinCoincide(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  // timingSafeEqual exige el mismo largo; comparar largos no filtra el valor.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/*
 * Freno a la fuerza bruta. Un PIN de 4 digitos son 10.000 combinaciones: por
 * internet, sin freno, se agota en minutos. Se cuentan los fallos por IP de
 * origen y se corta con una espera creciente. En memoria a proposito: el
 * proceso es uno solo y reiniciarlo es una accion del duenio, no del atacante.
 */
const FALLOS_ANTES_DE_FRENAR = 5;
const ESPERA_BASE_MS = 2000;
const ESPERA_MAXIMA_MS = 5 * 60 * 1000;
const fallosPorOrigen = new Map<string, { intentos: number; bloqueadoHasta: number }>();

function origenDe(request: FastifyRequest): string {
  const reenviado = request.headers['x-forwarded-for'];
  const primero = typeof reenviado === 'string' ? (reenviado.split(',')[0] ?? '').trim() : '';
  return primero !== '' ? primero : request.ip;
}

function esperaRestante(origen: string): number {
  const estado = fallosPorOrigen.get(origen);
  if (estado === undefined) return 0;
  return Math.max(0, estado.bloqueadoHasta - Date.now());
}

function registrarFallo(origen: string): void {
  const estado = fallosPorOrigen.get(origen) ?? { intentos: 0, bloqueadoHasta: 0 };
  estado.intentos += 1;
  if (estado.intentos >= FALLOS_ANTES_DE_FRENAR) {
    const exceso = estado.intentos - FALLOS_ANTES_DE_FRENAR;
    const espera = Math.min(ESPERA_BASE_MS * 2 ** exceso, ESPERA_MAXIMA_MS);
    estado.bloqueadoHasta = Date.now() + espera;
  }
  fallosPorOrigen.set(origen, estado);
}

function limpiarFallos(origen: string): void {
  fallosPorOrigen.delete(origen);
}

function estaPermitidaDesdeRed(metodo: string, ruta: string): boolean {
  return PERMITIDAS_DESDE_RED.some((regla) => regla.metodo === metodo && regla.ruta.test(ruta));
}

export function registrarGuardiaPin(app: FastifyInstance): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, listo: () => void) => {
    const ruta = rutaNormalizada(request.url);

    // El escritorio de esta maquina no pasa por la guardia. Se evalua PRIMERO
    // el origen y no la ruta: antes se salia por "no parece una ruta de API"
    // sin haber mirado nunca de donde venia la request.
    const remota = esRemota(request);
    if (!remota) return listo();
    const porTunel = esLocal(request.ip);

    if (RUTAS_LIBRES.some((libre) => ruta === libre || ruta.startsWith(`${libre}/`))) return listo();

    /*
     * Lo que NO es API y viene de la red es el frontend: el HTML y los assets
     * de la PWA de pedidos y del monitor. Se sirven, porque sin ellos no hay
     * pantalla, pero SOLO por GET. Cualquier escritura a una ruta que no sea
     * de API es 403 aunque hoy no exista: si manana aparece un prefijo nuevo
     * (/v2/..., /admin/...), la guardia no lo publica sola.
     */
    if (!ruta.startsWith('/api/')) {
      if (request.method === 'GET' || request.method === 'HEAD') return listo();
      return reply.status(403).send({
        error: {
          codigo: 'SOLO_PEDIDOS_DESDE_RED',
          mensaje: 'Desde la red no se puede escribir fuera del modulo de pedidos.',
        },
      });
    }

    // Regla 1: desde la red solo pedidos y monitor, sin importar el PIN.
    if (!estaPermitidaDesdeRed(request.method, ruta)) {
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
    // Antes de mirar el PIN: si este origen ya fallo varias veces, hace tiempo.
    const origen = origenDe(request);
    const espera = esperaRestante(origen);
    if (espera > 0) {
      return reply
        .status(429)
        .header('retry-after', String(Math.ceil(espera / 1000)))
        .send({
          error: {
            codigo: 'DEMASIADOS_INTENTOS',
            mensaje: `Demasiados intentos con PIN incorrecto. Volve a probar en ${Math.ceil(espera / 1000)} segundos.`,
          },
        });
    }

    const pin = request.headers['x-pin-pedidos'];
    if (typeof pin === 'string' && pinCoincide(pin, config.pinPedidos)) {
      limpiarFallos(origen);
      return listo();
    }
    registrarFallo(origen);

    reply.status(401).send({
      error: {
        codigo: 'PIN_INVALIDO',
        mensaje: 'Esta conexion viene de la red y necesita el PIN de acceso.',
      },
    });
  });
}
