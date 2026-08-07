/**
 * Suscripcion al canal de tiempo real.
 *
 * Cuando llega el evento pedido, dispara el callback —tipicamente `recargar` de
 * un recurso—. Asi la pantalla de fabrica se actualiza sola cuando el dueño
 * carga un pedido desde el celular, sin que nadie toque F5.
 *
 * Hay DOS caminos, y la eleccion no es cosmetica:
 *
 *  - En el ESCRITORIO va por IPC. El servidor corre embebido en el proceso main
 *    de Electron, asi que el evento ya ocurrio en la misma memoria: abrir una
 *    conexion HTTP para enterarse seria dar la vuelta al mundo. Ademas el
 *    navegador limita las conexiones simultaneas por servidor (6 en Chromium) y
 *    cada stream SSE ocupa una para siempre: con siete pantallas escuchando, la
 *    septima ventana agotaba el cupo y TODAS las peticiones quedaban encoladas
 *    sin resolverse. Se descubrio abriendo los 22 modulos a la vez.
 *
 *  - En el NAVEGADOR (la PWA de pedidos en el celular) se usa SSE, que es el
 *    unico camino posible desde afuera. Ahi hay una sola pantalla por telefono,
 *    asi que el limite de conexiones no molesta.
 */

import { useEffect, useRef } from 'react';

// El catalogo de eventos lo define el contrato compartido: ver contratos.ts.
export type { TipoEventoSse } from '../../compartido/contratos';

import type { TipoEventoSse } from '../../compartido/contratos';

export function usarEventos(tipo: TipoEventoSse, alRecibir: () => void): void {
  // El callback vive en una ref para no reconectar en cada render.
  const callback = useRef(alRecibir);
  callback.current = alRecibir;

  useEffect(() => {
    const puente = window.alfajores?.eventos;

    if (puente !== undefined) {
      return puente.alCambiar((recibido) => {
        if (recibido === tipo) callback.current();
      });
    }

    // Fuera de Electron: SSE. EventSource reconecta solo ante cortes.
    const fuente = new EventSource('/api/eventos');
    const manejador = (): void => callback.current();
    fuente.addEventListener(tipo, manejador);
    return () => {
      fuente.removeEventListener(tipo, manejador);
      fuente.close();
    };
  }, [tipo]);
}
