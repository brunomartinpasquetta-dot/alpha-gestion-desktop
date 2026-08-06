/**
 * Bus de eventos del servidor (Server-Sent Events).
 *
 * Es lo que hace que la pantalla de fabrica se actualice sola: cuando entra un
 * pedido desde el celular o cambia un estado, el servidor avisa a todas las
 * ventanas conectadas y cada una vuelve a pedir su lista. El evento NO lleva los
 * datos —solo el tipo—: el cliente refetchea por la API normal, asi hay un solo
 * camino de lectura y ninguna chance de que el push y el fetch discrepen.
 *
 * Se eligio SSE sobre WebSocket a proposito: es HTTP puro (atraviesa el tunel
 * sin configuracion extra), el navegador reconecta solo, y no suma dependencias.
 */

import type { ServerResponse } from 'node:http';

export type TipoEvento = 'pedidos:cambio' | 'ordenes:cambio' | 'cheques:cambio' | 'ventas:cambio';

const clientes = new Set<ServerResponse>();

/** Cada cuanto se manda un comentario de latido para que nadie corte la conexion. */
const MS_LATIDO = 25_000;
let latido: NodeJS.Timeout | null = null;

function asegurarLatido(): void {
  if (latido !== null) return;
  latido = setInterval(() => {
    for (const cliente of clientes) {
      // Un comentario SSE (linea que empieza con ':') mantiene viva la conexion
      // sin disparar ningun handler del lado del navegador.
      cliente.write(':latido\n\n');
    }
  }, MS_LATIDO);
  // No mantener vivo el proceso solo por el latido.
  latido.unref();
}

/** Registra una conexion SSE ya inicializada. Devuelve la funcion de baja. */
export function suscribir(respuesta: ServerResponse): () => void {
  clientes.add(respuesta);
  asegurarLatido();
  return () => {
    clientes.delete(respuesta);
  };
}

/** Avisa a todos los clientes conectados. Nunca lanza: un socket roto se descarta. */
export function emitir(tipo: TipoEvento): void {
  for (const cliente of clientes) {
    try {
      cliente.write(`event: ${tipo}\ndata: {}\n\n`);
    } catch {
      clientes.delete(cliente);
    }
  }
}

/**
 * Corta todas las conexiones abiertas. Sin esto, `app.close()` espera para
 * siempre a los streams SSE vivos y la aplicacion no puede apagarse.
 */
export function cerrarConexiones(): void {
  for (const cliente of clientes) {
    try {
      cliente.end();
    } catch {
      // Un socket ya roto no impide cerrar el resto.
    }
  }
  clientes.clear();
  if (latido !== null) {
    clearInterval(latido);
    latido = null;
  }
}

/** Cantidad de pantallas conectadas. Solo para diagnostico. */
export function cantidadSuscriptos(): number {
  return clientes.size;
}
