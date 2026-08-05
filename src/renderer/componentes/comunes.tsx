/**
 * Piezas de interfaz compartidas por todas las pantallas: pastillas de estado,
 * tarjetas de indicador y los tres estados de una vista (cargando, error, vacia).
 *
 * Todos los colores salen de los tokens del producto definidos en
 * tailwind.config.cjs. No se usan grises frios de Tailwind en ningun lado.
 */

import type { ReactNode } from 'react';

/* --------------------------------- Pastilla -------------------------------- */

/**
 * Tonos SEMANTICOS. Ninguno usa el caramelo de la marca: el color de marca
 * identifica al producto (barra de titulo, menu activo, foco), no comunica
 * informacion. Un rol o un estado pintado de marron se lee como decoracion.
 */
export type TonoPastilla = 'neutro' | 'positivo' | 'alerta' | 'peligro' | 'info';

const CLASES_PASTILLA: Readonly<Record<TonoPastilla, string>> = {
  neutro: 'bg-masa-100 text-masa-800 ring-masa-200',
  positivo: 'bg-menta-50 text-menta-700 ring-menta-200',
  alerta: 'bg-alerta-50 text-alerta-700 ring-alerta-200',
  peligro: 'bg-peligro-50 text-peligro-600 ring-peligro-200',
  info: 'bg-info-50 text-info-700 ring-info-200',
};

export function Pastilla({
  texto,
  tono = 'neutro',
}: {
  readonly texto: string;
  readonly tono?: TonoPastilla;
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-pastilla px-2 py-0.5 text-micro font-medium ring-1 ring-inset ${CLASES_PASTILLA[tono]}`}
    >
      {texto}
    </span>
  );
}

/* ------------------------------ Estados de vista --------------------------- */

export function EstadoCargando({ que = 'los datos' }: { readonly que?: string }): JSX.Element {
  return (
    <div className="flex items-center gap-3 rounded-ficha border border-masa-200 bg-white px-4 py-8 text-masa-700 shadow-ficha">
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-dulce-500" aria-hidden="true" />
      <span>Cargando {que}...</span>
    </div>
  );
}

export function EstadoError({
  mensaje,
  alReintentar,
}: {
  readonly mensaje: string;
  readonly alReintentar: () => void;
}): JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-ficha border border-peligro-200 bg-peligro-50 px-4 py-5 shadow-ficha"
    >
      <p className="font-semibold text-peligro-600">No se pudieron cargar los datos</p>
      <p className="mt-1 text-sm text-peligro-600">{mensaje}</p>
      <button
        type="button"
        onClick={alReintentar}
        className="mt-3 rounded-pastilla bg-peligro-600 px-3 py-1.5 text-sm font-medium text-white outline-none hover:bg-peligro-700 focus-visible:ring-2 focus-visible:ring-peligro-400"
      >
        Reintentar
      </button>
    </div>
  );
}

export function EstadoVacio({
  titulo,
  detalle,
  comando,
}: {
  readonly titulo: string;
  readonly detalle: string;
  /** Comando de consola sugerido para poblar la pantalla. */
  readonly comando?: string;
}): JSX.Element {
  return (
    <div className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-10 text-center">
      <p className="font-semibold text-masa-800">{titulo}</p>
      <p className="mx-auto mt-1 max-w-xl text-sm text-masa-700">{detalle}</p>
      {comando !== undefined && (
        <code className="mt-3 inline-block rounded-pastilla bg-masa-800 px-3 py-1.5 font-mono text-xs text-masa-50">
          {comando}
        </code>
      )}
    </div>
  );
}

/* ----------------------------- Tarjeta indicador --------------------------- */

export function TarjetaIndicador({
  rotulo,
  valor,
  detalle,
  tono = 'neutro',
}: {
  readonly rotulo: string;
  readonly valor: string;
  readonly detalle?: string;
  readonly tono?: TonoPastilla;
}): JSX.Element {
  const acento: Readonly<Record<TonoPastilla, string>> = {
    neutro: 'text-masa-900',
    positivo: 'text-menta-700',
    alerta: 'text-alerta-700',
    peligro: 'text-peligro-600',
    info: 'text-info-700',
  };

  return (
    <div className="rounded-ficha border border-masa-200 bg-white px-4 py-3 shadow-ficha">
      <p className="text-micro font-semibold uppercase tracking-wide text-masa-700">{rotulo}</p>
      <p className={`mt-1 font-mono text-2xl tabular-nums ${acento[tono]}`}>{valor}</p>
      {detalle !== undefined && <p className="mt-0.5 text-xs text-masa-700">{detalle}</p>}
    </div>
  );
}

/* ---------------------------------- Seccion -------------------------------- */

export function Seccion({
  titulo,
  acciones,
  children,
}: {
  readonly titulo: string;
  readonly acciones?: ReactNode;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">{titulo}</h2>
        {acciones}
      </div>
      {children}
    </section>
  );
}
