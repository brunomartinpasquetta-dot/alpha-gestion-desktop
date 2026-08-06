/**
 * Formulario de venta — el primer documento comercial que se emite desde la UI.
 *
 * Flujo pensado para el mostrador de la fabrica:
 *  1. Se elige el cliente (o mostrador) y la forma de pago.
 *  2. Opcional: se parte de un pedido LISTO, que precarga cliente e items y se
 *     marca entregado al confirmar la venta.
 *  3. Las cantidades se cargan EN CAJAS (los clientes compran cajas cerradas);
 *     el precio sale de la lista del cliente (o General) y es editable.
 *  4. Se elige el COMPROBANTE: remito interno o factura electronica. Igual que
 *     en StockFlow, la factura se emite CON la venta: al confirmar se pide el
 *     CAE a ARCA y recien con el CAE aprobado se registra todo.
 *  5. Confirmar registra todo en una transaccion: stock, cuenta corriente o
 *     caja, y el pedido si corresponde.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  CODIGO_RECEPTOR_CONSUMIDOR_FINAL,
  CONDICIONES_IVA_RECEPTOR,
} from '../../compartido/contratos';
import type {
  ArticuloConStock,
  ClienteVista,
  ConfiguracionFiscalVista,
  EntradaNuevaVenta,
  FormaPago,
  ListaPrecioVista,
  PedidoVista,
  ResultadoVenta,
  TipoComprobante,
} from '../../compartido/contratos';
import {
  crearVenta,
  obtenerArticulos,
  obtenerClientes,
  obtenerConfigFiscal,
  obtenerListasPrecio,
  obtenerPedidos,
} from '../servicios/cliente';
import { aCentavos, formatearCajas, formatearMoneda } from '../utiles/formato';

/** Cantidades elegidas por articulo, EN CAJAS (o unidades si no tiene caja). */
type Seleccion = Readonly<Record<number, number>>;
/** Precios editados por articulo, en PESOS como texto (se convierte al enviar). */
type PreciosEditados = Readonly<Record<number, string>>;

interface Catalogos {
  productos: ArticuloConStock[];
  clientes: ClienteVista[];
  listas: ListaPrecioVista[];
  pedidosListos: PedidoVista[];
  fiscal: ConfiguracionFiscalVista;
}

export function FormularioVenta({
  alCerrar,
  alConfirmar,
}: {
  readonly alCerrar: () => void;
  readonly alConfirmar: (resultado: ResultadoVenta) => void;
}): JSX.Element {
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [clienteId, setClienteId] = useState<number | ''>('');
  const [formaPago, setFormaPago] = useState<FormaPago>('contado');
  const [pedidoId, setPedidoId] = useState<number | ''>('');
  const [comprobante, setComprobante] = useState<TipoComprobante>('remito');
  const [condicionIvaReceptor, setCondicionIvaReceptor] = useState<number>(
    CODIGO_RECEPTOR_CONSUMIDOR_FINAL,
  );
  const [seleccion, setSeleccion] = useState<Seleccion>({});
  const [preciosEditados, setPreciosEditados] = useState<PreciosEditados>({});
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([
      obtenerArticulos(),
      obtenerClientes(),
      obtenerListasPrecio(),
      obtenerPedidos(),
      obtenerConfigFiscal(),
    ])
      .then(([articulos, clientes, listas, pedidos, fiscal]) =>
        setCatalogos({
          productos: articulos.filter((a) => a.tipo === 'producto_terminado' && a.activo),
          clientes: clientes.filter((c) => c.activo),
          listas,
          pedidosListos: pedidos.filter((p) => p.estado === 'listo'),
          fiscal,
        }),
      )
      .catch((causa: unknown) =>
        setErrorCarga(causa instanceof Error ? causa.message : String(causa)),
      );
  }, []);

  /* ----------------------- Precio sugerido por cliente ---------------------- */

  const precioSugerido = useMemo(() => {
    const mapa = new Map<number, number>();
    if (catalogos === null) return mapa;

    const cliente = clienteId === '' ? undefined : catalogos.clientes.find((c) => c.id === clienteId);
    const listaCliente = catalogos.listas.find((l) => l.id === cliente?.listaPrecioId);
    const listaGeneral = catalogos.listas.find((l) => l.nombre === 'General');

    // El mas reciente vigente de la lista del cliente; si no hay, el de General.
    for (const lista of [listaGeneral, listaCliente]) {
      if (!lista) continue;
      const ultimoPorArticulo = new Map<number, { precio: number; desde: string }>();
      for (const precio of lista.precios) {
        const previo = ultimoPorArticulo.get(precio.articuloId);
        if (!previo || precio.vigenteDesde > previo.desde) {
          ultimoPorArticulo.set(precio.articuloId, { precio: precio.precio, desde: precio.vigenteDesde });
        }
      }
      // La lista del cliente pisa a la General (se procesa despues).
      for (const [articuloId, dato] of ultimoPorArticulo) mapa.set(articuloId, dato.precio);
    }
    return mapa;
  }, [catalogos, clienteId]);

  /** Precio efectivo en centavos: el editado a mano gana; si no, el sugerido. */
  const precioEfectivo = (articuloId: number): number => {
    const editado = preciosEditados[articuloId];
    if (editado !== undefined && editado.trim() !== '') {
      return aCentavos(Number(editado.replace(',', '.')));
    }
    return precioSugerido.get(articuloId) ?? 0;
  };

  /* ------------------------- Precarga desde un pedido ----------------------- */

  const elegirPedido = (id: number | ''): void => {
    setPedidoId(id);
    if (id === '' || catalogos === null) return;
    const pedido = catalogos.pedidosListos.find((p) => p.id === id);
    if (!pedido) return;
    setClienteId(pedido.clienteId ?? '');
    const nueva: Record<number, number> = {};
    for (const item of pedido.items) {
      const producto = catalogos.productos.find((a) => a.id === item.articuloId);
      const upc = producto?.unidadesPorCaja ?? null;
      // El pedido guarda unidades; la UI trabaja en cajas cuando corresponde.
      nueva[item.articuloId] = upc === null ? item.cantidad : Math.round(item.cantidad / upc);
    }
    setSeleccion(nueva);
  };

  /* --------------------------------- Derivados ------------------------------ */

  const items = useMemo(() => {
    if (catalogos === null) return [];
    return Object.entries(seleccion)
      .map(([id, elegido]) => {
        const articuloId = Number(id);
        const producto = catalogos.productos.find((a) => a.id === articuloId);
        const upc = producto?.unidadesPorCaja ?? null;
        const cantidad = upc === null ? elegido : elegido * upc;
        return { articuloId, cantidad, precioUnitario: precioEfectivo(articuloId) };
      })
      .filter((item) => item.cantidad > 0);
  }, [seleccion, catalogos, preciosEditados, precioSugerido]);

  const total = items.reduce(
    (suma, item) => suma + Math.round(item.precioUnitario * item.cantidad),
    0,
  );
  const clienteElegido =
    clienteId === '' ? undefined : catalogos?.clientes.find((c) => c.id === clienteId);
  const cuitCliente = (clienteElegido?.cuit ?? '').replace(/\D/g, '');
  /** Factura A: ARCA la rechaza sin CUIT de 11 digitos del receptor. */
  const faltaCuitParaA = comprobante === 'factura_a' && cuitCliente.length !== 11;

  const valido =
    items.length > 0 &&
    !(formaPago === 'cuenta_corriente' && clienteId === '') &&
    !faltaCuitParaA &&
    !guardando;

  const confirmar = (): void => {
    if (!valido) return;
    setGuardando(true);
    setError(null);
    const entrada: EntradaNuevaVenta = {
      clienteId: clienteId === '' ? null : clienteId,
      formaPago,
      pedidoId: pedidoId === '' ? null : pedidoId,
      notas: notas.trim() || null,
      comprobante,
      condicionIvaReceptor,
      items,
    };
    crearVenta(entrada)
      .then(alConfirmar)
      .catch((causa: unknown) => {
        setError(causa instanceof Error ? causa.message : String(causa));
        setGuardando(false);
      });
  };

  const campo =
    'h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';
  const rotulo = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-4" onMouseDown={alCerrar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nueva venta"
        onMouseDown={(evento) => evento.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-panel bg-white shadow-panel"
      >
        <div className="border-b border-masa-200 px-5 py-4">
          <h2 className="text-lg font-bold text-masa-900">Nueva venta</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {errorCarga !== null ? (
            <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
              {errorCarga}
            </p>
          ) : catalogos === null ? (
            <p className="py-8 text-center text-sm text-masa-700">Cargando catalogos...</p>
          ) : (
            <div className="space-y-4">
              {catalogos.pedidosListos.length > 0 && (
                <div>
                  <label htmlFor="v-pedido" className={rotulo}>Desde un pedido listo (opcional)</label>
                  <select
                    id="v-pedido"
                    value={pedidoId}
                    onChange={(e) => elegirPedido(e.target.value === '' ? '' : Number(e.target.value))}
                    className={campo}
                  >
                    <option value="">Venta suelta, sin pedido</option>
                    {catalogos.pedidosListos.map((p) => (
                      <option key={p.id} value={p.id}>
                        Pedido #{p.id} · {p.clienteNombre ?? 'Mostrador'} · {p.items.length} item(s)
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-masa-700">
                    Al confirmar la venta, el pedido queda entregado.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="v-cliente" className={rotulo}>Cliente</label>
                  <select
                    id="v-cliente"
                    value={clienteId}
                    onChange={(e) => setClienteId(e.target.value === '' ? '' : Number(e.target.value))}
                    className={campo}
                  >
                    <option value="">Mostrador / sin cliente</option>
                    {catalogos.clientes.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className={rotulo}>Forma de pago</span>
                  <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
                    {(
                      [
                        ['contado', 'Contado'],
                        ['cuenta_corriente', 'Cuenta corriente'],
                      ] as const
                    ).map(([clave, etiqueta]) => (
                      <button
                        key={clave}
                        type="button"
                        onClick={() => setFormaPago(clave)}
                        className={[
                          'flex-1 rounded-pastilla px-2 py-1.5 text-sm font-medium outline-none',
                          formaPago === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
                        ].join(' ')}
                      >
                        {etiqueta}
                      </button>
                    ))}
                  </div>
                  {formaPago === 'cuenta_corriente' && clienteId === '' && (
                    <p className="mt-1 text-xs text-peligro-600">La cuenta corriente necesita un cliente.</p>
                  )}
                </div>
              </div>

              <div>
                <span className={rotulo}>Comprobante</span>
                <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
                  {(
                    [
                      ['remito', 'Remito X'],
                      ['factura_b', 'Factura B'],
                      ['factura_a', 'Factura A'],
                    ] as const
                  ).map(([clave, etiqueta]) => {
                    const bloqueado = clave !== 'remito' && !catalogos.fiscal.habilitada;
                    return (
                      <button
                        key={clave}
                        type="button"
                        disabled={bloqueado}
                        title={bloqueado ? 'Configura ARCA en Gestion > Facturacion' : undefined}
                        onClick={() => setComprobante(clave)}
                        className={[
                          'flex-1 rounded-pastilla px-2 py-1.5 text-sm font-medium outline-none',
                          comprobante === clave
                            ? 'bg-dulce-600 text-white'
                            : 'text-masa-800 hover:bg-masa-100',
                          bloqueado ? 'cursor-not-allowed opacity-40 hover:bg-transparent' : '',
                        ].join(' ')}
                      >
                        {etiqueta}
                      </button>
                    );
                  })}
                </div>
                {!catalogos.fiscal.habilitada ? (
                  <p className="mt-1 text-xs text-masa-700">
                    Facturacion electronica sin configurar: por ahora solo remito interno.
                    Cargala en Gestion &gt; Facturacion.
                  </p>
                ) : comprobante === 'remito' ? (
                  <p className="mt-1 text-xs text-masa-700">
                    Documento interno de entrega: no se informa a ARCA.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-masa-700">
                    Al confirmar se pide el CAE a ARCA ({catalogos.fiscal.entorno}, punto de venta{' '}
                    {String(catalogos.fiscal.puntoVenta).padStart(5, '0')}). Si ARCA rechaza, la venta
                    no se registra.
                  </p>
                )}
                {faltaCuitParaA && (
                  <p className="mt-1 text-xs text-peligro-600">
                    La Factura A exige un cliente con CUIT valido. Elegi otro cliente, cargale el CUIT
                    o emiti Factura B.
                  </p>
                )}
              </div>

              {/* ARCA exige la condicion del receptor desde la RG 5616. En la
                  Factura A no se pregunta: solo la recibe un Responsable Inscripto. */}
              {comprobante === 'factura_b' && (
                <div>
                  <label htmlFor="v-cond-iva" className={rotulo}>
                    Condicion del cliente frente al IVA
                  </label>
                  <select
                    id="v-cond-iva"
                    value={condicionIvaReceptor}
                    onChange={(e) => setCondicionIvaReceptor(Number(e.target.value))}
                    className={campo}
                  >
                    {CONDICIONES_IVA_RECEPTOR.map((c) => (
                      <option key={c.codigo} value={c.codigo}>
                        {c.etiqueta}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-masa-700">
                    ARCA la exige en el comprobante. Si el cliente no aclara nada, va Consumidor Final.
                  </p>
                </div>
              )}

              <div>
                <p className={rotulo}>Productos · cantidades en cajas</p>
                <div className="overflow-hidden rounded-ficha border border-masa-200">
                  {catalogos.productos.map((producto, indice) => {
                    const cajas = seleccion[producto.id] ?? 0;
                    const upc = producto.unidadesPorCaja;
                    const sugerido = precioSugerido.get(producto.id);
                    return (
                      <div
                        key={producto.id}
                        className={[
                          'flex items-center gap-3 px-3 py-2',
                          indice > 0 ? 'border-t border-masa-100' : '',
                        ].join(' ')}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-masa-900">{producto.nombre}</p>
                          <p className="text-xs text-masa-700">
                            Stock: {formatearCajas(producto.stock, upc)}
                            {upc !== null && cajas > 0 ? ` · vendes ${cajas * upc} u` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label={`Sacar ${producto.nombre}`}
                            onClick={() => setSeleccion((s) => ({ ...s, [producto.id]: Math.max(cajas - 1, 0) }))}
                            disabled={cajas === 0}
                            className="h-9 w-9 rounded-ficha border border-masa-300 bg-masa-50 font-bold text-masa-900 disabled:opacity-30"
                          >
                            −
                          </button>
                          <span className="w-10 text-center font-mono text-base font-bold tabular-nums text-masa-900">
                            {cajas}
                          </span>
                          <button
                            type="button"
                            aria-label={`Agregar ${producto.nombre}`}
                            onClick={() => setSeleccion((s) => ({ ...s, [producto.id]: cajas + 1 }))}
                            className="h-9 w-9 rounded-ficha border border-dulce-400 bg-dulce-500 font-bold text-white"
                          >
                            +
                          </button>
                        </div>
                        <div className="w-28 shrink-0">
                          <input
                            aria-label={`Precio unitario de ${producto.nombre}`}
                            value={preciosEditados[producto.id] ?? (sugerido !== undefined ? String(sugerido / 100) : '')}
                            onChange={(e) =>
                              setPreciosEditados((p) => ({ ...p, [producto.id]: e.target.value }))
                            }
                            inputMode="decimal"
                            placeholder="$/u"
                            className="h-9 w-full rounded-ficha border border-masa-300 bg-white px-2 text-right font-mono text-sm tabular-nums text-masa-900"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-1 text-xs text-masa-700">
                  El precio por unidad sale de la lista del cliente (o General) y se puede corregir.
                </p>
              </div>

              <div>
                <label htmlFor="v-notas" className={rotulo}>Notas</label>
                <input id="v-notas" value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} className={campo} />
              </div>

              {error !== null && (
                <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-masa-200 bg-masa-50 px-5 py-3">
          <div>
            <p className="font-mono text-lg font-bold tabular-nums text-masa-900">
              Total: {formatearMoneda(total)}
            </p>
            {comprobante !== 'remito' && total > 0 && (
              <p className="font-mono text-xs tabular-nums text-masa-700">
                Neto {formatearMoneda(Math.round(total / 1.21))} + IVA 21%{' '}
                {formatearMoneda(total - Math.round(total / 1.21))}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={alCerrar}
              className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-dulce-400"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={!valido}
              className="rounded-ficha bg-dulce-600 px-5 py-2 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300 disabled:text-masa-700"
            >
              {guardando
                ? comprobante === 'remito'
                  ? 'Registrando...'
                  : 'Pidiendo CAE a ARCA...'
                : comprobante === 'remito'
                  ? 'Confirmar venta'
                  : 'Facturar y registrar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
