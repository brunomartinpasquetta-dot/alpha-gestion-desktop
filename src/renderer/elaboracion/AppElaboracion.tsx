/**
 * Monitor de elaboracion: la pantalla del empleado que elabora.
 *
 * Tres franjas, en el orden en que se trabaja:
 *   1. EN ELABORACION: las tandas en marcha, con su lote y el boton de terminar.
 *   2. PENDIENTES: lo que espera turno; si le faltan insumos lo dice y deja
 *      forzar con doble confirmacion.
 *   3. TERMINADAS: las ultimas tandas cerradas, con lote y hora, solo lectura.
 *
 * Cada tarjeta asociada a un pedido muestra el DETALLE del pedido (los renglones
 * del talonario, incluidas las cajas armadas a medida): es la orden de
 * elaboracion que el empleado lee para armar.
 *
 * La pantalla se refresca sola cada pocos segundos y despues de cada accion.
 * Si el sistema tiene PIN de red configurado, lo pide una vez y lo recuerda.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { OrdenProduccionVista, PedidoVista } from '../../compartido/contratos';

const CLAVE_PIN = 'alpha-pedidos-pin';
const INTERVALO_REFRESCO_MS = 8000;

/* --------------------------------- Red ------------------------------------ */

class ErrorApiMonitor extends Error {
  codigo: string | null;
  constructor(mensaje: string, codigo: string | null) {
    super(mensaje);
    this.codigo = codigo;
  }
}

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const pin = localStorage.getItem(CLAVE_PIN) ?? '';
  const respuesta = await fetch(ruta, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(pin === '' ? {} : { 'x-pin-pedidos': pin }),
      ...(init?.headers ?? {}),
    },
  });
  const cuerpo = (await respuesta.json().catch(() => null)) as {
    datos?: T;
    error?: { codigo?: string; mensaje?: string };
  } | null;
  if (!respuesta.ok) {
    throw new ErrorApiMonitor(
      cuerpo?.error?.mensaje ?? `El servidor respondio ${respuesta.status} en ${ruta}.`,
      cuerpo?.error?.codigo ?? null,
    );
  }
  return cuerpo?.datos as T;
}

/* ------------------------------- Formato ----------------------------------- */

/** Cantidad en la unidad en que se elabora: docenas, cajas o unidades. */
function enUnidad(unidades: number, upc: number | null, abreviatura: string): string {
  if (upc === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${resto} u`;
    const base = `${docenas} ${docenas === 1 ? 'docena' : 'docenas'}`;
    return resto === 0 ? base : `${base} + ${resto} u`;
  }
  if (upc !== null && upc > 1) {
    const cajas = Math.floor(unidades / upc);
    const resto = Math.round(unidades - cajas * upc);
    if (cajas === 0) return `${unidades} u`;
    const base = `${cajas} ${cajas === 1 ? 'caja' : 'cajas'} de ${upc} u`;
    return resto === 0 ? base : `${base} + ${resto} u`;
  }
  return `${unidades} ${abreviatura}`;
}

function hora(iso: string | null): string {
  if (iso === null) return '';
  const fecha = new Date(iso);
  const hoy = new Date();
  const horaTexto = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  if (fecha.toDateString() === hoy.toDateString()) return horaTexto;
  return `${fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${horaTexto}`;
}

/* ------------------------------ Componentes -------------------------------- */

function DetallePedido({ pedido }: { readonly pedido: PedidoVista }): JSX.Element {
  return (
    <div className="mt-2 rounded-ficha border border-masa-200 bg-white px-3 py-2">
      <p className="text-xs font-bold uppercase tracking-wide text-masa-700">
        Pedido #{pedido.id}
        {pedido.clienteNombre !== null ? ` — ${pedido.clienteNombre}` : ''}
      </p>
      {pedido.renglones.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {pedido.renglones.map((r) => (
            <li key={r.id} className="text-sm text-masa-900">
              <span className="font-mono font-bold tabular-nums">{r.cantidad} ×</span>{' '}
              {r.descripcion ?? r.presentacionNombre ?? 'renglon'}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {pedido.items.map((item) => (
            <li key={item.id} className="text-sm text-masa-900">
              <span className="font-mono font-bold tabular-nums">
                {enUnidad(item.cantidad, item.unidadesPorCaja, item.unidadAbreviatura)}
              </span>{' '}
              {item.nombre}
            </li>
          ))}
        </ul>
      )}
      {pedido.notas !== null && pedido.notas !== '' && (
        <p className="mt-1 text-xs text-masa-700">Notas: {pedido.notas}</p>
      )}
    </div>
  );
}

function TarjetaOrden({
  orden,
  pedido,
  ocupada,
  alIniciar,
  alTerminar,
}: {
  readonly orden: OrdenProduccionVista;
  readonly pedido: PedidoVista | undefined;
  readonly ocupada: boolean;
  readonly alIniciar: ((orden: OrdenProduccionVista) => void) | null;
  readonly alTerminar: ((orden: OrdenProduccionVista) => void) | null;
}): JSX.Element {
  const enMarcha = orden.estado === 'en_proceso';
  const terminada = orden.estado === 'finalizada';
  return (
    <div
      className={[
        'rounded-ficha border-2 p-4',
        enMarcha ? 'border-dulce-500 bg-dulce-50' : terminada ? 'border-masa-200 bg-white' : 'border-masa-300 bg-masa-50',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight text-masa-900">
            {orden.articuloProducidoNombre}
          </p>
          <p className="mt-0.5 font-mono text-base font-bold tabular-nums text-masa-900">
            {enUnidad(orden.cantidadPlanificada, orden.unidadesPorCaja, orden.unidadAbreviatura)}
          </p>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wide text-masa-700">
            Orden #{orden.id}
            {orden.numeroLote !== null ? ` · Lote ${orden.numeroLote}` : ''}
            {orden.clienteNombre !== null ? ` · ${orden.clienteNombre}` : ' · stock interno'}
          </p>
          {enMarcha && orden.fechaInicio !== null && (
            <p className="mt-0.5 text-xs text-masa-700">Iniciada {hora(orden.fechaInicio)}</p>
          )}
          {terminada && orden.fechaFin !== null && (
            <p className="mt-0.5 text-xs text-masa-700">Terminada {hora(orden.fechaFin)}</p>
          )}
        </div>
        {alIniciar !== null && (
          <button
            type="button"
            disabled={ocupada}
            onClick={() => alIniciar(orden)}
            className={[
              'h-14 shrink-0 rounded-none border px-5 text-base font-bold uppercase tracking-wide text-white disabled:opacity-40',
              orden.esperaInsumos
                ? 'border-alerta-500 bg-alerta-600'
                : 'border-dulce-400 bg-dulce-500',
            ].join(' ')}
          >
            {orden.estado === 'pausada' ? 'Reanudar' : orden.esperaInsumos ? 'Iniciar igual' : 'Iniciar elaboracion'}
          </button>
        )}
        {alTerminar !== null && (
          <button
            type="button"
            disabled={ocupada}
            onClick={() => alTerminar(orden)}
            className="h-14 shrink-0 rounded-none border border-menta-500 bg-menta-600 px-5 text-base font-bold uppercase tracking-wide text-white disabled:opacity-40"
          >
            Terminar elaboracion
          </button>
        )}
      </div>
      {orden.estado === 'pausada' && (
        <p className="mt-2 rounded-ficha border border-masa-300 bg-masa-100 px-3 py-1.5 text-sm font-medium text-masa-800">
          EN PAUSA{orden.numeroLote !== null ? ` · conserva el lote ${orden.numeroLote}` : ''}
        </p>
      )}
      {orden.esperaInsumos && orden.estado === 'planificada' && !terminada && (
        <p className="mt-2 rounded-ficha border border-alerta-300 bg-alerta-50 px-3 py-1.5 text-sm font-medium text-alerta-800">
          EN ESPERA DE INSUMOS{orden.insumosFaltantes !== null ? `: falta ${orden.insumosFaltantes}` : ''}
        </p>
      )}
      {pedido !== undefined && !terminada && <DetallePedido pedido={pedido} />}
    </div>
  );
}

/* --------------------------------- App ------------------------------------- */

export function AppElaboracion(): JSX.Element {
  const [ordenes, setOrdenes] = useState<OrdenProduccionVista[]>([]);
  const [pedidos, setPedidos] = useState<PedidoVista[]>([]);
  const [cargo, setCargo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [pidePin, setPidePin] = useState(false);
  const [pinEscrito, setPinEscrito] = useState('');
  const [ocupadaId, setOcupadaId] = useState<number | null>(null);
  const [actualizado, setActualizado] = useState<string>('');
  const refrescando = useRef(false);

  const refrescar = useCallback(async () => {
    if (refrescando.current) return;
    refrescando.current = true;
    try {
      const [o, p] = await Promise.all([
        pedir<OrdenProduccionVista[]>('/api/produccion/ordenes'),
        pedir<PedidoVista[]>('/api/pedidos'),
      ]);
      setOrdenes(o);
      setPedidos(p);
      setError(null);
      setPidePin(false);
      setActualizado(new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } catch (causa) {
      if (causa instanceof ErrorApiMonitor && causa.codigo === 'PIN_INVALIDO') {
        setPidePin(true);
      } else {
        setError(causa instanceof Error ? causa.message : String(causa));
      }
    } finally {
      refrescando.current = false;
      setCargo(true);
    }
  }, []);

  useEffect(() => {
    void refrescar();
    const temporizador = setInterval(() => void refrescar(), INTERVALO_REFRESCO_MS);
    return () => clearInterval(temporizador);
  }, [refrescar]);

  const cambiarEstado = useCallback(
    async (orden: OrdenProduccionVista, estado: 'en_proceso' | 'finalizada', forzar: boolean) => {
      setOcupadaId(orden.id);
      setAviso(null);
      setError(null);
      try {
        const datos = await pedir<{ advertencias?: string[] }>(
          `/api/produccion/ordenes/${orden.id}/estado`,
          { method: 'PATCH', body: JSON.stringify({ estado, ...(forzar ? { forzar: true } : {}) }) },
        );
        if (datos?.advertencias !== undefined && datos.advertencias.length > 0) {
          setAviso(datos.advertencias.join(' '));
        }
      } catch (causa) {
        const mensaje = causa instanceof Error ? causa.message : String(causa);
        // Sin insumos suficientes: se ofrece forzar, con el detalle real.
        if (!forzar && estado === 'en_proceso' && /insumo/i.test(mensaje)) {
          if (window.confirm(`${mensaje}\n\nIniciar IGUAL la elaboracion (forzar)?`)) {
            setOcupadaId(null);
            await cambiarEstado(orden, estado, true);
            return;
          }
        } else {
          setError(mensaje);
        }
      } finally {
        setOcupadaId(null);
        await refrescar();
      }
    },
    [refrescar],
  );

  const iniciar = useCallback(
    (orden: OrdenProduccionVista) => {
      const descripcion = `${orden.articuloProducidoNombre} (${enUnidad(orden.cantidadPlanificada, orden.unidadesPorCaja, orden.unidadAbreviatura)})`;
      const texto =
        orden.estado === 'pausada'
          ? `Reanudar la elaboracion de ${descripcion}?`
          : orden.esperaInsumos
            ? `Esta orden esta EN ESPERA DE INSUMOS${orden.insumosFaltantes !== null ? ` (falta ${orden.insumosFaltantes})` : ''}.\n\nIniciar IGUAL la elaboracion de ${descripcion}?`
            : `Iniciar la elaboracion de ${descripcion}?`;
      if (!window.confirm(texto)) return;
      void cambiarEstado(orden, 'en_proceso', orden.estado !== 'pausada' && orden.esperaInsumos);
    },
    [cambiarEstado],
  );

  const terminar = useCallback(
    (orden: OrdenProduccionVista) => {
      const destino = orden.pedidoId !== null ? 'queda RESERVADO para su pedido' : 'entra DISPONIBLE a stock';
      if (!window.confirm(`Terminar la elaboracion de ${orden.articuloProducidoNombre}?\n\nLo producido ${destino}.`)) return;
      void cambiarEstado(orden, 'finalizada', false);
    },
    [cambiarEstado],
  );

  const guardarPin = (): void => {
    localStorage.setItem(CLAVE_PIN, pinEscrito.trim());
    setPidePin(false);
    void refrescar();
  };

  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));
  const enMarcha = ordenes.filter((o) => o.estado === 'en_proceso');
  // Las pausadas van con las pendientes: se reanudan con el mismo boton.
  const pendientes = ordenes.filter((o) => o.estado === 'planificada' || o.estado === 'pausada');
  const terminadas = ordenes
    .filter((o) => o.estado === 'finalizada')
    .sort((a, b) => (b.fechaFin ?? '').localeCompare(a.fechaFin ?? ''))
    .slice(0, 12);

  if (pidePin) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-xl font-bold text-masa-900">Monitor de elaboracion</h1>
        <p className="text-sm text-masa-700">
          Esta conexion viene de la red y necesita el PIN de acceso del sistema.
        </p>
        <input
          type="password"
          value={pinEscrito}
          onChange={(e) => setPinEscrito(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') guardarPin();
          }}
          placeholder="PIN"
          className="h-12 rounded-none border border-masa-300 px-3 text-center font-mono text-lg"
        />
        <button
          type="button"
          onClick={guardarPin}
          className="h-12 rounded-none border border-dulce-400 bg-dulce-500 text-base font-bold uppercase tracking-wide text-white"
        >
          Entrar
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 pb-10 pt-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b-2 border-masa-300 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-masa-900">Monitor de elaboracion</h1>
          <p className="text-xs uppercase tracking-wide text-masa-700">
            {actualizado === '' ? 'Conectando...' : `Actualizado ${actualizado} · se refresca solo`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refrescar()}
          className="h-11 rounded-none border border-masa-300 bg-white px-4 text-sm font-bold uppercase tracking-wide text-masa-800"
        >
          Refrescar
        </button>
      </header>

      {error !== null && (
        <p className="mb-3 rounded-ficha border border-peligro-300 bg-peligro-50 px-3 py-2 text-sm font-medium text-peligro-800">
          {error}
        </p>
      )}
      {aviso !== null && (
        <p className="mb-3 rounded-ficha border border-alerta-300 bg-alerta-50 px-3 py-2 text-sm font-medium text-alerta-800">
          {aviso}
        </p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-dulce-700">
          En elaboracion ({enMarcha.length})
        </h2>
        {enMarcha.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            No hay tandas en marcha.
          </p>
        ) : (
          <div className="space-y-3">
            {enMarcha.map((orden) => (
              <TarjetaOrden
                key={orden.id}
                orden={orden}
                pedido={orden.pedidoId !== null ? pedidoPorId.get(orden.pedidoId) : undefined}
                ocupada={ocupadaId !== null}
                alIniciar={null}
                alTerminar={terminar}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-masa-800">
          Pendientes ({pendientes.length})
        </h2>
        {pendientes.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            {cargo ? 'No hay elaboraciones pendientes.' : 'Cargando...'}
          </p>
        ) : (
          <div className="space-y-3">
            {pendientes.map((orden) => (
              <TarjetaOrden
                key={orden.id}
                orden={orden}
                pedido={orden.pedidoId !== null ? pedidoPorId.get(orden.pedidoId) : undefined}
                ocupada={ocupadaId !== null}
                alIniciar={iniciar}
                alTerminar={null}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-menta-700">
          Terminadas (ultimas {terminadas.length})
        </h2>
        {terminadas.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            Todavia no hay tandas terminadas.
          </p>
        ) : (
          <div className="space-y-2">
            {terminadas.map((orden) => (
              <TarjetaOrden
                key={orden.id}
                orden={orden}
                pedido={undefined}
                ocupada={false}
                alIniciar={null}
                alTerminar={null}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
