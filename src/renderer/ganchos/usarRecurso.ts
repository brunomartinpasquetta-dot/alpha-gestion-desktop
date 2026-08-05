/**
 * Hook generico de carga de datos.
 *
 * Cada pantalla del ERP hace lo mismo: pedir, mostrar cargando, mostrar error con
 * reintento, mostrar datos. En vez de repetir ese ciclo catorce veces, vive aca.
 *
 * Detalle importante: se descarta la respuesta de una peticion vieja si mientras
 * tanto se disparo otra (o se desmonto el componente). Sin eso, cambiar rapido de
 * modulo puede hacer que la respuesta lenta de la pantalla anterior pise a la
 * nueva.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface EstadoRecurso<T> {
  readonly datos: T | null;
  readonly cargando: boolean;
  readonly error: string | null;
  readonly recargar: () => void;
}

export function usarRecurso<T>(
  obtener: () => Promise<T>,
  dependencias: readonly unknown[] = [],
): EstadoRecurso<T> {
  const [datos, setDatos] = useState<T | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Identifica la peticion vigente; las respuestas de peticiones viejas se ignoran. */
  const peticionVigente = useRef(0);

  // `obtener` suele venir como lambda nueva en cada render: la guardamos en una
  // ref para que el efecto dependa solo de `dependencias` y no cicle.
  const obtenerRef = useRef(obtener);
  obtenerRef.current = obtener;

  const [disparador, setDisparador] = useState(0);
  const recargar = useCallback(() => setDisparador((valor) => valor + 1), []);

  useEffect(() => {
    const miPeticion = peticionVigente.current + 1;
    peticionVigente.current = miPeticion;

    setCargando(true);
    setError(null);

    obtenerRef
      .current()
      .then((resultado) => {
        if (peticionVigente.current !== miPeticion) return;
        setDatos(resultado);
        setCargando(false);
      })
      .catch((causa: unknown) => {
        if (peticionVigente.current !== miPeticion) return;
        setError(causa instanceof Error ? causa.message : String(causa));
        setCargando(false);
      });

    return () => {
      // Invalida esta peticion: si la respuesta llega despues, se descarta.
      if (peticionVigente.current === miPeticion) peticionVigente.current = miPeticion + 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disparador, ...dependencias]);

  return { datos, cargando, error, recargar };
}
