/**
 * Tabla generica del ERP.
 *
 * Una sola implementacion para las catorce pantallas: encabezado fijo al
 * scrollear, alineacion a derecha y fuente monoespaciada para las columnas
 * numericas (que es lo que hace que las cifras se puedan comparar de un vistazo),
 * y filas clickeables opcionales.
 *
 * Es una `<table>` real con `<th scope>`, no divs: los lectores de pantalla y la
 * navegacion por teclado dependen de eso.
 */

import type { ReactNode } from 'react';

export interface Columna<T> {
  readonly clave: string;
  readonly titulo: string;
  /** Contenido de la celda. */
  readonly celda: (fila: T) => ReactNode;
  /** Numerica: alinea a derecha y usa la fuente mono con numeros tabulares. */
  readonly numerica?: boolean;
  /** Ancho fijo opcional, por ejemplo 'w-28'. */
  readonly ancho?: string;
}

interface Props<T> {
  readonly columnas: readonly Columna<T>[];
  readonly filas: readonly T[];
  readonly claveDeFila: (fila: T) => string | number;
  /** Si se pasa, las filas son clickeables. */
  readonly alSeleccionar?: (fila: T) => void;
  readonly filaSeleccionada?: (fila: T) => boolean;
  /** Resalta la fila como advertencia, por ejemplo stock bajo minimo. */
  readonly filaEnAlerta?: (fila: T) => boolean;
}

export function Tabla<T>({
  columnas,
  filas,
  claveDeFila,
  alSeleccionar,
  filaSeleccionada,
  filaEnAlerta,
}: Props<T>): JSX.Element {
  const esClickeable = alSeleccionar !== undefined;

  return (
    <div className="overflow-auto rounded-ficha border border-masa-200 bg-white shadow-ficha">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-masa-100">
            {columnas.map((columna) => (
              <th
                key={columna.clave}
                scope="col"
                className={[
                  'border-b border-masa-200 px-3 py-2 text-micro font-semibold uppercase tracking-wide text-masa-600',
                  columna.numerica === true ? 'text-right' : 'text-left',
                  columna.ancho ?? '',
                ].join(' ')}
              >
                {columna.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila) => {
            const seleccionada = filaSeleccionada?.(fila) === true;
            const enAlerta = filaEnAlerta?.(fila) === true;

            return (
              <tr
                key={claveDeFila(fila)}
                onClick={esClickeable ? () => alSeleccionar(fila) : undefined}
                onKeyDown={
                  esClickeable
                    ? (evento) => {
                        if (evento.key === 'Enter' || evento.key === ' ') {
                          evento.preventDefault();
                          alSeleccionar(fila);
                        }
                      }
                    : undefined
                }
                tabIndex={esClickeable ? 0 : undefined}
                className={[
                  'h-fila border-b border-masa-100 last:border-b-0',
                  seleccionada ? 'bg-dulce-100' : enAlerta ? 'bg-alerta-50' : 'bg-white',
                  esClickeable
                    ? 'cursor-pointer outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dulce-500'
                    : '',
                ].join(' ')}
              >
                {columnas.map((columna) => (
                  <td
                    key={columna.clave}
                    className={[
                      'px-3 py-1.5 text-masa-800',
                      columna.numerica === true ? 'text-right font-mono tabular-nums' : 'text-left',
                    ].join(' ')}
                  >
                    {columna.celda(fila)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
