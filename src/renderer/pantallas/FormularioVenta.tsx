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
 *  5. En contado se elige CON QUE se cobra: un solo medio (default) o pago
 *     mixto, con una fila fija por medio activo. La suma debe dar EXACTAMENTE
 *     el total, sin vuelto; el cheque recibido entra solo a la cartera.
 *  6. Confirmar registra todo en una transaccion: stock, cuenta corriente o
 *     caja, y el pedido si corresponde.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  CODIGO_RECEPTOR_CONSUMIDOR_FINAL,
  CONDICIONES_IVA_RECEPTOR,
  type VendedorVista,
} from '../../compartido/contratos';
import type {
  ArticuloConStock,
  ClienteVista,
  ConfiguracionFiscalVista,
  EntradaNuevaVenta,
  FormaPago,
  FormatoCheque,
  ListaPrecioVista,
  MedioPagoVista,
  PagoVentaEntrada,
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
  obtenerMediosPago,
  obtenerPedidos,
  obtenerVendedores,
} from '../servicios/cliente';
import { aCentavos, formatearCajas, formatearMoneda, pendienteDeItem } from '../utiles/formato';

/** Cantidades elegidas por articulo, EN CAJAS (o unidades si no tiene caja). */
type Seleccion = Readonly<Record<number, number>>;
/** Precios editados por articulo, en PESOS como texto (se convierte al enviar). */
type PreciosEditados = Readonly<Record<number, string>>;

interface Catalogos {
  productos: ArticuloConStock[];
  clientes: ClienteVista[];
  listas: ListaPrecioVista[];
  pedidosListos: PedidoVista[];
  vendedores: VendedorVista[];
  fiscal: ConfiguracionFiscalVista;
  /** Solo los activos, ya ordenados por `orden` desde el servidor. */
  mediosPago: MedioPagoVista[];
}

export function FormularioVenta({
  alCerrar,
  alConfirmar,
  pedidoInicial = null,
}: {
  readonly alCerrar: () => void;
  readonly alConfirmar: (resultado: ResultadoVenta) => void;
  /** Si viene, la venta abre YA cargada con ese pedido: es el boton Vender. */
  readonly pedidoInicial?: number | null;
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
  /*
   * Lo pendiente exacto del pedido en unidades, y las cajas que se le mostraron
   * al operador. Con los dos se sabe que renglon no toco, y ese se factura por
   * su cantidad EXACTA: la venta solo sabia operar en cajas enteras, asi que un
   * pedido con unidades sueltas —una caja surtida, el resto de una entrega
   * parcial— no se podia facturar nunca y sus reservas quedaban retenidas.
   */
  const [pendientesExactos, setPendientesExactos] = useState<Seleccion>({});
  const [seleccionInicial, setSeleccionInicial] = useState<Seleccion>({});
  const [preciosEditados, setPreciosEditados] = useState<PreciosEditados>({});
  const [restoPedido, setRestoPedido] = useState<'liberar' | 'mantener'>('mantener');
  // A quien se le factura el pedido de un revendedor: al cliente final (lo
  // normal) o al propio vendedor, que usa SU ficha de cliente como receptora.
  const [receptor, setReceptor] = useState<'cliente' | 'vendedor'>('cliente');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  // Pagos de la venta de contado, copiado del PDV de StockFlow: dos modos
  // EXCLUYENTES. Unico (default): un medio cobra el total. Mixto: una fila
  // fija por medio activo. El split guarda TEXTO en pesos por medio; los
  // centavos se derivan en cada render contra el total vigente, asi los
  // indicadores siguen al total si el operador toca cantidades despues.
  const [medioPagoId, setMedioPagoId] = useState<number | ''>('');
  const [modoMixto, setModoMixto] = useState(false);
  const [montosMixtos, setMontosMixtos] = useState<Readonly<Record<number, string>>>({});
  // Datos del cheque recibido. El alta en la cartera la hace el servidor con
  // la venta; aca solo se juntan los datos obligatorios.
  const [chequeNumero, setChequeNumero] = useState('');
  const [chequeBanco, setChequeBanco] = useState('');
  const [chequeFecha, setChequeFecha] = useState('');
  const [chequeFormato, setChequeFormato] = useState<FormatoCheque>('fisico');

  useEffect(() => {
    Promise.all([
      obtenerArticulos(),
      obtenerClientes(),
      obtenerListasPrecio(),
      obtenerPedidos(),
      obtenerConfigFiscal(),
      obtenerMediosPago(),
      obtenerVendedores(),
    ])
      .then(([articulos, clientes, listas, pedidos, fiscal, medios, vendedores]) => {
        const mediosPago = medios.filter((m) => m.activo);
        setCatalogos({
          productos: articulos.filter((a) => a.tipo === 'producto_terminado' && a.activo),
          clientes: clientes.filter((c) => c.activo),
          listas,
          // Vendible: listo, o con ALGO apartado (venta parcial de un pedido
          // todavia en produccion, desde Gestion de pedidos).
          pedidosListos: pedidos.filter(
            (p) => p.estado === 'listo' || p.items.some((i) => i.reservado > 0),
          ),
          vendedores: vendedores.filter((v) => v.activo),
          fiscal,
          mediosPago,
        });
        // Preseleccion del modo unico: el efectivo fisico, si no el primero.
        const porDefecto = mediosPago.find((m) => m.esEfectivoFisico) ?? mediosPago[0];
        setMedioPagoId(porDefecto?.id ?? '');
      })
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
    // Si la venta sale de un pedido con lista elegida, ESA lista manda: es la
    // que se pacto al tomar el pedido (aunque despues se facture al vendedor).
    const pedidoElegido =
      pedidoId === '' ? undefined : catalogos.pedidosListos.find((p) => p.id === pedidoId);
    const listaPedido = catalogos.listas.find((l) => l.id === pedidoElegido?.listaPrecioId);

    /*
     * Una lista DERIVADA ("Lista 1 + 20%") no tiene ni una fila propia en
     * `precios`: su precio es el de la lista base con el recargo aplicado.
     * Como aca solo se miraba `lista.precios`, para un cliente en una lista
     * derivada el mapa quedaba vacio y todos los renglones salian en $0.
     */
    const conRecargo: { lista: ListaPrecioVista | undefined; factor: number }[] = [];
    for (const lista of [listaGeneral, listaCliente, listaPedido]) {
      if (!lista) {
        conRecargo.push({ lista: undefined, factor: 1 });
        continue;
      }
      if (lista.baseListaId !== null && lista.recargoPct !== null) {
        conRecargo.push({
          lista: catalogos.listas.find((l) => l.id === lista.baseListaId),
          factor: 1 + lista.recargoPct / 100,
        });
      } else {
        conRecargo.push({ lista, factor: 1 });
      }
    }

    // El mas reciente vigente; el orden hace que la mas especifica pise.
    for (const { lista, factor } of conRecargo) {
      if (!lista) continue;
      const ultimoPorArticulo = new Map<number, { precio: number; desde: string; id: number }>();
      for (const precio of lista.precios) {
        const previo = ultimoPorArticulo.get(precio.articuloId);
        // Con la misma fecha gana el de id mayor: dos precios cargados el mismo
        // dia dejaban ganar al primero, o sea al VIEJO, y se cobraba de menos
        // para siempre.
        const gana =
          !previo || precio.vigenteDesde > previo.desde ||
          (precio.vigenteDesde === previo.desde && precio.id > previo.id);
        if (gana) {
          ultimoPorArticulo.set(precio.articuloId, {
            precio: precio.precio,
            desde: precio.vigenteDesde,
            id: precio.id,
          });
        }
      }
      // La lista del cliente pisa a la General (se procesa despues).
      for (const [articuloId, dato] of ultimoPorArticulo) {
        mapa.set(articuloId, Math.round(dato.precio * factor));
      }
    }
    return mapa;
  }, [catalogos, clienteId, pedidoId]);

  /**
   * Precio efectivo en centavos: el editado a mano gana; si no, el sugerido.
   * Devuelve null cuando NO hay precio, en vez de 0: un cero se confundia con
   * "es gratis" y la venta se cerraba a $0 sin que nadie lo notara.
   */
  const precioEfectivoONulo = (articuloId: number): number | null => {
    const editado = preciosEditados[articuloId];
    if (editado !== undefined && editado.trim() !== '') {
      return aCentavos(Number(editado.replace(',', '.')));
    }
    return precioSugerido.get(articuloId) ?? null;
  };

  const precioEfectivo = (articuloId: number): number => precioEfectivoONulo(articuloId) ?? 0;

  /** Articulos elegidos que todavia no tienen precio: bloquean la venta. */
  const sinPrecio = (): number[] =>
    Object.entries(seleccion)
      .filter(([, cantidad]) => Number(cantidad) > 0)
      .map(([id]) => Number(id))
      .filter((id) => precioEfectivoONulo(id) === null);

  /* ------------------------- Precarga desde un pedido ----------------------- */

  const elegirPedido = (id: number | ''): void => {
    setPedidoId(id);
    setReceptor('cliente');
    if (id === '' || catalogos === null) return;
    const pedido = catalogos.pedidosListos.find((p) => p.id === id);
    if (!pedido) return;
    setClienteId(pedido.clienteId ?? '');
    const nueva: Record<number, number> = {};
    const exactas: Record<number, number> = {};
    for (const item of pedido.items) {
      const producto = catalogos.productos.find((a) => a.id === item.articuloId);
      const upc = producto?.unidadesPorCaja ?? null;
      // Se precarga lo APARTADO, no lo pedido: tras una entrega parcial el
      // pedido sigue diciendo 50 pero el saldo real del cliente son las 16
      // reservadas. En un pedido recien listo, ambas cifras coinciden.
      const pendiente = pendienteDeItem(item);
      // floor, no round: si quedan 16 u con cajas de 12, se precarga 1 caja y
      // las 4 sueltas quedan a la vista como "sin llevar" — redondear a 2
      // cajas vendia mercaderia apartada para OTRO pedido y cobraba de mas.
      nueva[item.articuloId] = upc === null ? pendiente : Math.floor(pendiente / upc);
      // Lo pendiente EXACTO en unidades, para poder facturarlo completo.
      exactas[item.articuloId] = pendiente;
    }
    setSeleccion(nueva);
    setPendientesExactos(exactas);
    setSeleccionInicial(nueva);
  };

  // El boton "Vender" del pedido entra con el pedido ya elegido.
  useEffect(() => {
    if (pedidoInicial !== null && catalogos !== null) elegirPedido(pedidoInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogos, pedidoInicial]);

  /* --------------------------------- Derivados ------------------------------ */

  const items = useMemo(() => {
    if (catalogos === null) return [];
    return Object.entries(seleccion)
      .map(([id, elegido]) => {
        const articuloId = Number(id);
        const producto = catalogos.productos.find((a) => a.id === articuloId);
        const upc = producto?.unidadesPorCaja ?? null;
        const exacto = pendientesExactos[articuloId];
        const sinTocar = seleccionInicial[articuloId] === elegido;
        const cantidad =
          exacto !== undefined && sinTocar ? exacto : upc === null ? elegido : elegido * upc;
        return { articuloId, cantidad, precioUnitario: precioEfectivo(articuloId) };
      })
      .filter((item) => item.cantidad > 0);
  }, [seleccion, catalogos, preciosEditados, precioSugerido]);

  const total = items.reduce(
    (suma, item) => suma + Math.round(item.precioUnitario * item.cantidad),
    0,
  );

  /* --------------------------- Pagos de contado ----------------------------- */

  const mediosActivos = catalogos?.mediosPago ?? [];
  const medioElegido = mediosActivos.find((m) => m.id === medioPagoId);
  /** Destino del atajo "Todo en Efectivo": el fisico, o el primero si no hay. */
  const medioFisico = mediosActivos.find((m) => m.esEfectivoFisico) ?? mediosActivos[0];

  /** Pesos escritos a centavos. Vacio, invalido o negativo cuentan como 0. */
  const centavosDeTexto = (texto: string | undefined): number => {
    if (texto === undefined || texto.trim() === '') return 0;
    const pesos = Number(texto.replace(',', '.'));
    return Number.isFinite(pesos) && pesos > 0 ? aCentavos(pesos) : 0;
  };

  // Suma del split contra el TOTAL VIGENTE: el total puede moverse despues de
  // cargados los montos (el operador toca cantidades) y el semaforo lo sigue.
  const sumaMixta = mediosActivos.reduce(
    (suma, m) => suma + centavosDeTexto(montosMixtos[m.id]),
    0,
  );

  /** Pagos con importe > 0 que saldrian con la venta, segun el modo vigente. */
  const pagosVigentes: { medio: MedioPagoVista; importe: number }[] =
    formaPago !== 'contado'
      ? []
      : modoMixto
        ? mediosActivos
            .map((medio) => ({ medio, importe: centavosDeTexto(montosMixtos[medio.id]) }))
            .filter((pago) => pago.importe > 0)
        : medioElegido !== undefined && total > 0
          ? [{ medio: medioElegido, importe: total }]
          : [];

  const hayCheque = pagosVigentes.some((pago) => pago.medio.tipo === 'cheque');
  /** Sin numero y fecha el servidor no puede dar de alta el cheque: se frena aca. */
  const chequeCompleto = !hayCheque || (chequeNumero.trim() !== '' && chequeFecha !== '');

  // round(importe * pct / 100) por pago, igual que StockFlow. Es informativo
  // para el vendedor: el cliente paga el total integro, la absorbe el comercio.
  const comisionTotal = pagosVigentes.reduce(
    (suma, pago) =>
      suma + (pago.medio.comisionPct > 0 ? Math.round((pago.importe * pago.medio.comisionPct) / 100) : 0),
    0,
  );

  /** Atajo del split: pone en el medio fisico lo que falta despues de los demas. */
  const todoEnEfectivo = (): void => {
    const fisico = medioFisico;
    if (fisico === undefined) return;
    setMontosMixtos((previos) => {
      const deLosDemas = mediosActivos
        .filter((m) => m.id !== fisico.id)
        .reduce((suma, m) => suma + centavosDeTexto(previos[m.id]), 0);
      const restante = Math.max(0, total - deLosDemas);
      return { ...previos, [fisico.id]: String(restante / 100) };
    });
  };

  /** Unidades que el pedido tiene apartadas y esta venta NO se lleva. */
  const restoSinLlevar = useMemo(() => {
    if (pedidoId === '' || catalogos === null) return 0;
    const pedido = catalogos.pedidosListos.find((p) => p.id === pedidoId);
    if (!pedido) return 0;
    let resto = 0;
    for (const item of pedido.items) {
      const pendiente = pendienteDeItem(item);
      const vendida = items.find((v) => v.articuloId === item.articuloId)?.cantidad ?? 0;
      resto += Math.max(0, pendiente - vendida);
    }
    return resto;
  }, [pedidoId, catalogos, items]);
  const clienteElegido =
    clienteId === '' ? undefined : catalogos?.clientes.find((c) => c.id === clienteId);
  const cuitCliente = (clienteElegido?.cuit ?? '').replace(/\D/g, '');
  /** Factura A: ARCA la rechaza sin CUIT de 11 digitos del receptor. */
  const faltaCuitParaA = comprobante === 'factura_a' && cuitCliente.length !== 11;

  // En mixto la suma tiene que ser EXACTA (regla dura del servidor, sin
  // vuelto); en unico siempre cierra porque el medio cobra el total. Sin
  // medios cargados no se manda `pagos` y el servidor asume Efectivo.
  const pagoContadoValido =
    formaPago !== 'contado' ||
    mediosActivos.length === 0 ||
    (modoMixto ? sumaMixta === total : medioElegido !== undefined);

  // Renglones sin precio en la lista del cliente: frenan la venta antes de
  // llegar al servidor, y se nombran para que el operador sepa cual cargar.
  const articulosSinPrecio = sinPrecio();
  const nombresSinPrecio = articulosSinPrecio
    .map((id) => catalogos?.productos.find((a) => a.id === id)?.nombre ?? `#${id}`)
    .join(', ');

  const valido =
    items.length > 0 &&
    articulosSinPrecio.length === 0 &&
    !(formaPago === 'cuenta_corriente' && clienteId === '') &&
    !faltaCuitParaA &&
    pagoContadoValido &&
    chequeCompleto &&
    !guardando;

  const confirmar = (): void => {
    if (!valido) return;
    setGuardando(true);
    setError(null);
    // Los pagos viajan SOLO en la venta de contado; en cuenta corriente no hay
    // cobro que registrar. El medio de tipo cheque lleva los datos del cheque:
    // con eso el servidor lo da de alta en la cartera en la misma transaccion.
    const pagos: PagoVentaEntrada[] = pagosVigentes.map((pago) => ({
      medioPagoId: pago.medio.id,
      importe: pago.importe,
      ...(pago.medio.tipo === 'cheque'
        ? {
            cheque: {
              numero: chequeNumero.trim(),
              banco: chequeBanco.trim() === '' ? null : chequeBanco.trim(),
              fechaPago: chequeFecha,
              formato: chequeFormato,
            },
          }
        : {}),
    }));
    const entrada: EntradaNuevaVenta = {
      clienteId: clienteId === '' ? null : clienteId,
      formaPago,
      pedidoId: pedidoId === '' ? null : pedidoId,
      restoPedido: pedidoId === '' || restoSinLlevar <= 0 ? null : restoPedido,
      ...(formaPago === 'contado' && pagos.length > 0 ? { pagos } : {}),
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
  const campoChico =
    'h-9 w-full rounded-ficha border border-masa-300 bg-white px-2 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';
  const rotulo = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-4"
      onMouseDown={() => {
        // Mismo criterio que el boton: con una venta en vuelo no se cierra.
        if (!guardando) alCerrar();
      }}
    >
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
          {/* Sin precio la venta no sale: se dice cual falta y donde cargarlo,
              en vez de dejarlo pasar en $0 como hacia antes. */}
          {articulosSinPrecio.length > 0 && (
            <p
              role="alert"
              className="mb-3 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-700"
            >
              Sin precio en la lista de este cliente: <strong>{nombresSinPrecio}</strong>. Cargalo en
              Listas de precio o sacalo de la venta.
            </p>
          )}
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
                    Se precarga lo apartado para el cliente. Podes bajar cantidades si se lleva menos.
                  </p>
                </div>
              )}

              {/* Pedido traido por un revendedor: se elige a quien facturar.
                  Por defecto al cliente final; al vendedor solo si tiene su
                  ficha de cliente vinculada (CUIT, condicion de IVA, cuenta). */}
              {(() => {
                const pedidoElegido =
                  pedidoId === '' ? undefined : catalogos.pedidosListos.find((p) => p.id === pedidoId);
                if (pedidoElegido === undefined || pedidoElegido.vendedorId === null) return null;
                const vendedor = catalogos.vendedores.find((v) => v.id === pedidoElegido.vendedorId);
                if (vendedor === undefined) return null;
                const clienteDelVendedor =
                  vendedor.clienteId === null
                    ? undefined
                    : catalogos.clientes.find((c) => c.id === vendedor.clienteId);
                const elegirReceptor = (valor: 'cliente' | 'vendedor'): void => {
                  setReceptor(valor);
                  if (valor === 'vendedor' && clienteDelVendedor !== undefined) {
                    setClienteId(clienteDelVendedor.id);
                  } else {
                    setClienteId(pedidoElegido.clienteId ?? '');
                  }
                };
                return (
                  <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
                    <p className="text-sm font-semibold text-masa-900">
                      Pedido traido por {vendedor.nombre}. ¿A quien se le factura?
                    </p>
                    <div className="mt-2 flex flex-col gap-1.5">
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-masa-900">
                        <input
                          type="radio"
                          name="receptor-factura"
                          checked={receptor === 'cliente'}
                          onChange={() => elegirReceptor('cliente')}
                          className="mt-0.5 accent-dulce-600"
                        />
                        Al cliente final ({pedidoElegido.clienteNombre ?? 'Mostrador'})
                      </label>
                      <label
                        className={[
                          'flex items-start gap-2 text-sm text-masa-900',
                          clienteDelVendedor === undefined ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                        ].join(' ')}
                      >
                        <input
                          type="radio"
                          name="receptor-factura"
                          disabled={clienteDelVendedor === undefined}
                          checked={receptor === 'vendedor'}
                          onChange={() => elegirReceptor('vendedor')}
                          className="mt-0.5 accent-dulce-600"
                        />
                        <span>
                          Al vendedor ({vendedor.nombre})
                          {clienteDelVendedor === undefined && (
                            <span className="block text-xs text-alerta-700">
                              Necesita su ficha de cliente vinculada (con CUIT): se hace en Comercial → Vendedores.
                            </span>
                          )}
                        </span>
                      </label>
                    </div>
                  </div>
                );
              })()}

              {/* Entrega parcial: el destino del resto lo decide el que atiende,
                  porque "no lo quiero mas" y "lo busco el jueves" son negocios
                  distintos: uno libera el stock, el otro lo sigue apartando. */}
              {restoSinLlevar > 0 && (
                <div className="rounded-ficha border border-alerta-300 bg-alerta-50 px-3 py-2">
                  <p className="text-sm font-semibold text-masa-900">
                    El cliente deja {restoSinLlevar} u sin llevar. ¿Que hacemos con eso?
                  </p>
                  <div className="mt-2 flex flex-col gap-1.5">
                    {(
                      [
                        ['mantener', 'Lo retira despues: sigue apartado y el pedido queda listo con el saldo'],
                        ['liberar', 'No lo quiere mas: vuelve al stock disponible y el pedido se cierra'],
                      ] as const
                    ).map(([clave, etiqueta]) => (
                      <label key={clave} className="flex cursor-pointer items-start gap-2 text-sm text-masa-900">
                        <input
                          type="radio"
                          name="resto-pedido"
                          checked={restoPedido === clave}
                          onChange={() => setRestoPedido(clave)}
                          className="mt-0.5 accent-dulce-600"
                        />
                        {etiqueta}
                      </label>
                    ))}
                  </div>
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
                  {(() => {
                    const cliente =
                      clienteId === '' ? undefined : catalogos.clientes.find((c) => c.id === clienteId);
                    if (cliente === undefined) return null;
                    return (
                      <p className="mt-1 text-xs text-masa-700">
                        {cliente.cuit !== null ? `CUIT ${cliente.cuit} · ` : 'Sin CUIT cargado · '}
                        Saldo en cuenta corriente: {formatearMoneda(cliente.saldoCc)}
                      </p>
                    );
                  })()}
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

              {/* Con que se cobra: solo en contado (la cuenta corriente no lleva
                  pagos). Dos modos excluyentes, como el PDV de StockFlow. */}
              {formaPago === 'contado' && mediosActivos.length > 0 && (
                <div className="space-y-3">
                  {modoMixto ? (
                    <div>
                      <div className="flex items-center justify-between">
                        <span className={rotulo}>Pago mixto</span>
                        <button
                          type="button"
                          onClick={() => {
                            setModoMixto(false);
                            setMontosMixtos({});
                          }}
                          className="rounded-ficha px-2 py-1 text-xs font-medium text-dulce-700 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
                        >
                          Volver a pago unico
                        </button>
                      </div>
                      <div className="overflow-hidden rounded-ficha border border-masa-200">
                        {mediosActivos.map((medio, indice) => (
                          <div
                            key={medio.id}
                            className={[
                              'flex items-center justify-between gap-3 px-3 py-2',
                              indice > 0 ? 'border-t border-masa-100' : '',
                            ].join(' ')}
                          >
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-masa-900">
                              {medio.nombre}
                            </span>
                            <input
                              aria-label={`Importe en ${medio.nombre}`}
                              value={montosMixtos[medio.id] ?? ''}
                              onChange={(e) =>
                                setMontosMixtos((previos) => ({ ...previos, [medio.id]: e.target.value }))
                              }
                              inputMode="decimal"
                              placeholder="0"
                              className="h-9 w-28 shrink-0 rounded-ficha border border-masa-300 bg-white px-2 text-right font-mono text-sm tabular-nums text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        {medioFisico !== undefined && (
                          <button
                            type="button"
                            onClick={todoEnEfectivo}
                            className="rounded-ficha border border-masa-300 px-2.5 py-1 text-xs font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
                          >
                            Todo en Efectivo
                          </button>
                        )}
                        <span className="ml-auto text-right text-xs font-medium">
                          {sumaMixta > total ? (
                            <span className="text-peligro-600">Excede el total. Ajusta los montos.</span>
                          ) : sumaMixta < total ? (
                            <span className="text-peligro-600">
                              Restante a cobrar: {formatearMoneda(total - sumaMixta)}
                            </span>
                          ) : total > 0 ? (
                            <span className="text-menta-700">Pagos completos</span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="v-medio-pago" className={rotulo}>Medio de pago</label>
                      <div className="flex items-center gap-2">
                        <select
                          id="v-medio-pago"
                          value={medioPagoId}
                          onChange={(e) => setMedioPagoId(e.target.value === '' ? '' : Number(e.target.value))}
                          className={campo}
                        >
                          {mediosActivos.map((m) => (
                            <option key={m.id} value={m.id}>{m.nombre}</option>
                          ))}
                        </select>
                        {mediosActivos.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setModoMixto(true)}
                            className="h-10 shrink-0 rounded-ficha border border-masa-300 px-3 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
                          >
                            Pago mixto
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {hayCheque && (
                    <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2.5">
                      <p className="text-xs font-semibold uppercase tracking-wide text-masa-700">
                        Datos del cheque
                      </p>
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="v-cheque-numero" className={rotulo}>Numero de cheque</label>
                          <input
                            id="v-cheque-numero"
                            value={chequeNumero}
                            onChange={(e) => setChequeNumero(e.target.value)}
                            className={campoChico}
                          />
                        </div>
                        <div>
                          <label htmlFor="v-cheque-banco" className={rotulo}>Banco (opcional)</label>
                          <input
                            id="v-cheque-banco"
                            value={chequeBanco}
                            onChange={(e) => setChequeBanco(e.target.value)}
                            className={campoChico}
                          />
                        </div>
                        <div>
                          <label htmlFor="v-cheque-fecha" className={rotulo}>Fecha de cobro</label>
                          <input
                            id="v-cheque-fecha"
                            type="date"
                            value={chequeFecha}
                            onChange={(e) => setChequeFecha(e.target.value)}
                            className={campoChico}
                          />
                        </div>
                        <div>
                          <span className={rotulo}>Formato</span>
                          <div className="flex h-9 gap-1 rounded-ficha border border-masa-200 bg-white p-1">
                            {(
                              [
                                ['fisico', 'Fisico'],
                                ['echeq', 'ECHEQ'],
                              ] as const
                            ).map(([clave, etiqueta]) => (
                              <button
                                key={clave}
                                type="button"
                                onClick={() => setChequeFormato(clave)}
                                className={[
                                  'flex-1 rounded-pastilla px-2 text-xs font-medium outline-none',
                                  chequeFormato === clave
                                    ? 'bg-dulce-600 text-white'
                                    : 'text-masa-800 hover:bg-masa-100',
                                ].join(' ')}
                              >
                                {etiqueta}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-2 text-xs text-masa-700">
                        El cheque entra solo a la cartera (Tesoreria → Cheques) a nombre del cliente.
                      </p>
                      {!chequeCompleto && (
                        <p className="mt-1 text-xs text-peligro-600">
                          Falta el numero de cheque o la fecha de cobro: sin eso no se puede
                          confirmar la venta.
                        </p>
                      )}
                    </div>
                  )}

                  {comisionTotal > 0 && (
                    <div className="rounded-ficha border border-alerta-300 bg-alerta-50 px-3 py-2">
                      <div className="flex items-center justify-between text-xs text-masa-900">
                        <span>Comision del medio de pago</span>
                        <span className="font-mono tabular-nums">- {formatearMoneda(comisionTotal)}</span>
                      </div>
                      <div className="mt-0.5 flex items-center justify-between text-xs font-semibold text-masa-900">
                        <span>Neto que entra</span>
                        <span className="font-mono tabular-nums">{formatearMoneda(total - comisionTotal)}</span>
                      </div>
                      <p className="mt-1 text-xs text-masa-700">
                        El cliente paga el total; la comision la absorbe el comercio.
                      </p>
                    </div>
                  )}
                </div>
              )}

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
                {/* El dueño pidio poder facturar una parte del pedido y remitir
                    la otra: el circuito son dos ventas sobre el mismo pedido, y
                    esta linea lo explica donde se elige el comprobante. */}
                {pedidoId !== '' && (
                  <p className="mt-1 text-xs text-masa-700">
                    Podes facturar una parte y hacer remito del resto: carga esta venta con lo que
                    va facturado, elegi que el resto quede apartado, y volve a Vender para hacerle
                    el remito.
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
{/*
              Con una venta en vuelo, Cancelar NO cierra. Antes desmontaba el
              modal mientras la peticion seguia: si ARCA tardaba y despues
              rechazaba —CUIT mal cargado, certificado vencido— el error se
              perdia con el componente y el operador nunca se enteraba de si la
              factura habia salido o no.
            */}
            <button
              type="button"
              onClick={alCerrar}
              disabled={guardando}
              title={guardando ? 'Esperando la respuesta de ARCA: no se puede cancelar ahora.' : undefined}
              className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:opacity-40"
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
