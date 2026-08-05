/**
 * Punto de entrada del renderer.
 *
 * Un mismo bundle sirve a dos tipos de ventana:
 *   - La VENTANA PRINCIPAL: el escritorio con su chrome (menu, accesos directos,
 *     barra de estado y barra de tareas). No muestra datos.
 *   - Las VENTANAS DE MODULO: ruta `#/embedded/<clave>`, la pantalla sola.
 *
 * Cual de las dos se monta se decide por el hash, que el proceso main fija al
 * crear cada ventana.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  BarraAccesos,
  BarraEstado,
  BarraMenu,
  BarraTareas,
  BarraTitulo,
  Escritorio,
} from './componentes/chrome';
import { BuscadorGlobal, PaletaComandos } from './componentes/PaletaComandos';
import { usarRecurso } from './ganchos/usarRecurso';
import { obtenerSalud } from './servicios/cliente';
import type { DescriptorVentana } from './tipos-globales';
import { ACCESOS_DIRECTOS, definicionDeModulo, type ClaveModulo } from './ventanas';
import { VentanaEmbebida } from './VentanaEmbebida';

const PREFIJO_EMBEBIDA = '#/embedded/';

/** Devuelve la clave del modulo si este renderer es una ventana de modulo. */
function claveEmbebidaDesdeHash(hash: string): string | null {
  if (!hash.startsWith(PREFIJO_EMBEBIDA)) return null;
  const resto = hash.slice(PREFIJO_EMBEBIDA.length);
  const sinQuery = resto.split('?')[0] ?? '';
  return sinQuery === '' ? null : decodeURIComponent(sinQuery);
}

export default function App(): JSX.Element {
  const [claveEmbebida] = useState(() => claveEmbebidaDesdeHash(window.location.hash));

  if (claveEmbebida !== null) return <VentanaEmbebida clave={claveEmbebida} />;
  return <VentanaPrincipal />;
}

function VentanaPrincipal(): JSX.Element {
  const salud = usarRecurso(() => obtenerSalud(), []);
  const [ventanas, setVentanas] = useState<readonly DescriptorVentana[]>([]);
  const [paleta, setPaleta] = useState<{ abierta: boolean; consulta: string }>({
    abierta: false,
    consulta: '',
  });

  const puente = window.alfajores;
  const esMac = (puente?.plataforma ?? '') === 'darwin';

  // La lista de ventanas es estado del proceso main: se pide una vez al montar y
  // despues se actualiza sola con cada aviso.
  useEffect(() => {
    if (!puente) return;
    void puente.ventanas.listar().then(setVentanas).catch(() => setVentanas([]));
    return puente.ventanas.alCambiar(setVentanas);
  }, [puente]);

  const abrir = useCallback(
    (clave: ClaveModulo): void => {
      const definicion = definicionDeModulo(clave);
      puente?.ventanas.abrir(clave, definicion.titulo, definicion.icono);
    },
    [puente],
  );

  // Teclas de funcion: cada acceso directo abre su modulo, como en cualquier
  // sistema de gestion de escritorio.
  useEffect(() => {
    const alTeclear = (evento: KeyboardEvent): void => {
      // Cmd+K en macOS, Ctrl+K en el resto.
      if ((evento.metaKey || evento.ctrlKey) && evento.key.toLowerCase() === 'k') {
        evento.preventDefault();
        setPaleta({ abierta: true, consulta: '' });
        return;
      }
      const acceso = ACCESOS_DIRECTOS.find((a) => a.tecla === evento.key);
      if (!acceso) return;
      evento.preventDefault();
      abrir(acceso.clave);
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [abrir]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-masa-100 text-masa-900">
      {/* En Windows queda la barra nativa del sistema, con sus botones. */}
      {esMac && <BarraTitulo version={puente?.version ?? ''} />}

      <BarraMenu alAbrir={abrir} />
      <BarraAccesos alAbrir={abrir} />
      <BarraEstado
        salud={salud.datos}
        error={salud.error}
        buscador={<BuscadorGlobal alAbrir={(consulta) => setPaleta({ abierta: true, consulta })} />}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <Escritorio
          ventanasAbiertas={ventanas.length}
          alAbrir={abrir}
          urlPedidos={salud.datos?.urlPedidos ?? null}
        />
      </div>

      <BarraTareas
        ventanas={ventanas}
        alEnfocar={(id) => puente?.ventanas.enfocar(id)}
        alCerrar={(id) => puente?.ventanas.cerrar(id)}
      />

      <PaletaComandos
        abierta={paleta.abierta}
        consultaInicial={paleta.consulta}
        alCerrar={() => setPaleta({ abierta: false, consulta: '' })}
        alElegir={abrir}
      />
    </div>
  );
}
