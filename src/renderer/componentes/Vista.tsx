/**
 * Envoltorio de contenido de una pantalla.
 *
 * Resuelve una sola vez los tres estados que toda vista de lectura tiene
 * (cargando, error con reintento, vacia) para que cada pantalla se ocupe solo de
 * dibujar sus datos. Un modulo que falla muestra su error y no rompe el resto de
 * la aplicacion.
 */

import type { ReactNode } from 'react';

import type { EstadoRecurso } from '../ganchos/usarRecurso';
import { EstadoCargando, EstadoError, EstadoVacio } from './comunes';

interface Props<T> {
  readonly estado: EstadoRecurso<T[]>;
  readonly que: string;
  readonly tituloVacio: string;
  readonly detalleVacio: string;
  readonly comandoVacio?: string;
  readonly children: (datos: T[]) => ReactNode;
}

export function Vista<T>({
  estado,
  que,
  tituloVacio,
  detalleVacio,
  comandoVacio,
  children,
}: Props<T>): JSX.Element {
  if (estado.cargando) return <EstadoCargando que={que} />;
  if (estado.error !== null) return <EstadoError mensaje={estado.error} alReintentar={estado.recargar} />;

  const datos = estado.datos ?? [];
  if (datos.length === 0) {
    return (
      <EstadoVacio
        titulo={tituloVacio}
        detalle={detalleVacio}
        {...(comandoVacio !== undefined ? { comando: comandoVacio } : {})}
      />
    );
  }

  return <>{children(datos)}</>;
}

/** Sugerencia estandar para las pantallas que se llenan con el seed de demostracion. */
export const COMANDO_SEED_DEMO = 'ALFAJORES_SEED_DEMO=1 npm run db:seed';
