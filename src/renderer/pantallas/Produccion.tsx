/**
 * Pantallas de produccion: recetas (BOM) y ordenes.
 *
 * Las recetas son encadenables: el alfajor consume el pre-elaborado dulce de
 * leche, que a su vez tiene su propia receta de materias primas. Por eso cada
 * item muestra el tipo del insumo, que es lo que deja ver la cadena.
 */

import { useState } from 'react';

import {
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_TIPO_ARTICULO,
  TRANSICIONES_ORDEN,
  type EstadoOrdenProduccion,
  type OrdenProduccionVista,
  type RecetaVista,
} from '../../compartido/contratos';
import { Pastilla, type TonoPastilla } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import { cambiarEstadoOrden, obtenerOrdenesProduccion, obtenerRecetas } from '../servicios/cliente';
import {
  formatearCantidad,
  formatearCantidadConUnidad,
  formatearFactor,
  formatearFecha,
  formatearPorcentaje,
  formatearTexto,
} from '../utiles/formato';

/* --------------------------------- Recetas --------------------------------- */

export function PantallaRecetas(): JSX.Element {
  const estado = usarRecurso(() => obtenerRecetas(), []);
  const [expandida, setExpandida] = useState<number | null>(null);

  return (
    <Vista
      estado={estado}
      que="las recetas"
      tituloVacio="Sin recetas"
      detalleVacio="No hay formulas de produccion cargadas. Corre el seed para cargar las recetas base."
      comandoVacio="npm run db:seed"
    >
      {(recetas) => (
        <div className="space-y-2">
          {recetas.map((receta: RecetaVista) => {
            const abierta = expandida === receta.id;
            return (
              <div
                key={receta.id}
                className="overflow-hidden rounded-ficha border border-masa-200 bg-white shadow-ficha"
              >
                <button
                  type="button"
                  aria-expanded={abierta}
                  onClick={() => setExpandida(abierta ? null : receta.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dulce-500"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-masa-700">
                        {receta.articuloProducidoCodigo}
                      </span>
                      <span className="font-medium text-masa-900">
                        {receta.articuloProducidoNombre}
                      </span>
                      <Pastilla
                        texto={ETIQUETA_TIPO_ARTICULO[receta.articuloProducidoTipo]}
                        tono="info"
                      />
                      {!receta.activa && <Pastilla texto="Inactiva" tono="peligro" />}
                    </div>
                    <p className="mt-0.5 text-xs text-masa-700">
                      {formatearTexto(receta.notas)}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono tabular-nums text-masa-900">
                      Rinde {formatearCantidadConUnidad(receta.rindeCantidad, receta.rindeUnidadAbreviatura)}
                    </p>
                    <p className="text-micro text-masa-700">
                      {receta.items.length} insumo(s) · {abierta ? 'ocultar' : 'ver detalle'}
                    </p>
                  </div>
                </button>

                {abierta && (
                  <div className="border-t border-masa-200 bg-masa-50 px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-micro uppercase tracking-wide text-masa-700">
                          <th scope="col" className="pb-1 text-left">Insumo</th>
                          <th scope="col" className="pb-1 text-left">Tipo</th>
                          <th scope="col" className="pb-1 text-right">Cantidad</th>
                          <th scope="col" className="pb-1 text-right">Merma esperada</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receta.items.map((item) => (
                          <tr key={item.id} className="border-t border-masa-200">
                            <td className="py-1.5 text-masa-900">
                              <span className="font-mono text-xs text-masa-700">{item.insumoCodigo}</span>{' '}
                              {item.insumoNombre}
                            </td>
                            <td className="py-1.5 text-masa-700">
                              {ETIQUETA_TIPO_ARTICULO[item.insumoTipo]}
                            </td>
                            <td className="py-1.5 text-right font-mono tabular-nums text-masa-900">
                              {formatearCantidadConUnidad(item.cantidad, item.unidadAbreviatura)}
                            </td>
                            <td className="py-1.5 text-right font-mono tabular-nums text-masa-700">
                              {formatearPorcentaje(item.mermaEsperadaPct)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Vista>
  );
}

/* --------------------------------- Ordenes --------------------------------- */

function tonoDeOrden(estado: OrdenProduccionVista['estado']): TonoPastilla {
  switch (estado) {
    case 'finalizada':
      return 'positivo';
    case 'en_proceso':
      return 'info';
    case 'planificada':
      return 'neutro';
    case 'cancelada':
      return 'peligro';
    default:
      return 'neutro';
  }
}

/** Etiquetas de accion, en el lenguaje de la fabrica. */
const ETIQUETA_ACCION_ORDEN: Readonly<Record<EstadoOrdenProduccion, string>> = {
  planificada: 'Planificar',
  en_proceso: 'Ejecutar (asigna lote)',
  finalizada: 'Finalizar tanda',
  cancelada: 'Cancelar',
};

function armarColumnasOrdenes(
  alCambiar: (orden: OrdenProduccionVista, destino: EstadoOrdenProduccion) => void,
): readonly Columna<OrdenProduccionVista>[] {
  return [
  { clave: 'id', titulo: '#', celda: (o) => o.id, numerica: true, ancho: 'w-14' },
  {
    clave: 'lote',
    titulo: 'Lote',
    celda: (o) =>
      o.numeroLote === null ? (
        <span className="text-masa-700">—</span>
      ) : (
        <span className="font-mono font-semibold text-masa-900">{o.numeroLote}</span>
      ),
  },
  {
    clave: 'articulo',
    titulo: 'Producto',
    celda: (o) => (
      <>
        <span className="font-mono text-xs text-masa-700">{o.articuloProducidoCodigo}</span>{' '}
        {o.articuloProducidoNombre}
      </>
    ),
  },
  {
    clave: 'cantidad',
    titulo: 'Planificado',
    celda: (o) => formatearCantidadConUnidad(o.cantidadPlanificada, o.unidadAbreviatura),
    numerica: true,
  },
  { clave: 'factor', titulo: 'Tanda', celda: (o) => formatearFactor(o.factorEscala), numerica: true },
  {
    clave: 'rinde',
    titulo: 'Rinde real',
    celda: (o) => (o.rindeReal === null ? '—' : formatearCantidad(o.rindeReal)),
    numerica: true,
  },
  { clave: 'insumos', titulo: 'Insumos', celda: (o) => o.cantidadInsumos, numerica: true },
  {
    clave: 'pedido',
    titulo: 'Pedido',
    celda: (o) => (o.pedidoId === null ? '—' : <Pastilla texto={`#${o.pedidoId}`} tono="info" />),
  },
  { clave: 'fecha', titulo: 'Planificada', celda: (o) => formatearFecha(o.fechaPlanificada), numerica: true },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (o) => <Pastilla texto={ETIQUETA_ESTADO_ORDEN[o.estado]} tono={tonoDeOrden(o.estado)} />,
  },
  {
    clave: 'acciones',
    titulo: 'Acciones',
    celda: (o) => {
      const destinos = TRANSICIONES_ORDEN[o.estado];
      if (destinos.length === 0) return <span className="text-masa-700">—</span>;
      return (
        <span className="flex flex-wrap gap-1.5">
          {destinos.map((destino) => (
            <button
              key={destino}
              type="button"
              onClick={() => alCambiar(o, destino)}
              className={[
                'rounded-pastilla border px-2 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2',
                destino === 'cancelada'
                  ? 'border-peligro-300 text-peligro-600 hover:bg-peligro-50 focus-visible:ring-peligro-400'
                  : 'border-dulce-400 text-dulce-700 hover:bg-dulce-50 focus-visible:ring-dulce-400',
              ].join(' ')}
            >
              {ETIQUETA_ACCION_ORDEN[destino]}
            </button>
          ))}
        </span>
      );
    },
  },
  ];
}

export function PantallaOrdenes(): JSX.Element {
  const estado = usarRecurso(() => obtenerOrdenesProduccion(), []);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  usarEventos('ordenes:cambio', estado.recargar);

  const aplicarTransicion = (orden: OrdenProduccionVista, destino: EstadoOrdenProduccion): void => {
    if (destino === 'cancelada' && !window.confirm(`¿Cancelar la orden #${orden.id}?`)) return;

    // Al finalizar se pregunta el rinde real: doce planificados a veces salen once.
    let rindeReal: number | null | undefined;
    if (destino === 'finalizada') {
      const respuesta = window.prompt(
        `Rinde real de la tanda (planificado: ${orden.cantidadPlanificada}). Vacio = lo planificado.`,
        String(orden.cantidadPlanificada),
      );
      if (respuesta === null) return; // cancelo el dialogo
      const valor = Number(respuesta.replace(',', '.'));
      rindeReal = respuesta.trim() === '' ? null : Number.isFinite(valor) ? valor : null;
    }

    setErrorAccion(null);
    cambiarEstadoOrden(orden.id, destino, rindeReal)
      .then((advertencias) => {
        estado.recargar();
        // Las advertencias no bloquean, pero no pueden pasar en silencio.
        if (advertencias.length > 0) window.alert(`Atencion:\n\n${advertencias.join('\n')}`);
      })
      .catch((causa: unknown) =>
        setErrorAccion(causa instanceof Error ? causa.message : String(causa)),
      );
  };

  const columnas = armarColumnasOrdenes(aplicarTransicion);

  return (
    <Vista
      estado={estado}
      que="las ordenes de produccion"
      tituloVacio="Sin ordenes de produccion"
      detalleVacio="Todavia no se planifico ninguna tanda. Carga los datos de demostracion para ver el modulo con ordenes en distintos estados."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <>
          {errorAccion !== null && (
            <p role="alert" className="mb-2 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
              {errorAccion}
            </p>
          )}
          <Tabla columnas={columnas} filas={filas} claveDeFila={(o) => o.id} />
        </>
      )}
    </Vista>
  );
}
