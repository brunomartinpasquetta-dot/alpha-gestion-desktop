/**
 * Suscripcion al canal de tiempo real del servidor (SSE).
 *
 * Cuando llega el evento pedido, dispara el callback —tipicamente `recargar` de
 * un recurso—. Asi la pantalla de fabrica se actualiza sola cuando el dueño
 * carga un pedido desde el celular, sin que nadie toque F5.
 *
 * EventSource reconecta solo ante cortes; no hace falta manejarlo a mano.
 */

import { useEffect, useRef } from 'react';

export function usarEventos(tipo: 'pedidos:cambio', alRecibir: () => void): void {
  // El callback vive en una ref para no reconectar el stream en cada render.
  const callback = useRef(alRecibir);
  callback.current = alRecibir;

  useEffect(() => {
    const fuente = new EventSource('/api/eventos');
    const manejador = (): void => callback.current();
    fuente.addEventListener(tipo, manejador);
    return () => {
      fuente.removeEventListener(tipo, manejador);
      fuente.close();
    };
  }, [tipo]);
}
