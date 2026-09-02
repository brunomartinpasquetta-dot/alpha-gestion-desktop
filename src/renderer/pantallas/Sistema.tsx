/**
 * Pantallas del menu Archivo (estructura copiada de StockFlow): la
 * configuracion LAN, el respaldo de la base y el formato de impresion.
 * "Mi Empresa" es la pantalla de facturacion/ARCA que ya existia, renombrada.
 */

import { useEffect, useState } from 'react';

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
          <SeccionPin alCambiar={salud.recargar} />
        </div>
      </Seccion>
      <SeccionTunel />
    </div>
  );
}

/* ----------------------------- PIN de acceso ------------------------------- */

function SeccionPin({ alCambiar }: { readonly alCambiar: () => void }): JSX.Element {
  const estado = usarRecurso<{ pinConfigurado: boolean }>(
    () => fetch('/api/sistema/acceso-remoto').then(async (r) => ((await r.json()) as { datos: { pinConfigurado: boolean } }).datos),
    [],
  );
  const [pin, setPin] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);

  const guardar = async (nuevo: string): Promise<void> => {
    const r = await fetch('/api/sistema/pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin: nuevo }),
    });
    const cuerpo = (await r.json()) as { datos?: unknown; error?: { mensaje?: string } };
    if (!r.ok) {
      setAviso(cuerpo.error?.mensaje ?? 'No se pudo guardar el PIN.');
      return;
    }
    setPin('');
    setAviso(nuevo === '' ? 'PIN eliminado.' : 'PIN guardado. Los dispositivos van a pedirlo una vez.');
    estado.recargar();
    alCambiar();
  };

  return (
    <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
      <p className="text-micro font-bold uppercase tracking-wide text-masa-700">
        PIN de acceso (red y remoto)
      </p>
      <p className="mt-1 text-xs text-masa-700">
        {estado.datos?.pinConfigurado === true
          ? 'Configurado: cada dispositivo lo ingresa una vez. Para el acceso desde internet es obligatorio.'
          : 'Sin configurar: cualquiera del WiFi puede cargar pedidos, y el acceso desde internet queda bloqueado hasta que lo pongas.'}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Nuevo PIN (min. 4)"
          maxLength={20}
          className="h-10 w-44 rounded-none border border-masa-300 px-2 text-center font-mono"
        />
        <button
          type="button"
          disabled={pin.trim().length < 4}
          onClick={() => void guardar(pin.trim())}
          className="h-10 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase text-white disabled:opacity-30"
        >
          Guardar PIN
        </button>
        {estado.datos?.pinConfigurado === true && (
          <button
            type="button"
            onClick={() => {
              if (window.confirm('¿Sacar el PIN? El acceso desde internet queda bloqueado y la red queda abierta.')) void guardar('');
            }}
            className="h-10 rounded-none border border-peligro-300 bg-white px-4 text-sm font-bold uppercase text-peligro-700"
          >
            Sacar PIN
          </button>
        )}
      </div>
      {aviso !== null && <p className="mt-1.5 text-xs font-medium text-menta-700">{aviso}</p>}
    </div>
  );
}

/* -------------------------- Tunel de pedidos remotos ----------------------- */

interface EstadoTunelVista {
  activo: boolean;
  url: string | null;
  error: string | null;
}

function SeccionTunel(): JSX.Element {
  const estado = usarRecurso<{ pinConfigurado: boolean; tunel: EstadoTunelVista }>(
    () => fetch('/api/sistema/acceso-remoto').then(async (r) => ((await r.json()) as { datos: { pinConfigurado: boolean; tunel: EstadoTunelVista } }).datos),
    [],
  );
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = async (activar: boolean): Promise<void> => {
    setOcupado(true);
    setError(null);
    try {
      const r = await fetch('/api/sistema/tunel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ activar }),
      });
      const cuerpo = (await r.json()) as { datos?: EstadoTunelVista; error?: { mensaje?: string } };
      if (!r.ok) throw new Error(cuerpo.error?.mensaje ?? 'No se pudo cambiar el tunel.');
      if (cuerpo.datos?.error) setError(cuerpo.datos.error);
      estado.recargar();
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : String(causa));
    } finally {
      setOcupado(false);
    }
  };

  const tunel = estado.datos?.tunel;
  return (
    <Seccion titulo="Pedidos desde afuera (internet)">
      <div className="space-y-3 rounded-ficha border border-masa-200 bg-white p-4 text-sm text-masa-900">
        <p>
          El tunel publica SOLO la pantalla de pedidos en una direccion https, sin abrir puertos:
          el duenio carga pedidos desde el celular con 4G, en cualquier lado. Necesita el PIN
          configurado (es lo unico que protege el acceso) y se le exige a cada dispositivo.
        </p>
        {tunel?.activo === true && tunel.url !== null ? (
          <div className="rounded-ficha border border-menta-300 bg-menta-50 px-3 py-2">
            <p className="text-micro font-bold uppercase tracking-wide text-menta-800">
              Tunel ACTIVO — compartir esta direccion
            </p>
            <p className="select-all font-mono text-base font-bold text-menta-800">{tunel.url}/pedidos</p>
            <p className="mt-1 text-xs text-masa-700">
              Esta direccion es FIJA: se puede guardar en el celular de cada vendedor una sola vez.
              Anda desde cualquier red, con datos o con otro WiFi.
            </p>
          </div>
        ) : tunel?.activo === true ? (
          <p className="rounded-ficha border border-alerta-300 bg-alerta-50 px-3 py-2 text-sm">
            Levantando el tunel...
          </p>
        ) : (
          <p className="text-xs text-masa-700">Tunel apagado: los pedidos remotos solo funcionan en el WiFi de la fabrica.</p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={ocupado || tunel?.activo === true}
            onClick={() => void alternar(true)}
            className="h-10 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase text-white disabled:opacity-30"
          >
            {ocupado ? 'Trabajando...' : 'Activar tunel'}
          </button>
          <button
            type="button"
            disabled={ocupado || tunel?.activo !== true}
            onClick={() => void alternar(false)}
            className="h-10 rounded-none border border-masa-300 bg-white px-4 text-sm font-bold uppercase text-masa-800 disabled:opacity-30"
          >
            Detener
          </button>
        </div>
        {error !== null && (
          <p className="rounded-ficha border border-peligro-300 bg-peligro-50 px-3 py-2 text-sm text-peligro-700">{error}</p>
        )}
      </div>
    </Seccion>
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
  /**
   * Impresora del sistema donde salen los tickets de elaboracion. Si esta
   * cargada, el ticket se imprime SOLO (ESC/POS al spooler); si no, se abre
   * el dialogo del sistema.
   */
  impresoraTickets: string;
}

export function leerPreferenciasImpresion(): PreferenciasImpresion {
  try {
    const crudo = localStorage.getItem(CLAVE_IMPRESION);
    if (crudo !== null) {
      const dato = JSON.parse(crudo) as Partial<PreferenciasImpresion>;
      return {
        papel: dato.papel === 'ticket' ? 'ticket' : 'a4',
        pie: typeof dato.pie === 'string' ? dato.pie : '',
        impresoraTickets: typeof dato.impresoraTickets === 'string' ? dato.impresoraTickets : '',
      };
    }
  } catch {
    // Preferencias rotas: se vuelve al default.
  }
  return { papel: 'a4', pie: '', impresoraTickets: '' };
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
          <SelectorImpresora
            valor={prefs.impresoraTickets}
            alCambiar={(v) => setPrefs((p) => ({ ...p, impresoraTickets: v }))}
          />
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

/* --------------------- Impresora de tickets (elaboracion) ------------------ */

/**
 * Elige en que impresora salen los tickets de la sala de elaboracion. Con una
 * termica elegida, el ticket se imprime SOLO (ESC/POS crudo al spooler): el
 * operario toca "Ticket" y sale el papel, sin dialogos.
 */
function SelectorImpresora({
  valor,
  alCambiar,
}: {
  readonly valor: string;
  readonly alCambiar: (valor: string) => void;
}): JSX.Element {
  const [impresoras, setImpresoras] = useState<{ nombre: string; descripcion: string }[]>([]);
  const [prueba, setPrueba] = useState<string | null>(null);

  useEffect(() => {
    void window.alfajores?.impresion
      .listar()
      .then((lista) => setImpresoras(lista.map((i) => ({ nombre: i.nombre, descripcion: i.descripcion }))))
      .catch(() => setImpresoras([]));
  }, []);

  const probar = (): void => {
    setPrueba('Enviando...');
    void window.alfajores?.impresion
      .ticket(valor, [
        { texto: 'PRUEBA DE IMPRESION', grande: true, centrado: true },
        { texto: 'Alpha Gestion', centrado: true },
        { separador: true, texto: '' },
        { texto: 'Si lees esto, los tickets de elaboracion' },
        { texto: 'van a salir solos en esta impresora.' },
      ])
      .then((r) => setPrueba(r.ok ? 'Listo: mira la impresora.' : (r.error ?? 'No se pudo imprimir.')))
      .catch((causa: unknown) => setPrueba(causa instanceof Error ? causa.message : String(causa)));
  };

  return (
    <div>
      <label className="mb-1 block text-micro font-bold uppercase tracking-wide text-masa-700">
        Impresora de los tickets de elaboracion
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          className="h-10 min-w-64 rounded-none border border-masa-300 bg-white px-2 text-sm"
        >
          <option value="">Preguntar cada vez (dialogo del sistema)</option>
          {impresoras.map((i) => (
            <option key={i.nombre} value={i.nombre}>
              {i.descripcion || i.nombre}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={valor === ''}
          onClick={probar}
          className="h-10 rounded-none border border-masa-300 bg-white px-4 text-sm font-bold uppercase tracking-wide text-masa-800 disabled:opacity-30"
        >
          Imprimir prueba
        </button>
      </div>
      <p className="mt-1 text-xs text-masa-700">
        Con una impresora elegida el ticket sale SOLO al tocar "Ticket" en el pedido. Sin elegir,
        se abre el dialogo de impresion de siempre.
      </p>
      {prueba !== null && <p className="mt-1 text-xs font-medium text-masa-800">{prueba}</p>}
    </div>
  );
}
