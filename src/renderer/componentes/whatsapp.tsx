/**
 * Integracion de WhatsApp, copiada de StockFlow (v0.1.78) y adaptada a los
 * tokens de Alpha:
 *
 *  - PanelWhatsApp: WhatsApp Web embebido en un <webview> con sesion
 *    PERSISTENTE, en el costado derecho de la ventana principal. El webview se
 *    crea UNA sola vez y queda montado (la sesion no se pierde al ocultarlo).
 *    Fluidez: el webview tiene ancho FIJO y se anima el contenedor que lo
 *    recorta, nunca la superficie nativa.
 *  - BotonWhatsApp: el boton verde en Clientes/Proveedores que abre el chat
 *    del contacto (IPC -> la ventana principal navega el panel).
 *  - aNumeroWhatsApp: normalizador argentino (54 9 + area sin 0 + numero
 *    sin 15). Best-effort: un fijo mal cargado puede no abrir el chat justo.
 */

import { useEffect, useRef, useState } from 'react';

const UA_WHATSAPP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const ANCHO_PANEL = 560;
// WhatsApp Web (2 paneles) necesita ~820px CSS; se escala para que entre justo.
const ZOOM_WHATSAPP = ANCHO_PANEL / 820;
const TRANSICION = 'width 300ms cubic-bezier(0.4,0,0.2,1)';
const VERDE_WHATSAPP = '#25D366';

/* ------------------------------ Normalizador ------------------------------- */

/** Convierte un telefono "a la argentina" al formato de WhatsApp (E.164 sin +). */
export function aNumeroWhatsApp(crudo: string | null | undefined): string | null {
  if (!crudo) return null;
  let digitos = crudo.replace(/\D/g, '');
  if (!digitos) return null;

  // Prefijo internacional "00".
  if (digitos.startsWith('00')) digitos = digitos.slice(2);

  // Ya trae el codigo de pais 54.
  if (digitos.startsWith('54')) {
    let resto = digitos.slice(2);
    if (resto.startsWith('9')) resto = resto.slice(1); // se re-agrega al final
    resto = resto.replace(/^0/, '');
    resto = resto.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2'); // sacar el 15
    return resto.length >= 8 ? `549${resto}` : null;
  }

  // Numero local: sacar el 0 de troncal y el 15 del celular.
  digitos = digitos.replace(/^0/, '');
  digitos = digitos.replace(/^(\d{2,4})15(\d{6,8})$/, '$1$2');
  return digitos.length >= 8 ? `549${digitos}` : null;
}

/* --------------------------------- Glifo ----------------------------------- */

export function GlifoWhatsApp({
  className,
  strokeWidth = 1.75,
}: {
  readonly className?: string;
  readonly strokeWidth?: number;
}): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 21l1.65-3.8a9 9 0 1 1 3.4 2.9l-5.05.9" />
      <path d="M9 10a.5.5 0 0 0 1 0V9a.5.5 0 0 0-1 0v1a5 5 0 0 0 5 5h1a.5.5 0 0 0 0-1h-1a.5.5 0 0 0 0 1" />
    </svg>
  );
}

/* --------------------------------- Boton ----------------------------------- */

/**
 * Boton verde para abrir el chat del contacto en el panel de la ventana
 * principal. Deshabilitado si el telefono no da un numero usable.
 */
export function BotonWhatsApp({
  telefono,
  className,
}: {
  readonly telefono: string | null | undefined;
  readonly className?: string;
}): JSX.Element {
  const numero = aNumeroWhatsApp(telefono);
  return (
    <button
      type="button"
      title={numero !== null ? 'Abrir chat de WhatsApp' : 'Sin telefono valido'}
      disabled={numero === null}
      onClick={(evento) => {
        evento.stopPropagation();
        if (numero !== null) window.alfajores?.whatsapp.abrirChat(numero);
      }}
      className={[
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none transition-colors',
        'hover:bg-menta-50 disabled:cursor-not-allowed disabled:opacity-30',
        className ?? '',
      ].join(' ')}
      style={{ color: VERDE_WHATSAPP }}
    >
      <GlifoWhatsApp className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/* --------------------------------- Panel ----------------------------------- */

type EstadoPanel = 'oculto' | 'abierto';

/**
 * Panel embebido de la ventana principal. Cerrado queda como lengueta verde en
 * el costado derecho (siempre visible: es el toggle); abierto muestra WhatsApp
 * Web completo con recargar/minimizar.
 */
export function PanelWhatsApp(): JSX.Element {
  const [estado, setEstado] = useState<EstadoPanel>('oculto');
  const cajaRef = useRef<HTMLDivElement>(null);
  const creadoRef = useRef(false);
  const urlPendienteRef = useRef<string | null>(null);

  const irAlChat = (telefono: string): void => {
    const url = `https://web.whatsapp.com/send?phone=${telefono}`;
    const wv = cajaRef.current?.querySelector('webview') as unknown as {
      loadURL?: (u: string) => void;
    } | null;
    if (wv?.loadURL) {
      try {
        wv.loadURL(url);
      } catch {
        urlPendienteRef.current = url;
      }
    } else {
      urlPendienteRef.current = url;
    }
  };

  // Pedido desde otra ventana (boton verde en Clientes/Proveedores).
  useEffect(() => {
    const puente = window.alfajores?.whatsapp;
    if (!puente) return;
    return puente.alNavegar((telefono) => {
      setEstado('abierto');
      irAlChat(telefono);
    });
  }, []);

  // Crea el <webview> la primera vez que se abre y lo deja montado.
  useEffect(() => {
    if (creadoRef.current || estado !== 'abierto') return;
    const caja = cajaRef.current;
    if (!caja) return;
    const wv = document.createElement('webview');
    wv.setAttribute('src', urlPendienteRef.current ?? 'https://web.whatsapp.com');
    urlPendienteRef.current = null;
    wv.setAttribute('partition', 'persist:whatsapp');
    wv.setAttribute('useragent', UA_WHATSAPP);
    wv.setAttribute('allowpopups', 'true');
    wv.style.width = '100%';
    wv.style.height = '100%';
    wv.style.border = '0';
    wv.addEventListener('dom-ready', () => {
      try {
        (wv as unknown as { setZoomFactor?: (z: number) => void }).setZoomFactor?.(ZOOM_WHATSAPP);
      } catch {
        // Sin zoom se ve mas grande; no es fatal.
      }
    });
    caja.appendChild(wv);
    creadoRef.current = true;
  }, [estado]);

  const recargar = (): void => {
    const wv = cajaRef.current?.querySelector('webview') as unknown as {
      reload?: () => void;
    } | null;
    wv?.reload?.();
  };

  const anchoPanel = estado === 'abierto' ? ANCHO_PANEL : 0;
  const anchoLengueta = estado === 'oculto' ? 40 : 0;

  return (
    <>
      {/* Contenedor que RECORTA: se anima el ancho de este, no el del webview. */}
      <div
        className="h-full shrink-0 overflow-hidden"
        style={{ width: anchoPanel, transition: TRANSICION }}
      >
        <div
          className="flex h-full flex-col border-l border-masa-200 bg-white"
          style={{ width: ANCHO_PANEL }}
        >
          <div
            className="flex items-center justify-between px-2 py-1.5 text-white"
            style={{ backgroundColor: VERDE_WHATSAPP }}
          >
            <span className="flex items-center gap-1.5 px-1 text-sm font-semibold">
              <GlifoWhatsApp className="h-4 w-4" strokeWidth={2} /> WhatsApp
            </span>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                title="Recargar"
                className="rounded-none p-1 transition hover:bg-white/20"
                onClick={recargar}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
              </button>
              <button
                type="button"
                title="Minimizar"
                className="rounded-none p-1 transition hover:bg-white/20"
                onClick={() => setEstado('oculto')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" strokeLinecap="round"><path d="M5 12h14" /></svg>
              </button>
            </div>
          </div>
          <div ref={cajaRef} className="min-h-0 flex-1" />
        </div>
      </div>

      {/* Lengueta verde: siempre visible cuando el panel esta cerrado. */}
      <button
        type="button"
        onClick={() => setEstado('abierto')}
        title="Abrir WhatsApp"
        tabIndex={estado === 'oculto' ? 0 : -1}
        className="flex h-full shrink-0 flex-col items-center gap-3 overflow-hidden whitespace-nowrap text-white hover:brightness-110"
        style={{ width: anchoLengueta, transition: TRANSICION, backgroundColor: VERDE_WHATSAPP }}
      >
        <span className="pt-4">
          <GlifoWhatsApp className="h-5 w-5" strokeWidth={2} />
        </span>
        <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">
          WhatsApp
        </span>
      </button>
    </>
  );
}
