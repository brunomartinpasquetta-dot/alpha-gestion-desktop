/**
 * Panel lateral con el ledger de un articulo.
 *
 * Es la pantalla que demuestra la decision de arquitectura mas importante del
 * sistema: el stock NO es un campo guardado, es la suma de estos movimientos. La
 * columna "saldo" muestra el acumulado hasta cada linea, asi se ve como se llega
 * al numero que figura en la grilla de stock.
 */

import { ETIQUETA_TIPO_MOVIMIENTO, type MovimientoStockVista } from '../../compartido/contratos';
import { obtenerMovimientosDeArticulo } from '../servicios/cliente';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  formatearCantidad,
  formatearCantidadConSigno,
  formatearFechaHora,
  formatearMoneda,
} from '../utiles/formato';
import { EstadoCargando, EstadoError, EstadoVacio, Pastilla, type TonoPastilla } from './comunes';
import { Tabla, type Columna } from './Tabla';

/** Los ingresos se leen en verde y los egresos en rojo, como en cualquier libro mayor. */
function tonoDeMovimiento(tipo: MovimientoStockVista['tipo']): TonoPastilla {
  switch (tipo) {
    case 'compra':
    case 'ingreso_produccion':
      return 'positivo';
    case 'venta':
    case 'consumo_produccion':
      return 'neutro';
    case 'merma':
      return 'peligro';
    case 'ajuste':
      return 'alerta';
    default:
      return 'neutro';
  }
}

const COLUMNAS: readonly Columna<MovimientoStockVista>[] = [
  { clave: 'fecha', titulo: 'Fecha', celda: (m) => formatearFechaHora(m.fecha), numerica: true },
  {
    clave: 'tipo',
    titulo: 'Tipo',
    celda: (m) => <Pastilla texto={ETIQUETA_TIPO_MOVIMIENTO[m.tipo]} tono={tonoDeMovimiento(m.tipo)} />,
  },
  {
    clave: 'cantidad',
    titulo: 'Cantidad',
    numerica: true,
    celda: (m) => (
      <span className={m.cantidad < 0 ? 'text-peligro-600' : 'text-menta-700'}>
        {formatearCantidadConSigno(m.cantidad)}
      </span>
    ),
  },
  { clave: 'saldo', titulo: 'Saldo', celda: (m) => formatearCantidad(m.saldoAcumulado), numerica: true },
  {
    clave: 'costo',
    titulo: 'Costo unit.',
    celda: (m) => (m.costoUnitario === null ? '—' : formatearMoneda(m.costoUnitario)),
    numerica: true,
  },
  {
    clave: 'documento',
    titulo: 'Documento',
    celda: (m) => (m.documentoTipo === null ? '—' : `${m.documentoTipo} #${m.documentoId ?? '?'}`),
  },
];

interface Props {
  readonly articuloId: number;
  readonly titulo: string;
  readonly subtitulo: string;
  readonly alCerrar: () => void;
}

export function PanelLedger({ articuloId, titulo, subtitulo, alCerrar }: Props): JSX.Element {
  const { datos, cargando, error, recargar } = usarRecurso(
    () => obtenerMovimientosDeArticulo(articuloId),
    [articuloId],
  );

  return (
    <aside className="flex w-[46rem] max-w-[45vw] shrink-0 flex-col border-l border-masa-200 bg-masa-50">
      <div className="flex items-start justify-between gap-3 border-b border-masa-200 px-4 py-3">
        <div>
          <h2 className="font-semibold text-masa-900">{titulo}</h2>
          <p className="text-xs text-masa-700">{subtitulo}</p>
        </div>
        <button
          type="button"
          onClick={alCerrar}
          aria-label="Cerrar el detalle"
          className="rounded-pastilla px-2 py-1 text-masa-700 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
        >
          Cerrar
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <p className="mb-3 text-xs text-masa-700">
          El stock de este articulo es la suma de estos movimientos. No existe un campo de stock
          guardado en la base.
        </p>

        {cargando && <EstadoCargando que="el ledger" />}
        {!cargando && error !== null && <EstadoError mensaje={error} alReintentar={recargar} />}
        {!cargando && error === null && datos !== null && datos.length === 0 && (
          <EstadoVacio
            titulo="Sin movimientos"
            detalle="Este articulo todavia no tiene movimientos de stock, asi que su saldo es cero."
          />
        )}
        {!cargando && error === null && datos !== null && datos.length > 0 && (
          <Tabla columnas={COLUMNAS} filas={datos} claveDeFila={(m) => m.id} />
        )}
      </div>
    </aside>
  );
}
