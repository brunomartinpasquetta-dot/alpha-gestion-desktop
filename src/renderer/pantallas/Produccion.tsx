/**
 * Pantallas de produccion: recetas (BOM) y ordenes.
 *
 * Las recetas son encadenables: el alfajor consume el pre-elaborado dulce de
 * leche, que a su vez tiene su propia receta de materias primas. Por eso cada
 * item muestra el tipo del insumo, que es lo que deja ver la cadena.
 */

import { useState } from 'react';
import { Check, Pause, Play, Plus, Undo2, X, type LucideIcon } from 'lucide-react';

import {
  ETIQUETA_ESTADO_ORDEN,
  ETIQUETA_TIPO_ARTICULO,
  TRANSICIONES_ORDEN,
  type EstadoOrdenProduccion,
  type OrdenProduccionVista,
  type PedidoVista,
  type RecetaVista,
} from '../../compartido/contratos';
import { Pastilla, type TonoPastilla } from '../componentes/comunes';
import {
  BarraFiltros,
  entraEnRango,
  RANGO_VACIO,
  SelectorFiltro,
  type RangoFechas,
} from '../componentes/filtros';
import { definicionDeModulo } from '../ventanas';
import { Aviso, BotonFila, BotonPrimario } from '../componentes/Formulario';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  cambiarActivaReceta,
  cambiarEstadoOrden,
  cambiarEstadoPedido,
  obtenerOrdenesProduccion,
  obtenerPedidos,
  obtenerRecetas,
} from '../servicios/cliente';
import { FormularioNuevaOrden } from './FormulariosOperacion';
import { FormularioReceta } from './FormulariosProduccion';
import {
  formatearCantidad,
  formatearCantidadConUnidad,
  formatearFecha,
  formatearPorcentaje,
  formatearTexto,
} from '../utiles/formato';

/* --------------------------------- Recetas --------------------------------- */

export function PantallaRecetas(): JSX.Element {
  const estado = usarRecurso(() => obtenerRecetas(), []);
  const [expandida, setExpandida] = useState<number | null>(null);
  const [enEdicion, setEnEdicion] = useState<RecetaVista | null | undefined>(undefined);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const cambiarActiva = (receta: RecetaVista): void => {
    const alta = !receta.activa;
    setAviso(null);
    cambiarActivaReceta(receta.id, alta)
      .then(() => {
        estado.recargar();
        setAviso({
          tono: 'ok',
          texto: `Receta de ${receta.articuloProducidoNombre} ${alta ? 'activada' : 'desactivada'}.`,
        });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Editar una receta no cambia las tandas ya producidas: cada orden guarda su propia copia.
        </p>
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva receta
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
      estado={estado}
      que="las recetas"
      tituloVacio="Sin recetas"
      detalleVacio="Carga la primera formula con el boton Nueva receta."
      comandoVacio={COMANDO_SEED_DEMO}
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

                <div className="flex gap-1 border-t border-masa-100 px-4 py-2">
                  <BotonFila onClick={() => setEnEdicion(receta)}>Editar receta</BotonFila>
                  <BotonFila
                    onClick={() => cambiarActiva(receta)}
                    tono={receta.activa ? 'peligro' : 'neutro'}
                  >
                    {receta.activa ? 'Desactivar' : 'Activar'}
                  </BotonFila>
                </div>

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

      {enEdicion !== undefined && (
        <FormularioReceta
          receta={enEdicion}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje) => {
            setEnEdicion(undefined);
            estado.recargar();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}
    </div>
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
    case 'pausada':
      return 'neutro';
    default:
      return 'neutro';
  }
}

/** Etiquetas de accion, en el lenguaje de la fabrica. */
const ETIQUETA_ACCION_ORDEN: Readonly<Record<EstadoOrdenProduccion, string>> = {
  planificada: 'Volver a planificada',
  en_proceso: 'Elaborar (chequea insumos y asigna el lote)',
  pausada: 'Pausar la tanda (conserva lote e insumos)',
  finalizada: 'Finalizar la tanda (descuenta insumos e ingresa el producto)',
  cancelada: 'Cancelar la orden',
};

/**
 * Los botones de elaboracion son cuadrados, con icono, y van uno al lado del
 * otro en una sola fila: la accion se reconoce de un vistazo desde lejos, que es
 * como se mira una pantalla en la mesa de trabajo, con las manos ocupadas.
 */
const ICONO_ACCION_ORDEN: Readonly<Record<EstadoOrdenProduccion, LucideIcon>> = {
  planificada: Undo2,
  en_proceso: Play,
  pausada: Pause,
  finalizada: Check,
  cancelada: X,
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
  {
    clave: 'docenas',
    titulo: 'Docenas',
    // El factor de escala era una cuenta interna del sistema. Lo que el que
    // produce mira es cuantas docenas salen de esa orden.
    celda: (o) =>
      o.unidadesPorCaja === 12 ? formatearCantidad(o.cantidadPlanificada / 12) : '—',
    numerica: true,
  },
  {
    clave: 'rinde',
    titulo: 'Rinde real',
    celda: (o) => (o.rindeReal === null ? '—' : formatearCantidad(o.rindeReal)),
    numerica: true,
  },
  { clave: 'insumos', titulo: 'Insumos', celda: (o) => o.cantidadInsumos, numerica: true },
  {
    clave: 'pedido',
    titulo: 'Para quien',
    // Una orden con pedido produce mercaderia que ya tiene dueño: al finalizar
    // entra al deposito reservada para ese cliente. Una orden interna entra
    // disponible para cualquiera. Verlo en la grilla evita la confusion de
    // creer que hay stock libre cuando en realidad esta prometido.
    celda: (o) =>
      o.pedidoId === null ? (
        <span className="text-masa-700">Stock propio</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1">
          <Pastilla texto={`Pedido #${o.pedidoId}`} tono="info" />
          {o.clienteNombre !== null && (
            <span className="truncate text-masa-900">{o.clienteNombre}</span>
          )}
        </span>
      ),
  },
  { clave: 'fecha', titulo: 'Planificada', celda: (o) => formatearFecha(o.fechaPlanificada), numerica: true },
  {
    clave: 'estado',
    titulo: 'Estado',
    // "Espera insumos" no es un estado guardado: se calcula contra el stock de
    // hoy. Por eso, apenas se carga la compra que faltaba, la misma orden pasa
    // a verse lista sin que nadie la toque.
    celda: (o) =>
      o.estado === 'planificada' && o.esperaInsumos ? (
        <span title={o.insumosFaltantes ?? undefined}>
          <Pastilla texto="Espera insumos" tono="alerta" />
        </span>
      ) : (
        <Pastilla texto={ETIQUETA_ESTADO_ORDEN[o.estado]} tono={tonoDeOrden(o.estado)} />
      ),
  },
  {
    clave: 'acciones',
    titulo: 'Acciones',
    celda: (o) => {
      const destinos = TRANSICIONES_ORDEN[o.estado];
      if (destinos.length === 0) return <span className="text-masa-700">—</span>;
      return (
        <span className="flex flex-nowrap items-center gap-1.5">
          {destinos.map((destino) => {
            const Icono = ICONO_ACCION_ORDEN[destino];
            const etiqueta = ETIQUETA_ACCION_ORDEN[destino];
            return (
              <button
                key={destino}
                type="button"
                onClick={() => alCambiar(o, destino)}
                title={etiqueta}
                aria-label={etiqueta}
                className={[
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-ficha border outline-none transition-colors focus-visible:ring-2',
                  destino === 'cancelada'
                    ? 'border-peligro-300 text-peligro-600 hover:bg-peligro-50 focus-visible:ring-peligro-400'
                    : destino === 'finalizada'
                      ? 'border-menta-400 bg-menta-50 text-menta-700 hover:bg-menta-100 focus-visible:ring-menta-400'
                      : 'border-dulce-400 bg-dulce-50 text-dulce-700 hover:bg-dulce-100 focus-visible:ring-dulce-400',
                ].join(' ')}
              >
                <Icono className="h-4 w-4" aria-hidden="true" />
              </button>
            );
          })}
        </span>
      );
    },
  },
  ];
}

function PestanaElaboracion(): JSX.Element {
  const estado = usarRecurso(() => obtenerOrdenesProduccion(), []);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [modalOrden, setModalOrden] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

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
      .catch((causa: unknown) => {
        const mensaje = causa instanceof Error ? causa.message : String(causa);
        // Insumos en falta segun el papel: el operario que tiene la materia
        // prima en la mesa puede elaborar igual, avisado y bajo su decision.
        if (destino === 'en_proceso' && mensaje.includes('No alcanzan los insumos')) {
          if (window.confirm(`${mensaje}\n\n¿Elaborar igual? El stock del insumo va a quedar negativo al finalizar.`)) {
            cambiarEstadoOrden(orden.id, destino, rindeReal, true)
              .then((advertencias) => {
                estado.recargar();
                if (advertencias.length > 0) window.alert(`Atencion:\n\n${advertencias.join('\n')}`);
              })
              .catch((c2: unknown) => setErrorAccion(c2 instanceof Error ? c2.message : String(c2)));
          }
          return;
        }
        setErrorAccion(mensaje);
      });
  };

  const columnas = armarColumnasOrdenes(aplicarTransicion);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Al ejecutar una orden se le asigna el numero de lote; al finalizarla se descuentan los
          insumos y entra el producto.
        </p>
        <BotonPrimario onClick={() => setModalOrden(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva orden
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono="ok" texto={aviso} />}

      <Vista
        estado={estado}
        que="las ordenes de produccion"
        tituloVacio="Sin ordenes de produccion"
        detalleVacio="Crea la primera con el boton Nueva orden."
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

      {modalOrden && (
        <FormularioNuevaOrden
          alCerrar={() => setModalOrden(false)}
          alGuardar={(mensaje) => {
            setModalOrden(false);
            estado.recargar();
            setAviso(mensaje);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------- Ordenes de pedido ------------------------------- */

/** Abre la ventana del ticket 80 mm del pedido (se imprime sola al cargar). */
function imprimirTicket(pedidoId: number): void {
  const definicion = definicionDeModulo('ticket-pedido');
  window.alfajores?.ventanas.abrir(definicion.clave, `Ticket pedido #${pedidoId}`, definicion.icono, {
    pedidoId: String(pedidoId),
  });
}

/** Cantidad en la unidad de trabajo: docenas si upc=12, cajas si upc>1, u. */
function enUnidades(unidades: number, upc: number | null, abreviatura: string): string {
  if (upc === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${resto} u`;
    const base = `${docenas} ${docenas === 1 ? 'docena' : 'docenas'}`;
    return resto === 0 ? base : `${base} + ${resto} u`;
  }
  if (upc !== null && upc > 1) return `${formatearCantidad(unidades)} u (cajas de ${upc})`;
  return `${formatearCantidad(unidades)} ${abreviatura}`;
}

type EstadoElaboracionPedido = 'pendiente' | 'en_elaboracion' | 'pausado' | 'finalizado';

const ETIQUETA_ELABORACION: Record<EstadoElaboracionPedido, { texto: string; tono: TonoPastilla }> = {
  pendiente: { texto: 'Pendiente elaboracion', tono: 'alerta' },
  en_elaboracion: { texto: 'En elaboracion', tono: 'info' },
  pausado: { texto: 'Pausado', tono: 'neutro' },
  finalizado: { texto: 'Finalizado', tono: 'positivo' },
};

function estadoElaboracionDe(ordenes: OrdenProduccionVista[]): EstadoElaboracionPedido {
  if (ordenes.some((o) => o.estado === 'en_proceso')) return 'en_elaboracion';
  if (ordenes.some((o) => o.estado === 'pausada')) return 'pausado';
  if (ordenes.some((o) => o.estado === 'planificada')) return 'pendiente';
  return 'finalizado';
}

/**
 * Pestania ORDENES DE PEDIDO: los pedidos vistos desde la fabrica. Cada fila
 * es UN pedido con su cliente y el estado de su elaboracion; las acciones
 * operan sobre TODAS sus tandas juntas. El click en la fila muestra el detalle
 * en formato de elaboracion (que hay que armar), no como se cargo.
 */
function PestanaOrdenesDePedido(): JSX.Element {
  const pedidos = usarRecurso(() => obtenerPedidos(), []);
  const ordenes = usarRecurso(() => obtenerOrdenesProduccion(), []);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [finalizando, setFinalizando] = useState<PedidoVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rango, setRango] = useState<RangoFechas>(RANGO_VACIO);
  const [clienteFiltro, setClienteFiltro] = useState<number | ''>('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoElaboracionPedido | ''>('');
  const [busqueda, setBusqueda] = useState('');

  const recargar = (): void => {
    pedidos.recargar();
    ordenes.recargar();
  };
  usarEventos('ordenes:cambio', recargar);
  usarEventos('pedidos:cambio', recargar);

  if (pedidos.cargando || ordenes.cargando) {
    return <p className="px-3 py-4 text-sm text-masa-700">Cargando pedidos y ordenes...</p>;
  }
  if (pedidos.error !== null || ordenes.error !== null) {
    return (
      <p className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
        {pedidos.error ?? ordenes.error}
      </p>
    );
  }

  const todasLasOrdenes = ordenes.datos ?? [];
  const ordenesDe = (pedidoId: number): OrdenProduccionVista[] =>
    todasLasOrdenes.filter((o) => o.pedidoId === pedidoId && o.estado !== 'cancelada');

  const abiertos = (pedidos.datos ?? []).filter(
    (p) => p.estado !== 'cancelado' && p.estado !== 'entregado',
  );
  // Mas viejo primero: lo que espera hace mas tiempo se elabora antes.
  const filas = abiertos
    .filter((p) => entraEnRango(p.fechaPedido, rango))
    .filter((p) => clienteFiltro === '' || p.clienteId === clienteFiltro)
    .filter((p) => estadoFiltro === '' || estadoElaboracionDe(ordenesDe(p.id)) === estadoFiltro)
    .filter((p) => {
      const q = busqueda.trim().toLowerCase();
      if (q === '') return true;
      return (
        String(p.id).includes(q) ||
        (p.clienteNombre ?? '').toLowerCase().includes(q) ||
        (p.vendedorNombre ?? '').toLowerCase().includes(q) ||
        p.renglones.some((r) => (r.descripcion ?? r.presentacionNombre ?? '').toLowerCase().includes(q))
      );
    })
    .sort((a, b) => a.fechaPedido.localeCompare(b.fechaPedido));

  const clientesDeLaLista = [...new Map(
    abiertos.filter((p) => p.clienteId !== null).map((p) => [p.clienteId!, p.clienteNombre ?? 'Cliente']),
  )].map(([valor, etiqueta]) => ({ valor, etiqueta })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));

  const hayFiltros =
    rango.desde !== '' || rango.hasta !== '' || clienteFiltro !== '' || estadoFiltro !== '' || busqueda !== '';
  const limpiar = (): void => {
    setRango(RANGO_VACIO);
    setClienteFiltro('');
    setEstadoFiltro('');
    setBusqueda('');
  };

  const correrEnCadena = async (
    objetivos: OrdenProduccionVista[],
    destino: EstadoOrdenProduccion,
    forzables: boolean,
  ): Promise<void> => {
    setOcupado(true);
    setError(null);
    const avisos: string[] = [];
    try {
      for (const orden of objetivos) {
        try {
          const adv = await cambiarEstadoOrden(orden.id, destino);
          avisos.push(...adv);
        } catch (causa) {
          const mensaje = causa instanceof Error ? causa.message : String(causa);
          if (forzables && mensaje.includes('No alcanzan los insumos')) {
            if (window.confirm(`${mensaje}\n\n¿Elaborar igual? El stock del insumo va a quedar negativo al finalizar.`)) {
              const adv = await cambiarEstadoOrden(orden.id, destino, undefined, true);
              avisos.push(...adv);
              continue;
            }
            continue;
          }
          throw causa;
        }
      }
      if (avisos.length > 0) window.alert(`Atencion:\n\n${avisos.join('\n')}`);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : String(causa));
    } finally {
      setOcupado(false);
      recargar();
    }
  };

  const elaborar = (pedido: PedidoVista): void => {
    const objetivos = ordenesDe(pedido.id).filter(
      (o) => o.estado === 'planificada' || o.estado === 'pausada',
    );
    if (objetivos.length === 0) return;
    if (!window.confirm(`¿Iniciar la elaboracion del pedido #${pedido.id}? (${objetivos.length} ${objetivos.length === 1 ? 'tanda' : 'tandas'})`)) return;
    void correrEnCadena(objetivos, 'en_proceso', true);
  };

  const pausar = (pedido: PedidoVista): void => {
    const objetivos = ordenesDe(pedido.id).filter((o) => o.estado === 'en_proceso');
    if (objetivos.length === 0) return;
    if (!window.confirm(`¿Pausar la elaboracion del pedido #${pedido.id}? Las tandas conservan su lote y sus insumos.`)) return;
    void correrEnCadena(objetivos, 'pausada', false);
  };

  const cancelar = (pedido: PedidoVista): void => {
    if (!window.confirm(`¿Cancelar el pedido #${pedido.id}${pedido.clienteNombre !== null ? ` de ${pedido.clienteNombre}` : ''}?\n\nSe cancelan sus tandas sin arrancar y el stock apartado vuelve a estar disponible.`)) return;
    setOcupado(true);
    setError(null);
    cambiarEstadoPedido(pedido.id, 'cancelado')
      .then(() => recargar())
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)))
      .finally(() => setOcupado(false));
  };

  return (
    <div className="space-y-3">
      {error !== null && (
        <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
          {error}
        </p>
      )}
      <BarraFiltros
        rango={rango}
        alCambiarRango={setRango}
        texto={busqueda}
        alCambiarTexto={setBusqueda}
        placeholderTexto="Buscar por numero, cliente, vendedor o producto..."
        selectores={
          <>
            <SelectorFiltro
              valor={clienteFiltro}
              alCambiar={(v) => setClienteFiltro(v === '' ? '' : Number(v))}
              vacio="Todos los clientes"
              opciones={clientesDeLaLista}
            />
            <SelectorFiltro
              valor={estadoFiltro}
              alCambiar={(v) => setEstadoFiltro(v as EstadoElaboracionPedido | '')}
              vacio="Todos los estados"
              opciones={(Object.keys(ETIQUETA_ELABORACION) as EstadoElaboracionPedido[]).map((e) => ({
                valor: e,
                etiqueta: ETIQUETA_ELABORACION[e].texto,
              }))}
            />
          </>
        }
        resumen={`${filas.length} de ${abiertos.length} pedidos`}
        alLimpiar={limpiar}
        hayFiltros={hayFiltros}
      />
      {filas.length === 0 ? (
        <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
          {hayFiltros ? 'Ningun pedido coincide con el filtro.' : 'No hay pedidos abiertos.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                <th className="px-3 py-2 font-semibold">Pedido</th>
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2 text-right font-semibold">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((pedido) => {
                const suyas = ordenesDe(pedido.id);
                const estadoElab = estadoElaboracionDe(suyas);
                const chip = ETIQUETA_ELABORACION[estadoElab];
                const puedeElaborar = suyas.some((o) => o.estado === 'planificada' || o.estado === 'pausada');
                const puedePausar = suyas.some((o) => o.estado === 'en_proceso');
                const puedeFinalizar = suyas.some((o) => o.estado === 'en_proceso' || o.estado === 'pausada');
                const expandido = abierto === pedido.id;
                return (
                  <FilaPedidoElaboracion
                    key={pedido.id}
                    pedido={pedido}
                    ordenes={suyas}
                    chip={chip}
                    expandido={expandido}
                    ocupado={ocupado}
                    puedeElaborar={puedeElaborar}
                    puedePausar={puedePausar}
                    puedeFinalizar={puedeFinalizar}
                    alExpandir={() => setAbierto(expandido ? null : pedido.id)}
                    alElaborar={() => elaborar(pedido)}
                    alPausar={() => pausar(pedido)}
                    alFinalizar={() => setFinalizando(pedido)}
                    alCancelar={() => cancelar(pedido)}
                    alImprimir={() => imprimirTicket(pedido.id)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {finalizando !== null && (
        <ModalFinalizarYEnviar
          pedido={finalizando}
          ordenes={ordenesDe(finalizando.id).filter(
            (o) => o.estado === 'en_proceso' || o.estado === 'pausada',
          )}
          alCerrar={() => setFinalizando(null)}
          alTerminar={(avisos) => {
            setFinalizando(null);
            recargar();
            if (avisos.length > 0) window.alert(`Atencion:\n\n${avisos.join('\n')}`);
          }}
        />
      )}
    </div>
  );
}

function FilaPedidoElaboracion({
  pedido,
  ordenes,
  chip,
  expandido,
  ocupado,
  puedeElaborar,
  puedePausar,
  puedeFinalizar,
  alExpandir,
  alElaborar,
  alPausar,
  alFinalizar,
  alCancelar,
  alImprimir,
}: {
  readonly pedido: PedidoVista;
  readonly ordenes: OrdenProduccionVista[];
  readonly chip: { texto: string; tono: TonoPastilla };
  readonly expandido: boolean;
  readonly ocupado: boolean;
  readonly puedeElaborar: boolean;
  readonly puedePausar: boolean;
  readonly puedeFinalizar: boolean;
  readonly alExpandir: () => void;
  readonly alElaborar: () => void;
  readonly alPausar: () => void;
  readonly alFinalizar: () => void;
  readonly alCancelar: () => void;
  readonly alImprimir: () => void;
}): JSX.Element {
  const claseBoton =
    'h-8 rounded-none border px-2.5 text-xs font-bold uppercase tracking-wide disabled:opacity-30';
  return (
    <>
      <tr
        onClick={alExpandir}
        className={['cursor-pointer border-b border-masa-100', expandido ? 'bg-dulce-50' : 'hover:bg-masa-50'].join(' ')}
      >
        <td className="px-3 py-2 font-mono font-bold text-masa-900">#{pedido.id}</td>
        <td className="px-3 py-2 whitespace-nowrap text-masa-800">
          {new Date(pedido.fechaPedido).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
          <span className="block text-xs text-masa-700">
            {new Date(pedido.fechaPedido).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </td>
        <td className="px-3 py-2 text-masa-900">{pedido.clienteNombre ?? 'Mostrador'}</td>
        <td className="px-3 py-2"><Pastilla texto={chip.texto} tono={chip.tono} /></td>
        <td className="px-3 py-2">
          <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={alImprimir} title="Imprimir la orden de trabajo en 80 mm"
              className={`${claseBoton} border-masa-400 bg-white text-masa-900`}>
              Ticket
            </button>
            <button type="button" disabled={ocupado || !puedeElaborar} onClick={alElaborar}
              className={`${claseBoton} border-dulce-400 bg-dulce-500 text-white`}>
              Elaborar
            </button>
            <button type="button" disabled={ocupado || !puedePausar} onClick={alPausar}
              className={`${claseBoton} border-masa-300 bg-white text-masa-800`}>
              Pausar
            </button>
            <button type="button" disabled={ocupado || !puedeFinalizar} onClick={alFinalizar}
              className={`${claseBoton} border-menta-500 bg-menta-600 text-white`}>
              Finalizar y enviar a stock
            </button>
            <button type="button" disabled={ocupado} onClick={alCancelar}
              className={`${claseBoton} border-peligro-300 bg-white text-peligro-700`}>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
      {expandido && (
        <tr className="border-b border-masa-100 bg-masa-50">
          <td colSpan={5} className="px-4 py-3">
            <DetalleElaboracionPedido pedido={pedido} ordenes={ordenes} />
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * El detalle del pedido en FORMATO DE ELABORACION: que hay que armar (los
 * renglones con su composicion) y las tandas asociadas con su lote. Es lo que
 * lee el que fabrica, no el formulario con el que se cargo.
 */
function DetalleElaboracionPedido({
  pedido,
  ordenes,
}: {
  readonly pedido: PedidoVista;
  readonly ordenes: OrdenProduccionVista[];
}): JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-1 text-micro font-bold uppercase tracking-wide text-masa-700">
          Que hay que armar
        </p>
        {pedido.renglones.length > 0 ? (
          <ul className="space-y-1">
            {pedido.renglones.map((r) => (
              <li key={r.id} className="rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm text-masa-900">
                <span className="font-mono font-bold tabular-nums">{formatearCantidad(r.cantidad)} ×</span>{' '}
                {r.descripcion ?? r.presentacionNombre ?? 'renglon'}
                {r.componentes.length > 0 && (
                  <span className="block pl-5 text-xs text-masa-700">
                    {r.componentes.map((c) => `${formatearCantidad(c.unidades)} ${c.articuloNombre}`).join(' + ')} por caja
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <ul className="space-y-1">
            {pedido.items.map((item) => (
              <li key={item.id} className="rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm text-masa-900">
                <span className="font-mono font-bold tabular-nums">{enUnidades(item.cantidad, item.unidadesPorCaja, item.unidadAbreviatura)}</span>{' '}
                {item.nombre}
              </li>
            ))}
          </ul>
        )}
        {pedido.notas !== null && pedido.notas !== '' && (
          <p className="mt-1.5 text-xs text-masa-700">Notas: {pedido.notas}</p>
        )}
      </div>
      <div>
        <p className="mb-1 text-micro font-bold uppercase tracking-wide text-masa-700">
          Tandas de elaboracion
        </p>
        {ordenes.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-2.5 py-2 text-sm text-masa-700">
            Sin tandas: todo el pedido salio de stock apartado.
          </p>
        ) : (
          <ul className="space-y-1">
            {ordenes.map((o) => (
              <li key={o.id} className="flex items-center gap-2 rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm">
                <span className="min-w-0 flex-1 text-masa-900">
                  {o.articuloProducidoNombre} — {enUnidades(o.cantidadPlanificada, o.unidadesPorCaja, o.unidadAbreviatura)}
                  {o.numeroLote !== null ? ` · Lote ${o.numeroLote}` : ''}
                </span>
                <Pastilla texto={ETIQUETA_ESTADO_ORDEN[o.estado]} tono={o.estado === 'finalizada' ? 'positivo' : o.estado === 'en_proceso' ? 'info' : 'neutro'} />
                {o.esperaInsumos && o.estado === 'planificada' && (
                  <Pastilla texto="Espera insumos" tono="alerta" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * FINALIZAR Y ENVIAR A STOCK: antes de impactar el deposito se ajusta la
 * cantidad REAL que salio de cada tanda (doce planificados a veces son once).
 */
function ModalFinalizarYEnviar({
  pedido,
  ordenes,
  alCerrar,
  alTerminar,
}: {
  readonly pedido: PedidoVista;
  readonly ordenes: OrdenProduccionVista[];
  readonly alCerrar: () => void;
  readonly alTerminar: (avisos: string[]) => void;
}): JSX.Element {
  const [reales, setReales] = useState<Record<number, number | ''>>(() =>
    Object.fromEntries(ordenes.map((o) => [o.id, o.cantidadPlanificada])),
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const valido = ordenes.every((o) => {
    const v = reales[o.id];
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
  });

  const confirmar = async (): Promise<void> => {
    if (!valido) return;
    setGuardando(true);
    setError(null);
    const avisos: string[] = [];
    try {
      for (const orden of ordenes) {
        const real = reales[orden.id] as number;
        const adv = await cambiarEstadoOrden(orden.id, 'finalizada', real);
        avisos.push(...adv);
      }
      alTerminar(avisos);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : String(causa));
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      {/*
        max-h + columna: con varias tandas la lista crecia sin tope y en una
        pantalla de 768px los botones quedaban DEBAJO del borde, asi que el
        pedido no se podia finalizar. Ahora scrollea la lista y los botones
        quedan siempre a la vista.
      */}
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-ficha border border-masa-200 bg-white shadow-xl">
        <div className="shrink-0 p-4 pb-2">
        <h2 className="text-lg font-bold text-masa-900">Finalizar y enviar a stock</h2>
        <p className="mt-0.5 text-sm text-masa-700">
          Pedido #{pedido.id}{pedido.clienteNombre !== null ? ` — ${pedido.clienteNombre}` : ''}. Ajusta la
          cantidad REAL que salio de cada tanda antes de que entre al deposito.
        </p>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4">
          {ordenes.map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-ficha border border-masa-200 px-3 py-2">
              <span className="min-w-0 flex-1 text-sm text-masa-900">
                {o.articuloProducidoNombre}
                <span className="block text-xs text-masa-700">
                  Planificado: {enUnidades(o.cantidadPlanificada, o.unidadesPorCaja, o.unidadAbreviatura)}
                  {o.numeroLote !== null ? ` · Lote ${o.numeroLote}` : ''}
                </span>
              </span>
              <label className="flex flex-col items-center gap-0.5">
                <span className="text-micro font-bold uppercase tracking-wide text-dulce-700">Real (u)</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={reales[o.id] ?? ''}
                  onChange={(e) =>
                    setReales((s) => ({ ...s, [o.id]: e.target.value === '' ? '' : Number(e.target.value) }))
                  }
                  className="h-10 w-24 rounded-none border border-masa-300 px-2 text-center font-mono text-base font-bold tabular-nums"
                />
              </label>
            </div>
          ))}
        </div>
        <div className="shrink-0 border-t border-masa-200 p-4">
        {error !== null && (
          <p className="mb-2 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={alCerrar} disabled={guardando}
            className="h-10 rounded-none border border-masa-300 bg-white px-4 text-sm font-bold uppercase text-masa-800">
            Cancelar
          </button>
          <button type="button" onClick={() => void confirmar()} disabled={!valido || guardando}
            className="h-10 rounded-none border border-menta-500 bg-menta-600 px-4 text-sm font-bold uppercase text-white disabled:opacity-30">
            {guardando ? 'Enviando...' : 'Enviar a stock'}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------ Pantalla con pestanias --------------------------- */

export function PantallaOrdenes(): JSX.Element {
  const [pestania, setPestania] = useState<'elaboracion' | 'pedidos'>('elaboracion');
  const claseTab = (activa: boolean): string =>
    [
      'h-10 rounded-none border-b-2 px-4 text-sm font-bold uppercase tracking-wide',
      activa ? 'border-dulce-500 text-dulce-700' : 'border-transparent text-masa-700 hover:text-masa-900',
    ].join(' ');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-masa-200">
        <button type="button" className={claseTab(pestania === 'elaboracion')} onClick={() => setPestania('elaboracion')}>
          Elaboracion
        </button>
        <button type="button" className={claseTab(pestania === 'pedidos')} onClick={() => setPestania('pedidos')}>
          Ordenes de pedido
        </button>
      </div>
      {pestania === 'elaboracion' ? <PestanaElaboracion /> : <PestanaOrdenesDePedido />}
    </div>
  );
}

