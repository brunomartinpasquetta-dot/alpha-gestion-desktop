/**
 * El sitio publico de Anyulin, adentro del sistema.
 *
 * Por que embebido y no un simple link al navegador: el uso real es
 * MOSTRARLO — el dueño le abre la pagina a un distribuidor que esta en el
 * mostrador, o busca una foto del producto mientras carga un pedido. Que se
 * abra en una ventana del sistema (con la marca arriba y sin barra de
 * navegador) se ve mejor y no lo saca del trabajo.
 *
 * Igual queda el boton para abrirlo en el navegador de verdad (para compartir
 * el link o navegar comodo) y el de copiar la direccion.
 *
 * Se usa un <iframe> comun, no un webview: el sitio es propio y no necesita
 * sesion persistente ni permisos especiales.
 */

import { useState } from 'react';

const URL_SITIO = 'https://anyulinalfajores.com';

export function SitioWeb(): JSX.Element {
  const [recarga, setRecarga] = useState(0);
  const [copiado, setCopiado] = useState(false);

  const copiar = (): void => {
    void navigator.clipboard.writeText(URL_SITIO).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  };

  const boton =
    'h-9 rounded-none border px-3 text-xs font-bold uppercase tracking-wide transition-colors';

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-masa-100">
      <div className="flex flex-wrap items-center gap-2 border-b border-masa-200 bg-white px-4 py-2">
        <div className="min-w-0">
          <p className="text-sm font-bold uppercase tracking-wide text-masa-900">
            Anyulin · Alfajores Corondinos
          </p>
          <p className="select-all font-mono text-xs text-dulce-700">{URL_SITIO}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRecarga((n) => n + 1)}
            className={`${boton} border-masa-300 bg-white text-masa-800 hover:bg-masa-50`}
          >
            Recargar
          </button>
          <button
            type="button"
            onClick={copiar}
            className={`${boton} border-masa-300 bg-white text-masa-800 hover:bg-masa-50`}
          >
            {copiado ? 'Copiado' : 'Copiar direccion'}
          </button>
          <button
            type="button"
            onClick={() => window.open(URL_SITIO, '_blank', 'noopener')}
            className={`${boton} border-dulce-400 bg-dulce-500 text-white`}
          >
            Abrir en el navegador
          </button>
        </div>
      </div>

      <iframe
        key={recarga}
        src={URL_SITIO}
        title="Sitio web de Anyulin"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
