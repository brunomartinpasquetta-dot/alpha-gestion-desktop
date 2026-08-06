/**
 * Pantallas comerciales: pedidos, ventas y compras.
 *
 * Los pedidos son la feature estrella del producto: se cargan desde el celular y
 * despues disparan produccion. Por eso los de origen "celular" se destacan.
 */

import { useState } from 'react';
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
import { FormularioCompra } from './FormulariosOperacion';
import {
  formatearCajas,
  formatearCantidadConUnidad,
  formatearFecha,
  formatearMoneda,
  formatearTexto,
  pluralizar,
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

export function PantallaPedidos(): JSX.Element {
  const estado = usarRecurso(() => obtenerPedidos(), []);
  const [expandido, setExpandido] = useState<number | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  // Tiempo real: un pedido cargado desde el celular aparece solo, sin refrescar.
  usarEventos('pedidos:cambio', estado.recargar);

  const aplicarTransicion = (pedidoId: number, destino: EstadoPedido): void => {
    setErrorAccion(null);
    cambiarEstadoPedido(pedidoId, destino)
      .then(estado.recargar)
      .catch((causa: unknown) =>
        setErrorAccion(causa instanceof Error ? causa.message : String(causa)),
      );
  };

  return (
    <Vista
      estado={estado}
      que="los pedidos"
      tituloVacio="Sin pedidos"
      detalleVacio="No hay pedidos cargados. Carga los datos de demostracion para ver pedidos en distintos estados, incluidos los que entran desde el celular."
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

            return (
              <div
                key={pedido.id}
                className={[
                  'overflow-hidden rounded-ficha border bg-white shadow-ficha',
                  desdeCelular ? 'border-dulce-300' : 'border-masa-200',
                ].join(' ')}
              >
                <button
                  type="button"
                  aria-expanded={abierto}
                  onClick={() => setExpandido(abierto ? null : pedido.id)}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dulce-500"
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
                      Pedido {formatearFecha(pedido.fechaPedido)}
                      {pedido.fechaEntregaEstimada !== null &&
                        ` · entrega estimada ${formatearFecha(pedido.fechaEntregaEstimada)}`}
                      {pedido.cargadoPor !== null && ` · cargado por ${pedido.cargadoPor}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono tabular-nums text-masa-900">
                      {pluralizar(pedido.items.length, 'articulo', 'articulos')}
                    </p>
                    <p className="text-micro text-masa-700">{abierto ? 'ocultar' : 'ver detalle'}</p>
                  </div>
                </button>

                <AccionesPedido
                  pedido={pedido}
                  alCambiar={(destino) => aplicarTransicion(pedido.id, destino)}
                />

                {abierto && (
                  <div className="border-t border-masa-200 bg-masa-50 px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-micro uppercase tracking-wide text-masa-700">
                          <th scope="col" className="pb-1 text-left">Articulo</th>
                          <th scope="col" className="pb-1 text-right">Cantidad</th>
                          <th scope="col" className="pb-1 text-left">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedido.items.map((item) => (
                          <tr key={item.id} className="border-t border-masa-200">
                            <td className="py-1.5 text-masa-900">
                              <span className="font-mono text-xs text-masa-700">{item.codigo}</span>{' '}
                              {item.nombre}
                            </td>
                            <td className="py-1.5 text-right font-mono tabular-nums text-masa-900">
                              {item.unidadesPorCaja === null
                                ? formatearCantidadConUnidad(item.cantidad, item.unidadAbreviatura)
                                : `${formatearCajas(item.cantidad, item.unidadesPorCaja)} (${item.cantidad} u)`}
                            </td>
                            <td className="py-1.5 text-masa-700">{formatearTexto(item.notas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pedido.notas !== null && (
                      <p className="mt-2 text-xs text-masa-700">Nota: {pedido.notas}</p>
                    )}
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
  const [modalVenta, setModalVenta] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);

  usarEventos('ventas:cambio', estado.recargar);

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

  const columnas: readonly Columna<VentaVista>[] = [
    ...COLUMNAS_VENTAS,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (v) =>
        v.estado === 'entregada' ? (
          <button
            type="button"
            onClick={() => anular(v)}
            className="rounded-pastilla border border-peligro-300 px-2 py-0.5 text-xs font-medium text-peligro-600 outline-none hover:bg-peligro-50 focus-visible:ring-2 focus-visible:ring-peligro-400"
          >
            Anular
          </button>
        ) : (
          <span className="text-masa-700">—</span>
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

      <Vista
        estado={estado}
        que="las ventas"
        tituloVacio="Sin ventas registradas"
        detalleVacio="Registra la primera con el boton Nueva venta."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => <Tabla columnas={columnas} filas={filas} claveDeFila={(v) => v.id} />}
      </Vista>

      {modalVenta && (
        <FormularioVenta
          alCerrar={() => setModalVenta(false)}
          alConfirmar={(resultado) => {
            setModalVenta(false);
            estado.recargar();
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
