/**
 * Paleta de comandos y buscador global.
 *
 * Se abre con Ctrl+K / Cmd+K desde cualquier ventana, o escribiendo en el
 * buscador de la barra de estado. Filtra los modulos por titulo, etiqueta y
 * descripcion, y abre el elegido.
 *
 * Es el camino rapido para el que ya sabe adonde va: no hay que buscar el modulo
 * en el menu ni acordarse de que tecla de funcion le toca.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { Icono } from './Icono';
import { ACCESOS_DIRECTOS, MODULOS, type ClaveModulo, type DefinicionModulo } from '../ventanas';

/** Normaliza para buscar sin acentos ni mayusculas: "produccion" encuentra "Producción". */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const TODOS: readonly DefinicionModulo[] = Object.values(MODULOS);

const TECLA_POR_MODULO: ReadonlyMap<ClaveModulo, string> = new Map(
  ACCESOS_DIRECTOS.map((acceso) => [acceso.clave, acceso.tecla]),
);

/**
 * Puntaje de relevancia. Sin esto, buscar "caja" devuelve primero el Tablero
 * (que menciona "caja" en su descripcion) en vez del modulo Caja. Cuanto mas
 * bajo el numero, mas arriba aparece.
 */
function puntaje(modulo: DefinicionModulo, termino: string): number {
  const titulo = normalizar(modulo.titulo);
  const etiqueta = normalizar(modulo.etiqueta);
  const descripcion = normalizar(modulo.descripcion);

  if (titulo === termino) return 0;
  if (titulo.startsWith(termino)) return 1;
  if (etiqueta.startsWith(termino)) return 2;
  if (titulo.includes(termino)) return 3;
  if (etiqueta.includes(termino)) return 4;
  if (descripcion.includes(termino)) return 5;
  return Number.POSITIVE_INFINITY;
}

function filtrar(consulta: string): readonly DefinicionModulo[] {
  const termino = normalizar(consulta.trim());
  if (termino === '') return TODOS;

  return TODOS.map((modulo) => ({ modulo, orden: puntaje(modulo, termino) }))
    .filter((candidato) => Number.isFinite(candidato.orden))
    .sort((a, b) => a.orden - b.orden || a.modulo.titulo.localeCompare(b.modulo.titulo))
    .map((candidato) => candidato.modulo);
}

interface Props {
  readonly abierta: boolean;
  readonly consultaInicial: string;
  readonly alCerrar: () => void;
  readonly alElegir: (clave: ClaveModulo) => void;
}

export function PaletaComandos({
  abierta,
  consultaInicial,
  alCerrar,
  alElegir,
}: Props): JSX.Element | null {
  const [consulta, setConsulta] = useState(consultaInicial);
  const [resaltado, setResaltado] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);

  const resultados = useMemo(() => filtrar(consulta), [consulta]);

  // Al abrir: foco en la entrada y arrancar desde lo que se venia escribiendo.
  useEffect(() => {
    if (!abierta) return;
    setConsulta(consultaInicial);
    setResaltado(0);
    const foco = setTimeout(() => entrada.current?.select(), 20);
    return () => clearTimeout(foco);
  }, [abierta, consultaInicial]);

  // El indice resaltado no puede quedar fuera de rango al filtrar.
  useEffect(() => {
    setResaltado((actual) => Math.min(actual, Math.max(resultados.length - 1, 0)));
  }, [resultados.length]);

  if (!abierta) return null;

  const elegir = (modulo: DefinicionModulo | undefined): void => {
    if (!modulo) return;
    alElegir(modulo.clave);
    alCerrar();
  };

  const alTeclear = (evento: React.KeyboardEvent<HTMLDivElement>): void => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      alCerrar();
      return;
    }
    if (evento.key === 'ArrowDown') {
      evento.preventDefault();
      setResaltado((actual) => (actual + 1) % Math.max(resultados.length, 1));
      return;
    }
    if (evento.key === 'ArrowUp') {
      evento.preventDefault();
      setResaltado((actual) => (actual - 1 + resultados.length) % Math.max(resultados.length, 1));
      return;
    }
    if (evento.key === 'Enter') {
      evento.preventDefault();
      elegir(resultados[resaltado]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-masa-900/40 px-4 pt-24"
      onMouseDown={alCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Buscar modulo"
        onMouseDown={(evento) => evento.stopPropagation()}
        onKeyDown={alTeclear}
        className="w-full max-w-xl overflow-hidden rounded-panel border border-masa-300 bg-white shadow-panel"
      >
        <div className="flex items-center gap-2 border-b border-masa-200 px-3">
          <Search className="h-4 w-4 shrink-0 text-masa-700" aria-hidden="true" />
          <input
            ref={entrada}
            value={consulta}
            onChange={(evento) => setConsulta(evento.target.value)}
            placeholder="Buscar modulo..."
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-masa-900 outline-none placeholder:text-masa-500"
            autoFocus
          />
          <kbd className="shrink-0 rounded bg-masa-100 px-1.5 py-0.5 font-mono text-[10px] text-masa-700">
            esc
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {resultados.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-masa-700">
              Ningun modulo coincide con «{consulta}».
            </p>
          ) : (
            resultados.map((modulo, indice) => {
              const activo = indice === resaltado;
              const tecla = TECLA_POR_MODULO.get(modulo.clave);
              return (
                <button
                  key={modulo.clave}
                  type="button"
                  onMouseEnter={() => setResaltado(indice)}
                  onClick={() => elegir(modulo)}
                  className={[
                    'flex w-full items-center gap-3 px-3 py-2 text-left outline-none',
                    activo ? 'bg-dulce-500 text-white' : 'text-masa-900 hover:bg-masa-50',
                  ].join(' ')}
                >
                  <Icono nombre={modulo.icono} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{modulo.titulo}</span>
                    <span
                      className={`block truncate text-xs ${activo ? 'text-white/80' : 'text-masa-700'}`}
                    >
                      {modulo.descripcion}
                    </span>
                  </span>
                  {tecla !== undefined && (
                    <kbd
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        activo ? 'bg-white/25 text-white' : 'bg-masa-100 text-masa-700'
                      }`}
                    >
                      {tecla}
                    </kbd>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/** Buscador de la barra de estado. Al enfocarlo o escribir, abre la paleta. */
export function BuscadorGlobal({
  alAbrir,
}: {
  readonly alAbrir: (consultaInicial: string) => void;
}): JSX.Element {
  const esMac = navigator.userAgent.includes('Mac');

  return (
    <button
      type="button"
      onClick={() => alAbrir('')}
      className="inline-flex h-7 w-64 shrink-0 items-center gap-2 rounded-pastilla border border-masa-300 bg-white px-2.5 text-left outline-none transition-colors hover:border-dulce-400 focus-visible:ring-2 focus-visible:ring-dulce-400"
    >
      <Search className="h-3.5 w-3.5 shrink-0 text-masa-700" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-xs text-masa-700">Buscar modulo...</span>
      <kbd className="shrink-0 rounded bg-masa-100 px-1 py-0.5 font-mono text-[10px] text-masa-700">
        {esMac ? '⌘K' : 'Ctrl+K'}
      </kbd>
    </button>
  );
}
