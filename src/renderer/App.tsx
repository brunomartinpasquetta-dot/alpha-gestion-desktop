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
import { BotonAsistente, PanelAsistente } from './componentes/asistente';
import { PanelWhatsApp } from './componentes/whatsapp';
import { usarRecurso } from './ganchos/usarRecurso';
import { obtenerSalud } from './servicios/cliente';
import type { DescriptorVentana } from './tipos-globales';
import { ACCESOS_DIRECTOS, definicionDeModulo, type ClaveModulo } from './ventanas';
import { AvisoActualizacion } from './componentes/AvisoActualizacion';
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
  const [alfiAbierto, setAlfiAbierto] = useState(false);
  // El tablero fijado sobrevive al reinicio: es la pantalla de trabajo del dueño.
  const [tableroFijado, setTableroFijado] = useState(
    () => localStorage.getItem('alpha-tablero-fijado') === 'si',
  );
  const fijarTablero = (fijado: boolean): void => {
    setTableroFijado(fijado);
    localStorage.setItem('alpha-tablero-fijado', fijado ? 'si' : 'no');
  };

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
      // "Ver tablero" no abre ventana: fija el tablero en el panel principal.
      if (clave === 'tablero') {
        setTableroFijado(true);
        localStorage.setItem('alpha-tablero-fijado', 'si');
        return;
      }
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
      {/* Arriba de todo: si hay una version lista, se ve apenas se abre. */}
      <AvisoActualizacion />

      {/* La barra de marca ES el topbar de la ventana en las dos plataformas:
          en Mac deja lugar al semaforo, en Windows a los botones del overlay. */}
      {puente !== undefined && <BarraTitulo version={puente.version} esMac={esMac} />}

      <BarraMenu alAbrir={abrir} />
      <BarraAccesos alAbrir={abrir} />
      <BarraEstado
        salud={salud.datos}
        error={salud.error}
        buscador={
          <div className="flex items-center gap-2">
            <BuscadorGlobal alAbrir={(consulta) => setPaleta({ abierta: true, consulta })} />
            <BotonAsistente abierto={alfiAbierto} alAlternar={() => setAlfiAbierto((v) => !v)} />
          </div>
        }
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Alfi a la izquierda, WhatsApp a la derecha: cada asistente en su
            margen, para que abrir uno no empuje al otro. */}
        <PanelAsistente abierto={alfiAbierto} alCerrar={() => setAlfiAbierto(false)} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <Escritorio tableroFijado={tableroFijado} alCerrarTablero={() => fijarTablero(false)} />
        </div>
        <PanelWhatsApp />
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
