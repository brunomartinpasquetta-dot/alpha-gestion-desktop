/**
 * Alfi, el asistente virtual de Alpha Gestion (estructura copiada del Flowy de
 * StockFlow v0.1.86). El motor conversacional corre en el servidor, 100%
 * offline; este panel es solo el chat: mensajes, sugerencias tocables y campo
 * de texto. Vive como lengueta en el borde derecho de la ventana principal,
 * debajo de la de WhatsApp.
 */

import { useEffect, useRef, useState } from 'react';

const ANCHO_PANEL = 380;
const TRANSICION = 'width 300ms cubic-bezier(0.4,0,0.2,1)';

interface Mensaje {
  de: 'usuario' | 'alfi';
  texto: string;
}

const SESION = `escritorio-${Date.now()}`;

async function preguntarAlfi(pregunta: string): Promise<{ respuesta: string; sugerencias: string[] }> {
  const r = await fetch('/api/asistente', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pregunta, sesion: SESION }),
  });
  const cuerpo = (await r.json()) as {
    datos?: { respuesta: string; sugerencias: string[] };
    error?: { mensaje?: string };
  };
  if (!r.ok || !cuerpo.datos) {
    throw new Error(cuerpo.error?.mensaje ?? 'El asistente no pudo responder.');
  }
  return cuerpo.datos;
}

/** Boton horizontal para la fila del buscador: abre y cierra el panel. */
export function BotonAsistente({
  abierto,
  alAlternar,
}: {
  readonly abierto: boolean;
  readonly alAlternar: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={alAlternar}
      title={abierto ? 'Cerrar el asistente' : 'Abrir el asistente'}
      className={[
        'flex h-9 shrink-0 items-center gap-1.5 rounded-none border px-3 text-sm font-bold uppercase tracking-wide',
        abierto
          ? 'border-dulce-600 bg-dulce-600 text-white'
          : 'border-dulce-400 bg-white text-dulce-700 hover:bg-dulce-50',
      ].join(' ')}
    >
      <span className="font-mono text-base">α</span> Alfi
    </button>
  );
}

export function PanelAsistente({
  abierto,
  alCerrar,
}: {
  readonly abierto: boolean;
  readonly alCerrar: () => void;
}): JSX.Element {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [sugerencias, setSugerencias] = useState<string[]>([]);
  const [texto, setTexto] = useState('');
  const [pensando, setPensando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensajes, pensando]);

  // El primer saludo sale solo al abrir el panel por primera vez.
  useEffect(() => {
    if (!abierto || mensajes.length > 0) return;
    void enviar('hola', true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto]);

  const enviar = async (pregunta: string, silencioso = false): Promise<void> => {
    const limpia = pregunta.trim();
    if (limpia === '' || pensando) return;
    if (!silencioso) setMensajes((m) => [...m, { de: 'usuario', texto: limpia }]);
    setTexto('');
    setPensando(true);
    try {
      const { respuesta, sugerencias: sug } = await preguntarAlfi(limpia);
      setMensajes((m) => [...m, { de: 'alfi', texto: respuesta }]);
      setSugerencias(sug);
    } catch (causa) {
      setMensajes((m) => [
        ...m,
        { de: 'alfi', texto: causa instanceof Error ? causa.message : 'No pude responder.' },
      ]);
    } finally {
      setPensando(false);
    }
  };

  const anchoPanel = abierto ? ANCHO_PANEL : 0;

  return (
    <>
      <div
        className="h-full shrink-0 overflow-hidden"
        style={{ width: anchoPanel, transition: TRANSICION }}
      >
        <div
          className="flex h-full flex-col border-l border-masa-200 bg-white"
          style={{ width: ANCHO_PANEL }}
        >
          <div className="flex items-center justify-between bg-dulce-600 px-3 py-2 text-white">
            <span className="text-sm font-bold uppercase tracking-wide">Alfi · Asistente</span>
            <button
              type="button"
              title="Minimizar"
              className="rounded-none p-1 transition hover:bg-white/20"
              onClick={alCerrar}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round"><path d="M5 12h14" /></svg>
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {mensajes.map((m, i) => (
              <div
                key={i}
                className={[
                  'max-w-[92%] whitespace-pre-wrap rounded-ficha border px-2.5 py-1.5 text-sm leading-snug',
                  m.de === 'usuario'
                    ? 'ml-auto border-dulce-300 bg-dulce-50 text-masa-900'
                    : 'border-masa-200 bg-masa-50 text-masa-900',
                ].join(' ')}
              >
                {m.texto}
              </div>
            ))}
            {pensando && <p className="text-xs text-masa-700">Alfi esta escribiendo…</p>}
            <div ref={finRef} />
          </div>

          {sugerencias.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-masa-100 px-3 py-2">
              {sugerencias.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void enviar(s)}
                  className="rounded-none border border-masa-300 bg-white px-2 py-1 text-xs text-masa-800 hover:bg-masa-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2 border-t border-masa-200 px-3 py-2">
            <input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void enviar(texto);
              }}
              placeholder="Preguntale a Alfi..."
              className="h-10 min-w-0 flex-1 rounded-none border border-masa-300 px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void enviar(texto)}
              disabled={pensando || texto.trim() === ''}
              className="h-10 rounded-none border border-dulce-400 bg-dulce-500 px-3 text-sm font-bold uppercase text-white disabled:opacity-30"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>

</>
  );
}
