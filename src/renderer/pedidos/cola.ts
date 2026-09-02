/**
 * Cola offline de pedidos.
 *
 * Requisito de la guia: el dueño NUNCA pierde un pedido. Si el servidor no
 * responde (tunel caido, sin señal), el pedido se encola local y se reintenta
 * al reconectar. La cola sobrevive a cerrar la app: persiste en localStorage.
 *
 * Nota de implementacion: la guia menciona IndexedDB; se usa localStorage
 * porque para este volumen (pedidos de texto, unos pocos KB) es equivalente,
 * sincronico y sin ceremonia. Si algun dia se encolan fotos, se migra.
 */

import type { EntradaNuevoPedido } from '../../compartido/contratos';

const CLAVE_COLA = 'alpha-pedidos-cola';

export interface PedidoEncolado {
  /** Identificador local, solo para poder listarlo y borrarlo. */
  readonly idLocal: string;
  readonly creadoEn: string;
  readonly pedido: EntradaNuevoPedido;
}

function leerCola(): PedidoEncolado[] {
  try {
    const crudo = localStorage.getItem(CLAVE_COLA);
    if (crudo === null) return [];
    const datos: unknown = JSON.parse(crudo);
    return Array.isArray(datos) ? (datos as PedidoEncolado[]) : [];
  } catch {
    return [];
  }
}

function escribirCola(cola: readonly PedidoEncolado[]): void {
  localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
}

export function encolar(pedido: EntradaNuevoPedido): PedidoEncolado {
  const encolado: PedidoEncolado = {
    idLocal: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    creadoEn: new Date().toISOString(),
    pedido,
  };
  escribirCola([...leerCola(), encolado]);
  return encolado;
}

export function pendientes(): PedidoEncolado[] {
  return leerCola();
}

export function sacarDeCola(idLocal: string): void {
  escribirCola(leerCola().filter((p) => p.idLocal !== idLocal));
}

/**
 * Intenta enviar todos los encolados, en orden de carga. Corta en el primer
 * fallo de red (si no hay conexion no tiene sentido seguir intentando), pero
 * un rechazo del servidor (4xx) descarta ese pedido y sigue: reintentarlo para
 * siempre bloquearia la cola entera detras de un pedido invalido.
 */
export async function sincronizar(
  enviar: (pedido: EntradaNuevoPedido) => Promise<'ok' | 'rechazado' | 'reintentar'>,
): Promise<{ enviados: number; rechazados: number; quedan: number; descartados: string[] }> {
  let enviados = 0;
  let rechazados = 0;
  // Que pedidos se tiraron, para poder DECIRSELO al vendedor: antes
  // desaparecian en silencio y el unico que se enteraba era el cliente que no
  // recibia la mercaderia.
  const descartados: string[] = [];

  for (const encolado of leerCola()) {
    try {
      const resultado = await enviar(encolado.pedido);
      if (resultado === 'reintentar') {
        // El servidor esta caido o saturado: el pedido SE QUEDA en la cola.
        break;
      }
      sacarDeCola(encolado.idLocal);
      if (resultado === 'ok') {
        enviados += 1;
      } else {
        rechazados += 1;
        const cuantos = encolado.pedido.renglones?.length ?? 0;
        descartados.push(
          `Pedido de ${cuantos} renglon${cuantos === 1 ? '' : 'es'} cargado el ` +
            new Date(encolado.creadoEn).toLocaleString('es-AR'),
        );
      }
    } catch {
      // Error de red: el servidor no esta. Se reintenta en la proxima pasada.
      break;
    }
  }

  return { enviados, rechazados, quedan: leerCola().length, descartados };
}
