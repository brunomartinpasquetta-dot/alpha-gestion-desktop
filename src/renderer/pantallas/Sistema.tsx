/**
 * Pantallas del menu Archivo (estructura copiada de StockFlow): la
 * configuracion LAN, el respaldo de la base y el formato de impresion.
 * "Mi Empresa" es la pantalla de facturacion/ARCA que ya existia, renombrada.
 */

import { useState } from 'react';

import type { RespuestaSalud } from '../../compartido/contratos';
import { Seccion } from '../componentes/comunes';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerSalud } from '../servicios/cliente';

/* ---------------------------- Configuracion LAN ---------------------------- */

export function PantallaConfiguracionLan(): JSX.Element {
  const salud = usarRecurso<RespuestaSalud>(() => obtenerSalud(), []);
  const datos = salud.datos;
  return (
    <div className="max-w-2xl space-y-4">
      <Seccion titulo="Acceso desde la red local">
        <div className="space-y-3 rounded-ficha border border-masa-200 bg-white p-4 text-sm text-masa-900">
          <p>
            El sistema publica dos pantallas para otros dispositivos del mismo WiFi. No hay que
            instalar nada: se abren desde el navegador.
          </p>
          <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wide text-masa-700">
              Carga de pedidos (celular)
            </p>
            <p className="font-mono text-base font-bold text-dulce-700">
              {datos?.urlPedidos ?? 'Sin red: el servidor solo escucha en esta maquina'}
            </p>
          </div>
          <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wide text-masa-700">
              Monitor de elaboracion (tablet de fabrica)
            </p>
            <p className="font-mono text-base font-bold text-dulce-700">
              {datos?.urlElaboracion ?? 'Sin red: el servidor solo escucha en esta maquina'}
            </p>
          </div>
          <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wide text-masa-700">
              PIN de acceso desde la red
            </p>
            {datos?.pinConfigurado === true ? (
              <p>
                Configurado: cualquier dispositivo de la red tiene que ingresar el PIN una vez.
              </p>
            ) : (
              <p>
                Sin configurar: cualquiera en el WiFi de la fabrica puede entrar. Para exigir un
                PIN, pedile a BPSG que configure la variable ALFAJORES_PIN_PEDIDOS en esta maquina.
              </p>
            )}
          </div>
        </div>
      </Seccion>
    </div>
  );
}

/* ----------------------------- Backup / Restaurar -------------------------- */

async function llamarSistema<T>(ruta: string, cuerpo?: unknown): Promise<T> {
  const r = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
  const json = (await r.json()) as { datos?: T; error?: { mensaje?: string } };
  if (!r.ok || json.datos === undefined) {
    throw new Error(json.error?.mensaje ?? `El servidor respondio ${r.status}.`);
  }
  return json.datos;
}

export function PantallaRespaldo(): JSX.Element {
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const respaldar = (): void => {
    setOcupado(true);
    setResultado(null);
    llamarSistema<{ ruta: string }>('/api/sistema/respaldar')
      .then(({ ruta }) => setResultado({ tono: 'ok', texto: `Respaldo creado en ${ruta}. Guardalo en un pendrive o en la nube.` }))
      .catch((causa: unknown) =>
        setResultado({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      )
      .finally(() => setOcupado(false));
  };

  const restaurar = async (): Promise<void> => {
    const puente = window.alfajores;
    if (!puente) return;
    const ruta = await puente.archivos.elegir('Elegi el respaldo a restaurar', ['db']);
    if (ruta === null) return;
    const confirmado = window.confirm(
      'RESTAURAR reemplaza TODOS los datos actuales por los del respaldo elegido.\n\n' +
        'La base actual queda resguardada al lado por si hay que volver.\n\n' +
        'El programa se va a reiniciar. ¿Continuar?',
    );
    if (!confirmado) return;
    setOcupado(true);
    setResultado(null);
    try {
      await llamarSistema<{ ok: boolean }>('/api/sistema/restaurar', { ruta });
      puente.sistema.reiniciar();
    } catch (causa) {
      setResultado({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) });
      setOcupado(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Seccion titulo="Copia de seguridad">
        <div className="space-y-3 rounded-ficha border border-masa-200 bg-white p-4 text-sm text-masa-900">
          <p>
            El respaldo es una copia completa de la base (clientes, pedidos, stock, ventas, caja).
            Conviene hacerlo seguido y guardarlo FUERA de esta computadora.
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={respaldar}
            className="h-11 rounded-none border border-dulce-400 bg-dulce-500 px-5 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {ocupado ? 'Trabajando...' : 'Crear respaldo ahora'}
          </button>
        </div>
      </Seccion>
      <Seccion titulo="Restaurar desde un respaldo">
        <div className="space-y-3 rounded-ficha border border-alerta-300 bg-alerta-50 p-4 text-sm text-masa-900">
          <p>
            Restaurar reemplaza los datos actuales por los del archivo elegido y reinicia el
            programa. La base actual queda resguardada junto a la restaurada por si hay que volver.
          </p>
          <button
            type="button"
            disabled={ocupado}
            onClick={() => void restaurar()}
            className="h-11 rounded-none border border-alerta-500 bg-alerta-600 px-5 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-40"
          >
            Elegir respaldo y restaurar
          </button>
        </div>
      </Seccion>
      {resultado !== null && (
        <p
          className={[
            'rounded-ficha border px-3 py-2 text-sm',
            resultado.tono === 'ok'
              ? 'border-menta-300 bg-menta-50 text-menta-800'
              : 'border-peligro-300 bg-peligro-50 text-peligro-700',
          ].join(' ')}
        >
          {resultado.texto}
        </p>
      )}
    </div>
  );
}

/* --------------------------- Configuracion impresion ----------------------- */

const CLAVE_IMPRESION = 'alpha-impresion';

export interface PreferenciasImpresion {
  /** a4 = hoja comun; ticket = impresora termica de 80 mm. */
  papel: 'a4' | 'ticket';
  /** Texto que se agrega al pie de cada comprobante. */
  pie: string;
}

export function leerPreferenciasImpresion(): PreferenciasImpresion {
  try {
    const crudo = localStorage.getItem(CLAVE_IMPRESION);
    if (crudo !== null) {
      const dato = JSON.parse(crudo) as Partial<PreferenciasImpresion>;
      return { papel: dato.papel === 'ticket' ? 'ticket' : 'a4', pie: typeof dato.pie === 'string' ? dato.pie : '' };
    }
  } catch {
    // Preferencias rotas: se vuelve al default.
  }
  return { papel: 'a4', pie: '' };
}

export function PantallaConfiguracionImpresion(): JSX.Element {
  const [prefs, setPrefs] = useState<PreferenciasImpresion>(() => leerPreferenciasImpresion());
  const [guardado, setGuardado] = useState(false);

  const guardar = (): void => {
    localStorage.setItem(CLAVE_IMPRESION, JSON.stringify(prefs));
    setGuardado(true);
    setTimeout(() => setGuardado(false), 3000);
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Seccion titulo="Formato de los comprobantes">
        <div className="space-y-4 rounded-ficha border border-masa-200 bg-white p-4 text-sm text-masa-900">
          <div>
            <p className="mb-1.5 text-micro font-bold uppercase tracking-wide text-masa-700">Papel</p>
            {(
              [
                ['a4', 'Hoja A4 (impresora comun; desde el dialogo tambien se guarda en PDF)'],
                ['ticket', 'Ticket 80 mm (impresora termica de mostrador)'],
              ] as const
            ).map(([valor, etiqueta]) => (
              <label key={valor} className="flex cursor-pointer items-start gap-2 py-0.5">
                <input
                  type="radio"
                  name="papel"
                  checked={prefs.papel === valor}
                  onChange={() => setPrefs((p) => ({ ...p, papel: valor }))}
                  className="mt-0.5 accent-dulce-600"
                />
                {etiqueta}
              </label>
            ))}
          </div>
          <div>
            <label htmlFor="imp-pie" className="mb-1 block text-micro font-bold uppercase tracking-wide text-masa-700">
              Leyenda al pie (opcional)
            </label>
            <input
              id="imp-pie"
              value={prefs.pie}
              onChange={(e) => setPrefs((p) => ({ ...p, pie: e.target.value }))}
              maxLength={120}
              placeholder="Gracias por su compra"
              className="h-10 w-full rounded-none border border-masa-300 px-2"
            />
          </div>
          <button
            type="button"
            onClick={guardar}
            className="h-10 rounded-none border border-dulce-400 bg-dulce-500 px-5 text-sm font-bold uppercase tracking-wide text-white"
          >
            Guardar
          </button>
          {guardado && <p className="text-xs font-medium text-menta-700">Guardado. Se aplica a los proximos comprobantes.</p>}
        </div>
      </Seccion>
    </div>
  );
}
