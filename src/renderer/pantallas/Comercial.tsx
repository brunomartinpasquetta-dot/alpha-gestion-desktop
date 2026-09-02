/**
 * Pantallas comerciales: pedidos, ventas y compras.
 *
 * Los pedidos son la feature estrella del producto: se cargan desde el celular y
 * despues disparan produccion. Por eso los de origen "celular" se destacan.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';


import {
  ETIQUETA_ESTADO_COMPRA,
  ETIQUETA_ESTADO_PEDIDO,
  ETIQUETA_ESTADO_VENTA,
  ETIQUETA_FORMA_PAGO,
  ETIQUETA_ORIGEN_PEDIDO,
  ETIQUETA_TRANSICION,
  TRANSICIONES_PEDIDO,
  type CompraVista,
  type EstadoPedido,
  type PedidoVista,
  type VentaVista,
} from '../../compartido/contratos';
import { Pastilla, type TonoPastilla } from '../componentes/comunes';
import { Aviso, BotonFila, BotonPrimario } from '../componentes/Formulario';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  anularCompra,
  anularVenta,
  cambiarEstadoPedido,
  obtenerCompras,
  obtenerPedidos,
  obtenerVentas,
} from '../servicios/cliente';
import { FormularioVenta } from './FormularioVenta';
import { definicionDeModulo } from '../ventanas';
import {
  BarraFiltros,
  entraEnRango,
  RANGO_VACIO,
  SelectorFiltro,
  type RangoFechas,
} from '../componentes/filtros';
import { FormularioCompra, FormularioPedido } from './FormulariosOperacion';
import { formatearCantidad,
  formatearFecha,
  formatearMoneda,
  formatearTexto,
  pluralizar,
  pendienteDeItem,
} from '../utiles/formato';

/* --------------------------------- Pedidos --------------------------------- */

function tonoDePedido(estado: PedidoVista['estado']): TonoPastilla {
  switch (estado) {
    case 'pendiente':
      return 'alerta';
    case 'confirmado':
    case 'en_produccion':
      return 'info';
    case 'listo':
    case 'entregado':
      return 'positivo';
    case 'cancelado':
      return 'peligro';
    default:
      return 'neutro';
  }
}

/**
 * Botonera de transiciones de un pedido, derivada de la maquina de estados
 * compartida con el servidor: si mañana cambia una transicion, cambia en un
 * solo lugar.
 */
function AccionesPedido({
  pedido,
  alCambiar,
}: {
  readonly pedido: PedidoVista;
  readonly alCambiar: (estado: EstadoPedido) => void;
}): JSX.Element | null {
  const destinos = TRANSICIONES_PEDIDO[pedido.estado];
  if (destinos.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-masa-200 bg-white px-4 py-2.5">
      {destinos.map((destino) => {
        const cancelar = destino === 'cancelado';
        return (
          <button
            key={destino}
            type="button"
            onClick={(evento) => {
              evento.stopPropagation();
              if (cancelar && !window.confirm(`¿Cancelar el pedido #${pedido.id}?`)) return;
              alCambiar(destino);
            }}
            className={[
              'rounded-pastilla px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2',
              cancelar
                ? 'border border-peligro-300 bg-white text-peligro-600 hover:bg-peligro-50 focus-visible:ring-peligro-400'
                : 'bg-dulce-600 text-white hover:bg-dulce-700 focus-visible:ring-dulce-400',
            ].join(' ')}
          >
            {ETIQUETA_TRANSICION[destino]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Boton de accion de la fila de un pedido. Todos comparten altura y viven en
 * UNA sola fila a la derecha del encabezado: antes cada accion flotaba en su
 * propia linea y la tarjeta parecia un tablero de parches.
 */
function BotonAccionPedido({
  primario = false,
  onClick,
  children,
}: {
  readonly primario?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'h-8 shrink-0 rounded-none px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2',
        primario
          ? 'bg-dulce-600 text-white hover:bg-dulce-700 focus-visible:ring-dulce-400'
          : 'border border-masa-300 bg-white text-masa-800 hover:bg-masa-100 focus-visible:ring-dulce-400',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

/**
 * "16 que?" — toda cantidad de pedido se expresa como se vende: docenas para
 * los productos de a 12, cajas para otros empaques, y la unidad del articulo
 * cuando no hay caja. Nunca un numero pelado.
 */
function enUnidadVenta(cantidad: number, upc: number | null, abreviatura: string): string {
  if (upc === null || upc <= 0) return `${cantidad} ${abreviatura}`;
  const nombre = upc === 12 ? 'docena' : 'caja';
  const enteras = Math.floor(cantidad / upc);
  const resto = cantidad % upc;
  if (enteras === 0) return `${resto} u`;
  const base = `${enteras} ${nombre}${enteras === 1 ? '' : 's'}`;
  return resto === 0 ? base : `${base} y ${resto} u`;
}

/** Cajas enteras y unidades sueltas, cada una en su columna. */
function cajasYUnidades(cantidad: number, upc: number | null): { cajas: string; unidades: string } {
  if (upc === null || upc <= 0) return { cajas: '—', unidades: formatearCantidad(cantidad) };
  const enteras = Math.floor(cantidad / upc);
  const sueltas = Math.round(cantidad % upc);
  return {
    cajas: enteras === 0 ? '—' : `${formatearCantidad(enteras)} × ${upc}`,
    unidades: formatearCantidad(cantidad) + (sueltas > 0 && enteras > 0 ? ` (${sueltas} sueltas)` : ''),
  };
}

function PestanaPedidos(): JSX.Element {
  const estado = usarRecurso(() => obtenerPedidos(), []);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [enEdicion, setEnEdicion] = useState<PedidoVista | null | undefined>(undefined);
  const [vendiendo, setVendiendo] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta'; texto: string } | null>(null);

  // Tiempo real: un pedido cargado desde el celular aparece solo, sin refrescar.
  usarEventos('pedidos:cambio', estado.recargar);

  // El aviso es un toast temporal: a los 8 segundos se va solo, asi cargar
  // varios pedidos seguidos no deja una pila de mensajes viejos mintiendo.
  useEffect(() => {
    if (aviso === null) return undefined;
    const temporizador = window.setTimeout(() => setAviso(null), 8000);
    return () => window.clearTimeout(temporizador);
  }, [aviso]);

  const aplicarTransicion = (pedidoId: number, destino: EstadoPedido): void => {
    setErrorAccion(null);
    cambiarEstadoPedido(pedidoId, destino)
      .then(estado.recargar)
      .catch((causa: unknown) =>
        setErrorAccion(causa instanceof Error ? causa.message : String(causa)),
      );
  };


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo pedido
        </BotonPrimario>
        <p className="text-sm text-masa-800">
          Los pedidos del celular entran solos. Desde aca tambien se cargan a mano.
        </p>
      </div>

      {aviso !== null && (
        <div
          role="status"
          className={[
            'flex items-start justify-between gap-3 rounded-ficha border px-3 py-2 text-sm',
            aviso.tono === 'ok'
              ? 'border-menta-200 bg-menta-50 text-menta-700'
              : 'border-alerta-200 bg-alerta-50 text-alerta-700',
          ].join(' ')}
        >
          <span className="min-w-0">{aviso.texto}</span>
          <button
            type="button"
            aria-label="Cerrar aviso"
            onClick={() => setAviso(null)}
            className="shrink-0 rounded-none px-1 font-bold outline-none hover:opacity-70 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            ✕
          </button>
        </div>
      )}

      {/*
        La lista se lleva 2 de 5 columnas y el detalle las otras 3: los renglones
        de un pedido son anchos (articulo, cajas, unidades, apartado, en
        produccion) y no entran comodos abajo de la lista.
      */}
      <div className="grid gap-3 lg:grid-cols-5 lg:items-start">
      <div className="lg:col-span-2">
        {/* Las dos columnas llevan rotulo para que arranquen a la misma altura:
            con rotulo solo a la derecha, la lista quedaba corrida hacia arriba
            y los bordes de arriba no coincidian. */}
        <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-masa-700">
          Pedidos del dia
        </p>
      <Vista
      estado={estado}
      que="los pedidos"
      tituloVacio="Sin pedidos"
      detalleVacio="Carga el primero con el boton Nuevo pedido, o desde el celular."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(pedidos) => (
        <div className="space-y-2">
          {errorAccion !== null && (
            <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
              {errorAccion}
            </p>
          )}
          {pedidos.map((pedido) => {
            const abierto = expandido === pedido.id;
            const desdeCelular = pedido.origen === 'celular';
            // Que acciones aplican se decide aca arriba: el render de abajo es
            // una sola fila, siempre en el mismo orden.
            const puedeVender = pedido.estado === 'listo';
            const puedeEditar = pedido.estado === 'pendiente' || pedido.estado === 'confirmado' || pedido.estado === 'listo';

            return (
              <div
                key={pedido.id}
                className={[
                  'overflow-hidden rounded-ficha border bg-white shadow-ficha',
                  // El elegido se marca, porque su detalle es el que se ve al lado.
                  abierto ? 'border-dulce-500 ring-1 ring-dulce-300' : desdeCelular ? 'border-dulce-300' : 'border-masa-200',
                ].join(' ')}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    aria-expanded={abierto}
                    onClick={() => setExpandido(abierto ? null : pedido.id)}
                    className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 text-left outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dulce-500"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-masa-700">#{pedido.id}</span>
                        <span className="font-medium text-masa-900">
                          {pedido.clienteNombre ?? 'Mostrador'}
                        </span>
                        <Pastilla
                          texto={ETIQUETA_ESTADO_PEDIDO[pedido.estado]}
                          tono={tonoDePedido(pedido.estado)}
                        />
                        <Pastilla
                          texto={ETIQUETA_ORIGEN_PEDIDO[pedido.origen]}
                          tono={desdeCelular ? 'info' : 'neutro'}
                        />
                      </div>
                      <p className="mt-0.5 text-xs text-masa-700">
                        {formatearFecha(pedido.fechaPedido)}
                        {pedido.cargadoPor !== null && ` · ${pedido.cargadoPor}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-mono tabular-nums text-masa-900">
                        {pluralizar(pedido.items.length, 'articulo', 'articulos')}
                      </p>
                      <p className="text-micro text-masa-700">{abierto ? 'elegido' : 'ver detalle'}</p>
                    </div>
                  </button>

                  {/* Todas las acciones del pedido en una sola fila a la derecha
                      del encabezado, con la misma altura y siempre en el mismo
                      orden. "Vender / facturar" cierra el circuito: abre la
                      venta YA cargada con sus cajas y sus precios. */}
                  {(puedeVender || puedeEditar) && (
                    <div className="flex shrink-0 items-center gap-1.5 pr-4">
                      {puedeVender && (
                        <BotonAccionPedido primario onClick={() => setVendiendo(pedido.id)}>
                          Vender / facturar
                        </BotonAccionPedido>
                      )}
                      {puedeEditar && (
                        <BotonAccionPedido onClick={() => setEnEdicion(pedido)}>
                          Editar
                        </BotonAccionPedido>
                      )}

                    </div>
                  )}
                </div>
                <AccionesPedido
                  pedido={pedido}
                  alCambiar={(destino) => aplicarTransicion(pedido.id, destino)}
                />

              </div>
            );
          })}
        </div>
      )}
      </Vista>
      </div>

      <div className="lg:col-span-3">
        <p className="mb-1.5 text-micro font-semibold uppercase tracking-wide text-masa-700">
          Detalle del pedido
        </p>
        <DetalleDelPedido
          pedido={(estado.datos ?? []).find((x) => x.id === expandido) ?? null}
        />
      </div>
      </div>

      {vendiendo !== null && (
        <FormularioVenta
          pedidoInicial={vendiendo}
          alCerrar={() => setVendiendo(null)}
          alConfirmar={(resultado) => {
            setVendiendo(null);
            estado.recargar();
            setAviso(
              resultado.advertencias.length > 0
                ? {
                    tono: 'alerta',
                    texto: `Venta #${resultado.venta.id} registrada. ${resultado.advertencias.join(' ')}`,
                  }
                : {
                    tono: 'ok',
                    texto: `Venta #${resultado.venta.id} registrada: el pedido quedo entregado.`,
                  },
            );
          }}
        />
      )}

      {enEdicion !== undefined && (
        <FormularioPedido
          pedido={enEdicion}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje, tono) => {
            setEnEdicion(undefined);
            estado.recargar();
            setAviso({ tono, texto: mensaje });
          }}
        />
      )}
    </div>
  );
}

/* ---------------------------------- Ventas --------------------------------- */

function tonoDeVenta(estado: VentaVista['estado']): TonoPastilla {
  if (estado === 'entregada') return 'positivo';
  if (estado === 'anulada') return 'peligro';
  return 'alerta';
}

const COLUMNAS_VENTAS: readonly Columna<VentaVista>[] = [
  { clave: 'id', titulo: '#', celda: (v) => v.id, numerica: true, ancho: 'w-14' },
  { clave: 'fecha', titulo: 'Fecha', celda: (v) => formatearFecha(v.fecha), numerica: true },
  {
    clave: 'cliente',
    titulo: 'Cliente',
    celda: (v) =>
      v.clienteNombre ?? <span className="text-masa-700">Mostrador (sin identificar)</span>,
  },
  { clave: 'items', titulo: 'Items', celda: (v) => v.cantidadItems, numerica: true },
  {
    clave: 'comprobante',
    titulo: 'Comprobante',
    celda: (v) =>
      v.comprobanteEtiqueta == null ? (
        <span className="text-masa-700">Remito X</span>
      ) : (
        <span title={v.cae === null ? undefined : `CAE ${v.cae}`} className="font-mono text-xs font-semibold text-masa-900">
          {v.comprobanteEtiqueta}
        </span>
      ),
  },
  { clave: 'pago', titulo: 'Forma de pago', celda: (v) => ETIQUETA_FORMA_PAGO[v.formaPago] },
  {
    clave: 'pedido',
    titulo: 'Pedido',
    celda: (v) => (v.pedidoId === null ? '—' : `#${v.pedidoId}`),
  },
  { clave: 'total', titulo: 'Total', celda: (v) => formatearMoneda(v.total), numerica: true },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (v) => <Pastilla texto={ETIQUETA_ESTADO_VENTA[v.estado]} tono={tonoDeVenta(v.estado)} />,
  },
];

export function PantallaVentas(): JSX.Element {
  const estado = usarRecurso(() => obtenerVentas(), []);
  const pedidos = usarRecurso(() => obtenerPedidos(), []);
  const [modalVenta, setModalVenta] = useState(false);
  // El atajo "Vender / facturar" de un pedido listo reutiliza el MISMO modal de
  // la venta suelta: solo cambia con que pedido entra precargado.
  const [pedidoParaVender, setPedidoParaVender] = useState<number | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);

  usarEventos('ventas:cambio', estado.recargar);
  usarEventos('pedidos:cambio', pedidos.recargar);

  // La venta casi siempre nace de un pedido listo de un CLIENTE cargado: aca se
  // ven sin ir al modulo Pedidos. Los de mostrador no aparecen porque no hay
  // saldo apartado a nombre de nadie que venir a buscar.
  const pedidosListos = (pedidos.datos ?? []).filter(
    (p) => p.estado === 'listo' && p.clienteId !== null,
  );

  const anular = (venta: VentaVista): void => {
    if (!window.confirm(`¿Anular la venta #${venta.id}? Se revierte el stock y el cobro.`)) return;
    setAviso(null);
    anularVenta(venta.id)
      .then((resultado) => {
        estado.recargar();
        setAviso(
          resultado.advertencias.length > 0
            ? { tono: 'alerta', texto: resultado.advertencias.join(' ') }
            : { tono: 'ok', texto: `Venta #${venta.id} anulada y revertida.` },
        );
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  /** Abre el comprobante en su propia ventana, lista para imprimir. */
  const imprimir = (venta: VentaVista): void => {
    window.alfajores?.ventanas.abrir(
      'comprobante',
      venta.comprobanteEtiqueta ?? `Remito venta #${venta.id}`,
      'ventas',
      { ventaId: String(venta.id) },
    );
  };

  const columnas: readonly Columna<VentaVista>[] = [
    ...COLUMNAS_VENTAS,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (v) => (
        <div className="flex gap-1">
          <BotonFila onClick={() => imprimir(v)}>Imprimir</BotonFila>
          {v.estado === 'entregada' && (
            <BotonFila onClick={() => anular(v)} tono="peligro">
              Anular
            </BotonFila>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          La venta descuenta stock y cobra (caja o cuenta corriente) en un solo paso.
        </p>
        <button
          type="button"
          onClick={() => setModalVenta(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-ficha bg-dulce-600 px-4 py-2 text-sm font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva venta
        </button>
      </div>

      {aviso !== null && (
        <p
          role={aviso.tono === 'mal' ? 'alert' : 'status'}
          className={[
            'rounded-ficha border px-3 py-2 text-sm',
            aviso.tono === 'ok' && 'border-menta-200 bg-menta-50 text-menta-700',
            aviso.tono === 'alerta' && 'border-alerta-200 bg-alerta-50 text-alerta-700',
            aviso.tono === 'mal' && 'border-peligro-200 bg-peligro-50 text-peligro-600',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {aviso.texto}
        </p>
      )}

      {/* Atajo compacto, no la pantalla principal: si esta vacio no se muestra
          nada, porque una caja vacia solo agregaria ruido. */}
      {pedidosListos.length > 0 && (
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white shadow-ficha">
          <p className="border-b border-masa-200 px-4 py-2 text-micro font-semibold uppercase tracking-wide text-masa-700">
            Pedidos listos para vender
          </p>
          {pedidosListos.map((pedido, indice) => {
            // El detalle muestra el SALDO apartado (no lo pedido original):
            // tras una entrega parcial es lo que de verdad queda por vender.
            const detalle = pedido.items
              .map((item) => {
                const saldo = pendienteDeItem(item);
                return enUnidadVenta(saldo, item.unidadesPorCaja, item.unidadAbreviatura);
              })
              .join(' + ');
            return (
              <div
                key={pedido.id}
                className={[
                  'flex items-center justify-between gap-3 px-4 py-2',
                  indice > 0 ? 'border-t border-masa-100' : '',
                ].join(' ')}
              >
                <p className="min-w-0 flex-1 truncate text-sm text-masa-900">
                  <span className="font-mono text-xs text-masa-700">#{pedido.id}</span>{' '}
                  <span className="font-medium">{pedido.clienteNombre}</span>
                  <span className="text-masa-700">
                    {' '}· {pluralizar(pedido.items.length, 'articulo', 'articulos')} · {detalle}
                  </span>
                </p>
                <BotonAccionPedido primario onClick={() => setPedidoParaVender(pedido.id)}>
                  Vender / facturar
                </BotonAccionPedido>
              </div>
            );
          })}
        </div>
      )}

      <Vista
        estado={estado}
        que="las ventas"
        tituloVacio="Sin ventas registradas"
        detalleVacio="Registra la primera con el boton Nueva venta."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => <Tabla columnas={columnas} filas={filas} claveDeFila={(v) => v.id} />}
      </Vista>

      {(modalVenta || pedidoParaVender !== null) && (
        <FormularioVenta
          pedidoInicial={pedidoParaVender}
          alCerrar={() => {
            setModalVenta(false);
            setPedidoParaVender(null);
          }}
          alConfirmar={(resultado) => {
            setModalVenta(false);
            setPedidoParaVender(null);
            estado.recargar();
            // El pedido vendido cambia de estado: sin recargar quedaria listado
            // como vendible cuando ya no lo es.
            pedidos.recargar();
            setAviso(
              resultado.advertencias.length > 0
                ? { tono: 'alerta', texto: `Venta #${resultado.venta.id} registrada. ${resultado.advertencias.join(' ')}` }
                : { tono: 'ok', texto: `Venta #${resultado.venta.id} registrada por ${'$'} ${(resultado.venta.total / 100).toLocaleString('es-AR')}.` },
            );
          }}
        />
      )}
    </div>
  );
}

/* --------------------------------- Compras --------------------------------- */

const COLUMNAS_COMPRAS: readonly Columna<CompraVista>[] = [
  { clave: 'id', titulo: '#', celda: (c) => c.id, numerica: true, ancho: 'w-14' },
  { clave: 'fecha', titulo: 'Fecha', celda: (c) => formatearFecha(c.fecha), numerica: true },
  { clave: 'proveedor', titulo: 'Proveedor', celda: (c) => c.proveedorNombre },
  { clave: 'items', titulo: 'Items', celda: (c) => c.cantidadItems, numerica: true },
  { clave: 'pago', titulo: 'Forma de pago', celda: (c) => ETIQUETA_FORMA_PAGO[c.formaPago] },
  { clave: 'total', titulo: 'Total', celda: (c) => formatearMoneda(c.total), numerica: true },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (c) => (
      <Pastilla
        texto={ETIQUETA_ESTADO_COMPRA[c.estado]}
        tono={c.estado === 'recibida' ? 'positivo' : 'alerta'}
      />
    ),
  },
];

export function PantallaCompras(): JSX.Element {
  const estado = usarRecurso(() => obtenerCompras(), []);
  const [modalCompra, setModalCompra] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);

  usarEventos('compras:cambio', estado.recargar);

  const anular = (compra: CompraVista): void => {
    if (!window.confirm(`¿Anular la compra #${compra.id}? Sale del stock y se revierte el pago.`)) return;
    setAviso(null);
    anularCompra(compra.id)
      .then((r) => {
        estado.recargar();
        setAviso(
          r.advertencias.length > 0
            ? { tono: 'alerta', texto: r.advertencias.join(' ') }
            : { tono: 'ok', texto: `Compra #${compra.id} anulada y revertida.` },
        );
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  const columnas: readonly Columna<CompraVista>[] = [
    ...COLUMNAS_COMPRAS,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (c) =>
        c.estado === 'recibida' ? (
          <BotonFila onClick={() => anular(c)} tono="peligro">
            Anular
          </BotonFila>
        ) : (
          <span className="text-masa-700">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          La compra ingresa el stock y genera la deuda o el pago en un solo paso.
        </p>
        <BotonPrimario onClick={() => setModalCompra(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nueva compra
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="las compras"
        tituloVacio="Sin compras registradas"
        detalleVacio="Registra la primera con el boton Nueva compra."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => <Tabla columnas={columnas} filas={filas} claveDeFila={(c) => c.id} />}
      </Vista>

      {modalCompra && (
        <FormularioCompra
          alCerrar={() => setModalCompra(false)}
          alGuardar={(mensaje, advertencias) => {
            setModalCompra(false);
            estado.recargar();
            setAviso(
              advertencias.length > 0
                ? { tono: 'alerta', texto: `${mensaje} ${advertencias.join(' ')}` }
                : { tono: 'ok', texto: mensaje },
            );
          }}
        />
      )}
    </div>
  );
}

/* --------------------------- Gestion de pedidos ---------------------------- */

/**
 * Pestania GESTION DE PEDIDOS: la vista administrativa. Primero los pedidos de
 * HOY, despues los anteriores; cada fila muestra cliente, vendedor y estado, el
 * click abre el detalle, y las acciones son Editar, Cancelar y Facturar (que
 * dispara el formulario de venta con el pedido ya cargado: cliente, lista,
 * saldo, comprobante y formas de pago).
 */
function PestanaGestionPedidos(): JSX.Element {
  const estado = usarRecurso(() => obtenerPedidos(), []);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [enEdicion, setEnEdicion] = useState<PedidoVista | null | undefined>(undefined);
  const [vendiendo, setVendiendo] = useState<number | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoFechas>(RANGO_VACIO);
  const [clienteFiltro, setClienteFiltro] = useState<number | ''>('');
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoPedido | ''>('');

  usarEventos('pedidos:cambio', estado.recargar);

  useEffect(() => {
    if (aviso === null) return undefined;
    const temporizador = window.setTimeout(() => setAviso(null), 8000);
    return () => window.clearTimeout(temporizador);
  }, [aviso]);

  const cancelar = (pedido: PedidoVista): void => {
    if (!window.confirm(`¿Cancelar el pedido #${pedido.id}${pedido.clienteNombre !== null ? ` de ${pedido.clienteNombre}` : ''}?`)) return;
    setErrorAccion(null);
    cambiarEstadoPedido(pedido.id, 'cancelado')
      .then(estado.recargar)
      .catch((causa: unknown) => setErrorAccion(causa instanceof Error ? causa.message : String(causa)));
  };

  const esDeHoy = (p: PedidoVista): boolean =>
    new Date(p.fechaPedido).toDateString() === new Date().toDateString();

  return (
    <div className="space-y-3">
      {aviso !== null && (
        <p role="status" className="rounded-ficha border border-menta-200 bg-menta-50 px-3 py-2 text-sm text-menta-700">
          {aviso}
        </p>
      )}
      {errorAccion !== null && (
        <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
          {errorAccion}
        </p>
      )}
      <Vista
        estado={estado}
        que="los pedidos"
        tituloVacio="Sin pedidos"
        detalleVacio="Carga el primero desde la pestania Pedidos."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(todos) => {
          const visibles = todos
            .filter((p) => entraEnRango(p.fechaPedido, rango))
            .filter((p) => clienteFiltro === '' || p.clienteId === clienteFiltro)
            .filter((p) => estadoFiltro === '' || p.estado === estadoFiltro);
          const clientesDeLaLista = [...new Map(
            todos.filter((p) => p.clienteId !== null).map((p) => [p.clienteId!, p.clienteNombre ?? 'Cliente']),
          )].map(([valor, etiqueta]) => ({ valor, etiqueta })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
          const hayFiltros =
            rango.desde !== '' || rango.hasta !== '' || clienteFiltro !== '' || estadoFiltro !== '';
          // Con filtro puesto se muestran TODOS los que coinciden (incluidos
          // cancelados si se pidieron); sin filtro, la vista de trabajo.
          const activos = hayFiltros ? visibles : visibles.filter((p) => p.estado !== 'cancelado');
          const deHoy = activos.filter(esDeHoy);
          const anteriores = activos.filter((p) => !esDeHoy(p));
          const grupos: [string, PedidoVista[]][] = [
            ['Pedidos de hoy', deHoy],
            ['Anteriores', anteriores],
          ];
          return (
            <div className="space-y-4">
              <BarraFiltros
                rango={rango}
                alCambiarRango={setRango}
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
                      alCambiar={(v) => setEstadoFiltro(v as EstadoPedido | '')}
                      vacio="Todos los estados"
                      opciones={(Object.keys(ETIQUETA_ESTADO_PEDIDO) as EstadoPedido[]).map((e) => ({
                        valor: e,
                        etiqueta: ETIQUETA_ESTADO_PEDIDO[e],
                      }))}
                    />
                  </>
                }
                resumen={`${activos.length} de ${todos.length} pedidos`}
                alLimpiar={() => {
                  setRango(RANGO_VACIO);
                  setClienteFiltro('');
                  setEstadoFiltro('');
                }}
                hayFiltros={hayFiltros}
              />
              {grupos.map(([titulo, lista]) => (
                <div key={titulo}>
                  <p className="mb-1.5 text-micro font-bold uppercase tracking-wide text-masa-700">
                    {titulo} ({lista.length})
                  </p>
                  {lista.length === 0 ? (
                    <p className="rounded-ficha border border-masa-200 bg-white px-3 py-3 text-sm text-masa-700">
                      {titulo === 'Pedidos de hoy' ? 'Todavia no entraron pedidos hoy.' : 'Nada anterior pendiente.'}
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                            <th className="px-3 py-2 font-semibold">Pedido</th>
                            <th className="px-3 py-2 font-semibold">Cliente</th>
                            <th className="px-3 py-2 font-semibold">Vendedor</th>
                            <th className="px-3 py-2 font-semibold">Estado</th>
                            <th className="px-3 py-2 text-right font-semibold">Acciones</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lista.map((pedido) => {
                            const abierto = expandido === pedido.id;
                            const puedeEditar = pedido.estado === 'pendiente' || pedido.estado === 'confirmado' || pedido.estado === 'listo';
                            const puedeFacturar =
                              pedido.estado === 'listo' || pedido.items.some((i) => i.reservado > 0);
                            const activo = pedido.estado !== 'entregado';
                            const claseBoton =
                              'h-8 rounded-none border px-2.5 text-xs font-bold uppercase tracking-wide disabled:opacity-30';
                            return (
                              <FilaConDetalle key={pedido.id} abierto={abierto} pedido={pedido}>
                                <tr
                                  onClick={() => setExpandido(abierto ? null : pedido.id)}
                                  className={['cursor-pointer border-b border-masa-100', abierto ? 'bg-dulce-50' : 'hover:bg-masa-50'].join(' ')}
                                >
                                  <td className="px-3 py-2">
                                    <span className="font-mono font-bold text-masa-900">#{pedido.id}</span>
                                    <span className="block text-xs text-masa-700">
                                      {new Date(pedido.fechaPedido).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                                      {esDeHoy(pedido) ? '' : ` · ${new Date(pedido.fechaPedido).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}`}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-masa-900">{pedido.clienteNombre ?? 'Mostrador'}</td>
                                  <td className="px-3 py-2 text-masa-800">{pedido.vendedorNombre ?? 'Venta directa'}</td>
                                  <td className="px-3 py-2">
                                    <Pastilla
                                      texto={ETIQUETA_ESTADO_PEDIDO[pedido.estado]}
                                      tono={tonoDePedido(pedido.estado)}
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        title="Imprimir la orden de trabajo en 80 mm"
                                        onClick={() => {
                                          const d = definicionDeModulo('ticket-pedido');
                                          window.alfajores?.ventanas.abrir(
                                            d.clave,
                                            `Ticket pedido #${pedido.id}`,
                                            d.icono,
                                            { pedidoId: String(pedido.id) },
                                          );
                                        }}
                                        className={`${claseBoton} border-masa-400 bg-white text-masa-900`}
                                      >
                                        Ticket
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!puedeEditar}
                                        onClick={() => setEnEdicion(pedido)}
                                        className={`${claseBoton} border-masa-300 bg-white text-masa-800`}
                                      >
                                        Editar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!puedeFacturar}
                                        title={puedeFacturar ? 'Abre la venta con el pedido cargado' : 'Todavia no hay nada apartado para facturar'}
                                        onClick={() => setVendiendo(pedido.id)}
                                        className={`${claseBoton} border-dulce-400 bg-dulce-500 text-white`}
                                      >
                                        Facturar
                                      </button>
                                      <button
                                        type="button"
                                        disabled={!activo}
                                        onClick={() => cancelar(pedido)}
                                        className={`${claseBoton} border-peligro-300 bg-white text-peligro-700`}
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              </FilaConDetalle>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        }}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioPedido
          pedido={enEdicion}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje) => {
            setEnEdicion(undefined);
            estado.recargar();
            setAviso(mensaje);
          }}
        />
      )}

      {vendiendo !== null && (
        <FormularioVenta
          pedidoInicial={vendiendo}
          alCerrar={() => setVendiendo(null)}
          alConfirmar={() => {
            setVendiendo(null);
            estado.recargar();
            setAviso('Venta registrada.');
          }}
        />
      )}
    </div>
  );
}

/** La fila y, si esta abierta, el detalle del pedido debajo. */
function FilaConDetalle({
  abierto,
  pedido,
  children,
}: {
  readonly abierto: boolean;
  readonly pedido: PedidoVista;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      {children}
      {abierto && (
        <tr className="border-b border-masa-100 bg-masa-50">
          <td colSpan={5} className="px-4 py-3">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-micro font-bold uppercase tracking-wide text-masa-700">Detalle del pedido</p>
                {pedido.renglones.length > 0 ? (
                  <ul className="space-y-1">
                    {pedido.renglones.map((r) => (
                      <li key={r.id} className="rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm text-masa-900">
                        <span className="font-mono font-bold tabular-nums">{r.cantidad} ×</span>{' '}
                        {r.descripcion ?? r.presentacionNombre ?? 'renglon'}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="space-y-1">
                    {pedido.items.map((item) => (
                      <li key={item.id} className="rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm text-masa-900">
                        <span className="font-mono font-bold tabular-nums">{item.cantidad} u</span> {item.nombre}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-micro font-bold uppercase tracking-wide text-masa-700">Estado del pedido</p>
                <ul className="space-y-1">
                  {pedido.items.map((item) => (
                    <li key={item.id} className="rounded-ficha border border-masa-200 bg-white px-2.5 py-1.5 text-sm text-masa-900">
                      {item.nombre}: <span className="font-mono tabular-nums">{item.reservado} u</span> apartadas de{' '}
                      <span className="font-mono tabular-nums">{item.cantidad} u</span>
                    </li>
                  ))}
                </ul>
                {pedido.notas !== null && pedido.notas !== '' && (
                  <p className="mt-1.5 text-xs text-masa-700">Notas: {pedido.notas}</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* --------------------------- Pantalla con pestanias ------------------------ */


/**
 * Detalle del pedido elegido, en su propio panel al lado de la lista.
 *
 * Antes se desplegaba DENTRO de la fila: la lista se corria para abajo cada vez
 * que se abria uno y comparar dos pedidos obligaba a abrir y cerrar. Aca la
 * lista queda quieta y el detalle siempre en el mismo lugar.
 */
function DetalleDelPedido({ pedido }: { readonly pedido: PedidoVista | null }): JSX.Element {
  if (pedido === null) {
    return (
      <div className="flex h-full min-h-[12rem] items-center justify-center rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-8 text-center">
        <p className="text-sm text-masa-700">
          Elegi un pedido de la lista para ver que pidio, que esta apartado y que falta elaborar.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-ficha border border-masa-200 bg-white p-4 shadow-ficha">
      <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-masa-200 pb-2">
        <span className="font-mono text-xs text-masa-700">#{pedido.id}</span>
        <span className="font-semibold text-masa-900">{pedido.clienteNombre ?? 'Mostrador'}</span>
        <Pastilla texto={ETIQUETA_ESTADO_PEDIDO[pedido.estado]} tono={tonoDePedido(pedido.estado)} />
        <span className="ml-auto text-xs text-masa-700">{formatearFecha(pedido.fechaPedido)}</span>
      </div>
  {/* Solo lo que compete al PEDIDO: que pidio, que esta
      apartado y que esta en produccion. La gestion de la
      elaboracion (Elaborar, Finalizar) vive en Produccion. */}
  <table className="w-full text-sm">
    <thead>
      <tr className="text-micro uppercase tracking-wide text-masa-700">
        <th scope="col" className="pb-1 text-left">Articulo</th>
        <th scope="col" className="pb-1 text-right">Cajas</th>
        <th scope="col" className="pb-1 text-right">Unidades</th>
        <th scope="col" className="pb-1 text-right">Apartado</th>
        <th scope="col" className="pb-1 text-right">En produccion</th>
        {pedido.items.some((i) => i.notas !== null) && (
          <th scope="col" className="pb-1 text-left">Notas</th>
        )}
      </tr>
    </thead>
    <tbody>
      {pedido.items.map((item) => {
        const apartado = Math.min(item.reservado, item.cantidad);
        const enProduccion = Math.max(0, item.cantidad - item.reservado);
        return (
          <tr key={item.id} className="border-t border-masa-200">
            <td className="py-1.5 text-masa-900">
              <span className="font-mono text-xs text-masa-700">{item.codigo}</span>{' '}
              {item.nombre}
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums text-masa-900">
              {cajasYUnidades(item.cantidad, item.unidadesPorCaja).cajas}
            </td>
            <td className="py-1.5 text-right font-mono font-semibold tabular-nums text-masa-900">
              {cajasYUnidades(item.cantidad, item.unidadesPorCaja).unidades}
            </td>
            <td className="py-1.5 text-right">
              {apartado >= item.cantidad ? (
                <Pastilla texto="Completo" tono="positivo" />
              ) : apartado > 0 ? (
                <span className="font-mono tabular-nums text-masa-900">
                  {enUnidadVenta(apartado, item.unidadesPorCaja, item.unidadAbreviatura)}
                </span>
              ) : (
                <span className="text-masa-700">—</span>
              )}
            </td>
            <td className="py-1.5 text-right">
              {enProduccion > 0 ? (
                <span className="font-mono tabular-nums text-alerta-700">
                  {enUnidadVenta(enProduccion, item.unidadesPorCaja, item.unidadAbreviatura)}
                </span>
              ) : (
                <span className="text-masa-700">—</span>
              )}
            </td>
            {pedido.items.some((i) => i.notas !== null) && (
              <td className="py-1.5 text-masa-700">{formatearTexto(item.notas)}</td>
            )}
          </tr>
        );
      })}
    </tbody>
  </table>
  {pedido.notas !== null && (
    <p className="mt-2 text-xs text-masa-700">Nota: {pedido.notas}</p>
  )}
    </div>
  );
}

export function PantallaPedidos(): JSX.Element {
  const [pestania, setPestania] = useState<'pedidos' | 'gestion'>('pedidos');
  const claseTab = (activa: boolean): string =>
    [
      'h-10 rounded-none border-b-2 px-4 text-sm font-bold uppercase tracking-wide',
      activa ? 'border-dulce-500 text-dulce-700' : 'border-transparent text-masa-700 hover:text-masa-900',
    ].join(' ');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-masa-200">
        <button type="button" className={claseTab(pestania === 'pedidos')} onClick={() => setPestania('pedidos')}>
          Pedidos
        </button>
        <button type="button" className={claseTab(pestania === 'gestion')} onClick={() => setPestania('gestion')}>
          Gestion de pedidos
        </button>
      </div>
      {pestania === 'pedidos' ? <PestanaPedidos /> : <PestanaGestionPedidos />}
    </div>
  );
}

