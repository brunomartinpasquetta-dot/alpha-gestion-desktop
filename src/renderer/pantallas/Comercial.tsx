/**
 * Pantallas comerciales: pedidos, ventas y compras.
 *
 * Los pedidos son la feature estrella del producto: se cargan desde el celular y
 * despues disparan produccion. Por eso los de origen "celular" se destacan.
 */

import { useState } from 'react';

import {
  ETIQUETA_ESTADO_COMPRA,
  ETIQUETA_ESTADO_PEDIDO,
  ETIQUETA_ESTADO_VENTA,
  ETIQUETA_FORMA_PAGO,
  ETIQUETA_ORIGEN_PEDIDO,
  type CompraVista,
  type PedidoVista,
  type VentaVista,
} from '../../compartido/contratos';
import { Pastilla, type TonoPastilla } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerCompras, obtenerPedidos, obtenerVentas } from '../servicios/cliente';
import {
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
      return 'marca';
    case 'listo':
    case 'entregado':
      return 'positivo';
    case 'cancelado':
      return 'peligro';
    default:
      return 'neutro';
  }
}

export function PantallaPedidos(): JSX.Element {
  const estado = usarRecurso(() => obtenerPedidos(), []);
  const [expandido, setExpandido] = useState<number | null>(null);

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
                      <span className="font-mono text-xs text-masa-500">#{pedido.id}</span>
                      <span className="font-medium text-masa-800">
                        {pedido.clienteNombre ?? 'Mostrador'}
                      </span>
                      <Pastilla
                        texto={ETIQUETA_ESTADO_PEDIDO[pedido.estado]}
                        tono={tonoDePedido(pedido.estado)}
                      />
                      <Pastilla
                        texto={ETIQUETA_ORIGEN_PEDIDO[pedido.origen]}
                        tono={desdeCelular ? 'marca' : 'neutro'}
                      />
                    </div>
                    <p className="mt-0.5 text-xs text-masa-600">
                      Pedido {formatearFecha(pedido.fechaPedido)}
                      {pedido.fechaEntregaEstimada !== null &&
                        ` · entrega estimada ${formatearFecha(pedido.fechaEntregaEstimada)}`}
                      {pedido.cargadoPor !== null && ` · cargado por ${pedido.cargadoPor}`}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono tabular-nums text-masa-800">
                      {pluralizar(pedido.items.length, 'articulo', 'articulos')}
                    </p>
                    <p className="text-micro text-masa-500">{abierto ? 'ocultar' : 'ver detalle'}</p>
                  </div>
                </button>

                {abierto && (
                  <div className="border-t border-masa-200 bg-masa-50 px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-micro uppercase tracking-wide text-masa-500">
                          <th scope="col" className="pb-1 text-left">Articulo</th>
                          <th scope="col" className="pb-1 text-right">Cantidad</th>
                          <th scope="col" className="pb-1 text-left">Notas</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pedido.items.map((item) => (
                          <tr key={item.id} className="border-t border-masa-200">
                            <td className="py-1.5 text-masa-800">
                              <span className="font-mono text-xs text-masa-500">{item.codigo}</span>{' '}
                              {item.nombre}
                            </td>
                            <td className="py-1.5 text-right font-mono tabular-nums text-masa-800">
                              {formatearCantidadConUnidad(item.cantidad, item.unidadAbreviatura)}
                            </td>
                            <td className="py-1.5 text-masa-600">{formatearTexto(item.notas)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pedido.notas !== null && (
                      <p className="mt-2 text-xs text-masa-600">Nota: {pedido.notas}</p>
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
      v.clienteNombre ?? <span className="text-masa-500">Mostrador (sin identificar)</span>,
  },
  { clave: 'items', titulo: 'Items', celda: (v) => v.cantidadItems, numerica: true },
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

  return (
    <Vista
      estado={estado}
      que="las ventas"
      tituloVacio="Sin ventas registradas"
      detalleVacio="Todavia no se emitio ningun comprobante. Carga los datos de demostracion para ver el modulo con ventas de contado y de cuenta corriente."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => <Tabla columnas={COLUMNAS_VENTAS} filas={filas} claveDeFila={(v) => v.id} />}
    </Vista>
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

  return (
    <Vista
      estado={estado}
      que="las compras"
      tituloVacio="Sin compras registradas"
      detalleVacio="No hay compras a proveedores. Carga los datos de demostracion para ver el modulo, incluida una compra pendiente que todavia no impacta el stock."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <>
          <p className="mb-2 text-xs text-masa-600">
            Solo las compras <strong>recibidas</strong> generan movimiento de stock: una compra
            pendiente todavia no ingreso a la fabrica.
          </p>
          <Tabla columnas={COLUMNAS_COMPRAS} filas={filas} claveDeFila={(c) => c.id} />
        </>
      )}
    </Vista>
  );
}
