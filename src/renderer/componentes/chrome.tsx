/**
 * Chrome de la ventana principal: las cuatro franjas fijas que enmarcan el
 * escritorio, de arriba a abajo.
 *
 *   BarraTitulo      solo macOS, arrastrable
 *   BarraMenu        menus clasicos desplegables
 *   BarraAccesos     accesos directos grandes con su tecla de funcion
 *   BarraEstado      servidor, base, hora
 *   ... escritorio ...
 *   BarraTareas      una pastilla por ventana de modulo abierta
 *
 * Los modulos NO se abren adentro de esta ventana: cada uno es una ventana
 * nativa del sistema operativo. Por eso la barra de tareas es la unica forma de
 * volver a una ventana que quedo atras o minimizada.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';

import type { DescriptorVentana } from '../tipos-globales';
import {
  ACCESOS_DIRECTOS,
  MENUS,
  definicionDeModulo,
  type ClaveModulo,
} from '../ventanas';
import { Icono } from './Icono';
import { Logo } from './Logo';
import type { RespuestaSalud } from '../../compartido/contratos';

/* --------------------------------- Titulo --------------------------------- */

export function BarraTitulo({ version }: { readonly version: string }): JSX.Element {
  return (
    <div
      className="relative flex h-8 shrink-0 items-center bg-dulce-600 text-white"
      style={{ WebkitAppRegion: 'drag' } as CSSProperties}
    >
      <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold tracking-tight">
        ALPHA GESTIÓN{version === '' ? '' : ` — v${version}`}
      </span>
    </div>
  );
}

/* ---------------------------------- Menu ---------------------------------- */

export function BarraMenu({
  alAbrir,
}: {
  readonly alAbrir: (clave: ClaveModulo) => void;
}): JSX.Element {
  const [abierto, setAbierto] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);

  // Un clic afuera cierra el desplegable. Sin esto el menu queda pegado abierto.
  useEffect(() => {
    if (abierto === null) return;
    const alClic = (evento: MouseEvent): void => {
      if (!contenedor.current?.contains(evento.target as Node)) setAbierto(null);
    };
    const alEscape = (evento: KeyboardEvent): void => {
      if (evento.key === 'Escape') setAbierto(null);
    };
    document.addEventListener('mousedown', alClic);
    document.addEventListener('keydown', alEscape);
    return () => {
      document.removeEventListener('mousedown', alClic);
      document.removeEventListener('keydown', alEscape);
    };
  }, [abierto]);

  return (
    <div
      ref={contenedor}
      className="relative z-30 flex h-8 shrink-0 items-center gap-0.5 border-b border-masa-200 bg-masa-50 px-2"
    >
      {MENUS.map((menu) => {
        const activo = abierto === menu.nombre;
        return (
          <div key={menu.nombre} className="relative">
            <button
              type="button"
              aria-expanded={activo}
              onClick={() => setAbierto(activo ? null : menu.nombre)}
              // Con un menu ya abierto, pasar el mouse cambia de menu, como en
              // cualquier aplicacion de escritorio.
              onMouseEnter={() => abierto !== null && setAbierto(menu.nombre)}
              className={[
                'rounded px-2.5 py-1 text-[13px] outline-none transition-colors',
                activo ? 'bg-dulce-500 text-white' : 'text-masa-900 hover:bg-masa-200',
                'focus-visible:ring-2 focus-visible:ring-dulce-400',
              ].join(' ')}
            >
              {menu.nombre}
            </button>

            {activo && (
              <div className="absolute left-0 top-full mt-0.5 min-w-56 rounded-ficha border border-masa-200 bg-white py-1 shadow-panel">
                {menu.items.map((item) => {
                  const definicion = definicionDeModulo(item.clave);
                  return (
                    <button
                      key={item.clave}
                      type="button"
                      onClick={() => {
                        setAbierto(null);
                        alAbrir(item.clave);
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-masa-900 outline-none hover:bg-dulce-500 hover:text-white focus-visible:bg-dulce-500 focus-visible:text-white"
                    >
                      <Icono nombre={definicion.icono} className="h-4 w-4 shrink-0" />
                      {definicion.titulo}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------------- Accesos --------------------------------- */

export function BarraAccesos({
  alAbrir,
}: {
  readonly alAbrir: (clave: ClaveModulo) => void;
}): JSX.Element {
  return (
    <div className="flex h-20 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-masa-200 bg-white px-3">
      {ACCESOS_DIRECTOS.map((acceso) => {
        const definicion = definicionDeModulo(acceso.clave);
        return (
          <button
            key={acceso.clave}
            type="button"
            onClick={() => alAbrir(acceso.clave)}
            title={definicion.descripcion}
            className="group flex h-16 w-[5.25rem] shrink-0 flex-col items-center justify-center gap-1 rounded-ficha px-1 outline-none transition-colors hover:bg-dulce-500 hover:text-white focus-visible:bg-dulce-500 focus-visible:text-white"
          >
            <Icono
              nombre={definicion.icono}
              className="h-7 w-7 text-masa-700 group-hover:text-white group-focus-visible:text-white"
            />
            <span className="text-center text-[11px] leading-tight text-masa-800 group-hover:text-white group-focus-visible:text-white">
              {definicion.etiqueta}
            </span>
            <span className="rounded bg-masa-100 px-1 text-[10px] font-medium text-masa-700 group-hover:bg-white/25 group-hover:text-white group-focus-visible:bg-white/25 group-focus-visible:text-white">
              {acceso.tecla}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* --------------------------------- Estado --------------------------------- */

export function BarraEstado({
  salud,
  error,
  buscador,
}: {
  readonly salud: RespuestaSalud | null;
  readonly error: string | null;
  /** Slot para el buscador global: la barra no conoce la paleta de comandos. */
  readonly buscador?: JSX.Element;
}): JSX.Element {
  const [ahora, setAhora] = useState(() => new Date());

  useEffect(() => {
    const reloj = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(reloj);
  }, []);

  const conectado = error === null && salud?.db.ok === true;
  const hora = ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex h-10 shrink-0 items-center gap-3 border-b border-masa-200 bg-masa-50 px-3 text-sm">
      {buscador}

      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${conectado ? 'bg-menta-500' : 'bg-peligro-500'}`}
        />
        <span className="text-masa-800">
          {conectado ? 'Servidor conectado' : 'Servidor sin respuesta'}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        {salud !== null && (
          <span
            className="block truncate font-mono text-micro text-masa-700"
            title={salud.db.rutaDb}
          >
            {salud.db.rutaDb}
          </span>
        )}
        {error !== null && <span className="text-micro text-peligro-600">{error}</span>}
      </div>

      {salud !== null && (
        <span className="shrink-0 font-mono text-micro text-masa-700">
          {salud.db.tablas} tablas · {salud.entorno}
        </span>
      )}
      <span className="shrink-0 font-mono text-xs tabular-nums text-masa-700">{hora}</span>
    </div>
  );
}

/* --------------------------------- Tareas --------------------------------- */

export function BarraTareas({
  ventanas,
  alEnfocar,
  alCerrar,
}: {
  readonly ventanas: readonly DescriptorVentana[];
  readonly alEnfocar: (id: number) => void;
  readonly alCerrar: (id: number) => void;
}): JSX.Element {
  if (ventanas.length === 0) {
    return (
      <div className="flex h-10 shrink-0 items-center border-t border-masa-200 bg-masa-100 px-3 text-micro text-masa-700">
        No hay ventanas abiertas. Abri un modulo desde el menu o los accesos directos.
      </div>
    );
  }

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-t border-masa-200 bg-masa-100 px-2">
      {ventanas.map((ventana) => {
        const activa = ventana.enfocada && !ventana.minimizada;
        return (
          <div
            key={ventana.id}
            className={[
              'flex h-7 min-w-0 max-w-56 shrink-0 items-center gap-1 rounded-pastilla border px-2 text-xs',
              activa
                ? 'border-dulce-300 bg-dulce-100 text-dulce-800'
                : ventana.minimizada
                  ? 'border-masa-200 bg-masa-50 text-masa-700'
                  : 'border-masa-200 bg-white text-masa-800',
            ].join(' ')}
          >
            <button
              type="button"
              onClick={() => alEnfocar(ventana.id)}
              className="inline-flex min-w-0 flex-1 items-center gap-1.5 outline-none focus-visible:underline"
              title={ventana.titulo}
            >
              <Icono nombre={ventana.icono} className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{ventana.titulo}</span>
            </button>
            <button
              type="button"
              onClick={() => alCerrar(ventana.id)}
              aria-label={`Cerrar ${ventana.titulo}`}
              className="rounded p-0.5 text-masa-700 outline-none hover:bg-peligro-500 hover:text-white focus-visible:bg-peligro-500 focus-visible:text-white"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- Escritorio -------------------------------- */

/**
 * Fondo de la ventana principal. No muestra datos a proposito: los datos viven
 * en las ventanas de modulo. Aca solo va la marca y el estado general.
 */
export function Escritorio({
  ventanasAbiertas,
  alAbrir,
  urlPedidos,
}: {
  readonly ventanasAbiertas: number;
  readonly alAbrir: (clave: ClaveModulo) => void;
  /** URL de la PWA del celular en la LAN, para mostrarsela al dueño. */
  readonly urlPedidos?: string | null;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-masa-50 to-masa-200 px-8">
      <Logo tamano={148} conNombre />
      <p className="mt-2 text-sm text-masa-700">Gestión y producción de alfajores</p>

      {typeof urlPedidos === 'string' && (
        <p className="mt-5 rounded-pastilla border border-masa-300 bg-white px-4 py-2 text-sm text-masa-800 shadow-ficha">
          Pedidos desde el celular:{' '}
          <span className="select-all font-mono font-semibold text-dulce-700">{urlPedidos}</span>
        </p>
      )}
      {/* Firma BPSG canonica (ver cerebro modulos/firma-bpsg): tenue, BPSG en negrita. */}
      <p className="mt-3 select-none text-[10px] tracking-tight text-masa-500">
        © 2026 · Crafted by <span className="font-bold">BPSG</span>
      </p>

      {ventanasAbiertas === 0 && (
        <>
          <p className="mt-8 text-xs uppercase tracking-widest text-masa-700">Para empezar</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {(['pedidos', 'stock-insumos', 'ordenes'] as const).map((clave) => {
              const definicion = definicionDeModulo(clave);
              return (
                <button
                  key={clave}
                  type="button"
                  onClick={() => alAbrir(clave)}
                  className="inline-flex items-center gap-2 rounded-pastilla border border-masa-300 bg-white px-3 py-1.5 text-sm text-masa-800 shadow-ficha outline-none transition-colors hover:border-dulce-400 hover:text-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400"
                >
                  <Icono nombre={definicion.icono} className="h-4 w-4" />
                  {definicion.titulo}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
