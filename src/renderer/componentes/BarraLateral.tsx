/**
 * Navegacion lateral del ERP: los modulos agrupados por area.
 *
 * Es un `<nav>` con una lista real, no una pila de divs: la navegacion por
 * teclado y los lectores de pantalla dependen de la semantica.
 */

import { GRUPOS_NAVEGACION, hashDeModulo, type ClaveModulo } from '../navegacion';
import type { RespuestaSalud } from '../../compartido/contratos';

interface Props {
  readonly moduloActivo: ClaveModulo;
  readonly alNavegar: (clave: ClaveModulo) => void;
  readonly salud: RespuestaSalud | null;
  readonly errorSalud: string | null;
}

export function BarraLateral({ moduloActivo, alNavegar, salud, errorSalud }: Props): JSX.Element {
  const conectado = errorSalud === null && salud?.db.ok === true;

  return (
    <nav
      aria-label="Modulos del sistema"
      className="flex w-panel shrink-0 flex-col border-r border-masa-200 bg-masa-50"
    >
      <div className="flex h-barra items-center gap-2 border-b border-masa-200 px-4">
        <span className="h-6 w-6 rounded-pastilla bg-dulce-500" aria-hidden="true" />
        <span className="font-semibold tracking-tight text-masa-900">ALPHA GESTIÓN</span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {GRUPOS_NAVEGACION.map((grupo) => (
          <div key={grupo.titulo} className="mb-4 last:mb-0">
            <p className="px-2 pb-1 text-micro font-semibold uppercase tracking-wide text-masa-700">
              {grupo.titulo}
            </p>
            <ul className="space-y-0.5">
              {grupo.modulos.map((modulo) => {
                const activo = modulo.clave === moduloActivo;
                return (
                  <li key={modulo.clave}>
                    <a
                      href={hashDeModulo(modulo.clave)}
                      aria-current={activo ? 'page' : undefined}
                      onClick={(evento) => {
                        // Navegacion interna: evitamos el salto del navegador y
                        // dejamos que el estado de App maneje el cambio.
                        evento.preventDefault();
                        alNavegar(modulo.clave);
                      }}
                      className={[
                        'block rounded-pastilla px-2 py-1.5 text-sm outline-none transition-colors',
                        activo
                          ? 'bg-dulce-500 font-medium text-white'
                          : 'text-masa-800 hover:bg-masa-100 focus-visible:bg-masa-100',
                        'focus-visible:ring-2 focus-visible:ring-dulce-400',
                      ].join(' ')}
                    >
                      {modulo.etiqueta}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-masa-200 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2 w-2 rounded-full ${conectado ? 'bg-menta-500' : 'bg-peligro-500'}`}
          />
          <span className="text-masa-800">
            {conectado ? 'Servidor conectado' : 'Servidor sin respuesta'}
          </span>
        </div>
        {salud !== null && (
          <p className="mt-1 font-mono text-micro text-masa-700">
            v{salud.version} · {salud.entorno} · {salud.db.tablas} tablas
          </p>
        )}
        {errorSalud !== null && <p className="mt-1 text-micro text-peligro-600">{errorSalud}</p>}
      </div>
    </nav>
  );
}
