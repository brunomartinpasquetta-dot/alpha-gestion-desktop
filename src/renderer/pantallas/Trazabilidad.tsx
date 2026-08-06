/**
 * Pantalla de trazabilidad: el patron de cosecha aplicado a la fabrica.
 *
 * Se busca por numero de lote y se reconstruye la tanda completa: la orden que
 * la produjo, los insumos que consumio (teorico vs real, con su merma) y los
 * asientos del ledger que lo prueban. La linea de tiempo no es decorativa: cada
 * fila sale de `movimientos_stock`, la fuente de verdad.
 */

import { useState } from 'react';
import { Search } from 'lucide-react';

import {
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_TIPO_MOVIMIENTO,
  type TrazabilidadLote,
} from '../../compartido/contratos';
import { EstadoVacio, Pastilla, Seccion, TarjetaIndicador } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { obtenerTrazabilidad } from '../servicios/cliente';
import {
  formatearCantidad,
  formatearCantidadConSigno,
  formatearCantidadConUnidad,
  formatearFechaHora,
} from '../utiles/formato';

export function PantallaTrazabilidad(): JSX.Element {
  const [consulta, setConsulta] = useState('');
  const [resultado, setResultado] = useState<TrazabilidadLote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = (): void => {
    const lote = consulta.trim().toUpperCase();
    if (lote === '' || buscando) return;
    setBuscando(true);
    setError(null);
    obtenerTrazabilidad(lote)
      .then((datos) => {
        setResultado(datos);
        setError(null);
      })
      .catch((causa: unknown) => {
        setResultado(null);
        setError(causa instanceof Error ? causa.message : String(causa));
      })
      .finally(() => setBuscando(false));
  };

  return (
    <div className="space-y-5">
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          buscar();
        }}
        className="flex items-center gap-2"
      >
        <div className="relative min-w-0 flex-1 max-w-md">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-masa-700"
            aria-hidden="true"
          />
          <input
            value={consulta}
            onChange={(evento) => setConsulta(evento.target.value)}
            placeholder="Numero de lote, ej. L-20260805-01"
            className="h-11 w-full rounded-ficha border border-masa-300 bg-white pl-9 pr-3 font-mono text-sm uppercase text-masa-900 outline-none placeholder:normal-case placeholder:font-sans focus-visible:ring-2 focus-visible:ring-dulce-400"
          />
        </div>
        <button
          type="submit"
          disabled={consulta.trim() === '' || buscando}
          className="h-11 shrink-0 rounded-ficha bg-dulce-600 px-5 font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300 disabled:text-masa-700"
        >
          {buscando ? 'Buscando...' : 'Buscar'}
        </button>
      </form>

      {error !== null && (
        <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-4 py-3 text-sm text-peligro-600">
          {error}
        </p>
      )}

      {resultado === null && error === null && (
        <EstadoVacio
          titulo="Busca un lote para ver su historia"
          detalle="El numero de lote figura en la orden de produccion (se asigna al ejecutarla) y tiene el formato L-AAAAMMDD-NN."
        />
      )}

      {resultado !== null && <Resultado datos={resultado} />}
    </div>
  );
}

function Resultado({ datos }: { readonly datos: TrazabilidadLote }): JSX.Element {
  const { orden, consumos, movimientos } = datos;

  const totalMerma = consumos.reduce((suma, c) => suma + (c.merma ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Resumen del lote, como el encabezado de cosecha */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
        <div>
          <p className="font-mono text-2xl font-bold text-masa-900">{datos.numeroLote}</p>
          <p className="mt-0.5 text-sm text-masa-800">
            {orden.articuloProducidoNombre}
            <span className="font-mono text-xs text-masa-700"> · {orden.articuloProducidoCodigo}</span>
          </p>
          <p className="mt-1 text-xs text-masa-700">
            Orden #{orden.id} · planificada {formatearCantidadConUnidad(orden.cantidadPlanificada, orden.unidadAbreviatura)} · tanda ×{orden.factorEscala}
            {orden.pedidoId !== null && ` · contra pedido #${orden.pedidoId}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Pastilla
            texto={ETIQUETA_ESTADO_ORDEN[orden.estado]}
            tono={orden.estado === 'finalizada' ? 'positivo' : orden.estado === 'cancelada' ? 'peligro' : 'info'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TarjetaIndicador
          rotulo="Rinde real"
          valor={orden.rindeReal === null ? '—' : formatearCantidad(orden.rindeReal)}
          detalle={`Planificado: ${formatearCantidad(orden.cantidadPlanificada)}`}
        />
        <TarjetaIndicador rotulo="Insumos consumidos" valor={String(consumos.length)} />
        <TarjetaIndicador
          rotulo="Merma total"
          valor={totalMerma === 0 ? '0' : formatearCantidadConSigno(totalMerma)}
          detalle="Real − teorico, en unidades base"
          tono={totalMerma > 0 ? 'alerta' : 'neutro'}
        />
        <TarjetaIndicador
          rotulo="Stock actual del producido"
          valor={formatearCantidad(datos.stockActualProducido)}
          detalle="Hoy, sumando todo el ledger"
          tono="info"
        />
      </div>

      <Seccion titulo="Consumos de la tanda">
        <Tabla
          columnas={COLUMNAS_CONSUMOS}
          filas={consumos}
          claveDeFila={(c) => c.articuloId}
          filaEnAlerta={(c) => (c.merma ?? 0) > 0}
        />
      </Seccion>

      <Seccion titulo="Asientos en el ledger">
        {movimientos.length === 0 ? (
          <EstadoVacio
            titulo="Sin movimientos todavia"
            detalle="La tanda esta ejecutada pero no finalizada: los asientos de consumo e ingreso se generan al finalizarla."
          />
        ) : (
          <Tabla columnas={COLUMNAS_MOVIMIENTOS} filas={movimientos} claveDeFila={(m) => m.id} />
        )}
      </Seccion>
    </div>
  );
}

const COLUMNAS_CONSUMOS: readonly Columna<TrazabilidadLote['consumos'][number]>[] = [
  { clave: 'codigo', titulo: 'Codigo', celda: (c) => <span className="font-mono">{c.codigo}</span> },
  { clave: 'nombre', titulo: 'Insumo', celda: (c) => c.nombre },
  {
    clave: 'teorico',
    titulo: 'Teorico',
    celda: (c) => formatearCantidadConUnidad(c.cantidadTeorica, c.unidadAbreviatura),
    numerica: true,
  },
  {
    clave: 'real',
    titulo: 'Real',
    celda: (c) =>
      c.cantidadReal === null ? '—' : formatearCantidadConUnidad(c.cantidadReal, c.unidadAbreviatura),
    numerica: true,
  },
  {
    clave: 'merma',
    titulo: 'Merma',
    numerica: true,
    celda: (c) =>
      c.merma === null ? (
        '—'
      ) : (
        <span className={c.merma > 0 ? 'text-alerta-700' : 'text-menta-700'}>
          {formatearCantidadConSigno(c.merma)}
        </span>
      ),
  },
];

const COLUMNAS_MOVIMIENTOS: readonly Columna<TrazabilidadLote['movimientos'][number]>[] = [
  { clave: 'fecha', titulo: 'Fecha', celda: (m) => formatearFechaHora(m.fecha), numerica: true },
  {
    clave: 'tipo',
    titulo: 'Tipo',
    celda: (m) => (
      <Pastilla
        texto={ETIQUETA_TIPO_MOVIMIENTO[m.tipo]}
        tono={m.cantidad > 0 ? 'positivo' : 'neutro'}
      />
    ),
  },
  { clave: 'articulo', titulo: 'Articulo', celda: (m) => m.articuloNombre },
  {
    clave: 'cantidad',
    titulo: 'Cantidad',
    numerica: true,
    celda: (m) => (
      <span className={m.cantidad < 0 ? 'text-peligro-600' : 'text-menta-700'}>
        {formatearCantidadConSigno(m.cantidad)} {m.unidadAbreviatura}
      </span>
    ),
  },
];
