/**
 * Barra de filtros comun a Pedidos, Elaboracion y Movimientos de stock.
 *
 * Una sola fila, siempre en el mismo orden, con el resumen de lo filtrado a la
 * derecha: el que mira la pantalla tiene que saber de un vistazo QUE esta
 * viendo y poder volver a "todo" con un solo boton.
 *
 * Los atajos de fecha (Hoy / Semana / Mes) son lo que se usa el 90% del tiempo
 * en la fabrica; el rango a mano queda para el caso raro.
 */

import type { ReactNode } from 'react';

export interface RangoFechas {
  /** ISO corto (AAAA-MM-DD) o '' = sin limite. */
  desde: string;
  hasta: string;
}

export const RANGO_VACIO: RangoFechas = { desde: '', hasta: '' };

/** AAAA-MM-DD del dia local (no UTC: la fabrica trabaja en hora local). */
function isoLocal(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function rangoHoy(): RangoFechas {
  const hoy = isoLocal(new Date());
  return { desde: hoy, hasta: hoy };
}

export function rangoUltimosDias(dias: number): RangoFechas {
  const hasta = new Date();
  const desde = new Date();
  desde.setDate(desde.getDate() - (dias - 1));
  return { desde: isoLocal(desde), hasta: isoLocal(hasta) };
}

/** true si la fecha ISO del registro cae dentro del rango (bordes incluidos). */
export function entraEnRango(fechaIso: string, rango: RangoFechas): boolean {
  if (rango.desde === '' && rango.hasta === '') return true;
  const dia = isoLocal(new Date(fechaIso));
  if (rango.desde !== '' && dia < rango.desde) return false;
  if (rango.hasta !== '' && dia > rango.hasta) return false;
  return true;
}

const CLASE_CAMPO = 'h-9 rounded-none border border-masa-300 bg-white px-2 text-sm text-masa-900';
const CLASE_ATAJO =
  'h-9 rounded-none border px-3 text-xs font-bold uppercase tracking-wide transition-colors';

export function BarraFiltros({
  rango,
  alCambiarRango,
  texto,
  alCambiarTexto,
  placeholderTexto = 'Buscar...',
  selectores,
  resumen,
  alLimpiar,
  hayFiltros,
}: {
  readonly rango: RangoFechas;
  readonly alCambiarRango: (rango: RangoFechas) => void;
  /** Buscador libre. Si no se pasa, la barra no lo muestra. */
  readonly texto?: string;
  readonly alCambiarTexto?: (texto: string) => void;
  readonly placeholderTexto?: string;
  /** Selectores propios de cada pantalla (cliente, estado, tipo...). */
  readonly selectores?: ReactNode;
  /** Texto corto con lo que se esta viendo: "12 de 40 pedidos". */
  readonly resumen?: string;
  readonly alLimpiar: () => void;
  readonly hayFiltros: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
      <span className="text-micro font-bold uppercase tracking-wide text-masa-700">Desde</span>
      <input
        type="date"
        value={rango.desde}
        onChange={(e) => alCambiarRango({ ...rango, desde: e.target.value })}
        className={CLASE_CAMPO}
      />
      <span className="text-micro font-bold uppercase tracking-wide text-masa-700">Hasta</span>
      <input
        type="date"
        value={rango.hasta}
        onChange={(e) => alCambiarRango({ ...rango, hasta: e.target.value })}
        className={CLASE_CAMPO}
      />

      {selectores}

      {alCambiarTexto !== undefined && (
        <input
          value={texto ?? ''}
          onChange={(e) => alCambiarTexto(e.target.value)}
          placeholder={placeholderTexto}
          className={`${CLASE_CAMPO} min-w-44 flex-1`}
        />
      )}

      {hayFiltros && (
        <button
          type="button"
          onClick={alLimpiar}
          className={`${CLASE_ATAJO} border-peligro-300 bg-white text-peligro-700`}
        >
          Limpiar
        </button>
      )}
      {resumen !== undefined && (
        <span className="ml-auto text-xs font-medium text-masa-700">{resumen}</span>
      )}
    </div>
  );
}

/** Selector suelto con la estetica de la barra (cliente, estado, tipo...). */
export function SelectorFiltro<T extends string | number>({
  valor,
  alCambiar,
  vacio,
  opciones,
}: {
  readonly valor: T | '';
  readonly alCambiar: (valor: T | '') => void;
  readonly vacio: string;
  readonly opciones: readonly { readonly valor: T; readonly etiqueta: string }[];
}): JSX.Element {
  return (
    <select
      value={valor}
      onChange={(e) => {
        const bruto = e.target.value;
        if (bruto === '') return alCambiar('');
        const encontrada = opciones.find((o) => String(o.valor) === bruto);
        alCambiar(encontrada?.valor ?? '');
      }}
      className={CLASE_CAMPO}
    >
      <option value="">{vacio}</option>
      {opciones.map((o) => (
        <option key={String(o.valor)} value={String(o.valor)}>
          {o.etiqueta}
        </option>
      ))}
    </select>
  );
}
