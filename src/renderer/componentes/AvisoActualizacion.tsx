/**
 * Cartel que aparece cuando ya se descargo una version nueva.
 *
 * El programa la baja solo en segundo plano, pero antes no avisaba nada: se
 * aplicaba recien al cerrar el programa, asi que quien lo deja abierto todo el
 * dia se quedaba en la version vieja sin enterarse. Ahora, apenas termina de
 * bajar, aparece este cartel con un boton que reinicia e instala en el acto.
 *
 * No interrumpe: es una franja arriba de todo, se puede posponer, y si se
 * ignora la actualizacion se aplica igual la proxima vez que se cierre.
 */

import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

export function AvisoActualizacion(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null);
  const [pospuesto, setPospuesto] = useState(false);

  useEffect(() => {
    const api = window.alfajores?.actualizaciones;
    if (api?.alHaberActualizacion === undefined) return;
    return api.alHaberActualizacion(setVersion);
  }, []);

  if (version === null || pospuesto) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 bg-dulce-600 px-4 py-2 text-sm text-white"
    >
      <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        La version <strong>{version}</strong> esta lista para instalar.
      </span>
      <button
        type="button"
        onClick={() => window.alfajores?.actualizaciones.instalarAhora()}
        className="rounded-ficha bg-white px-3 py-1 text-xs font-bold text-dulce-700 outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-white"
      >
        Reiniciar e instalar
      </button>
      <button
        type="button"
        onClick={() => setPospuesto(true)}
        aria-label="Instalar despues"
        title="Se instala igual al cerrar el programa"
        className="rounded-ficha p-1 outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-white"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
