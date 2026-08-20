/**
 * PWA de carga de pedidos — la pantalla del celular del dueño.
 *
 * Principios:
 *  - Captura ESTRUCTURADA: cliente y productos salen de dropdowns poblados
 *    desde la base. Nada de texto libre que despues alguien tenga que
 *    interpretar en la fabrica.
 *  - Dedos, no punteros: filas altas, botones grandes, stepper de cantidad.
 *  - La red es opcional: sin conexion el pedido va a la cola local y sale solo
 *    cuando vuelve el servidor. El dueño nunca pierde un pedido.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  ArticuloConStock,
  EntradaNuevoPedido,
  PresentacionVista,
} from '../../compartido/contratos';
import {
  enviarPedido,
  ErrorPinRequerido,
  guardarPin,
  leerNombre,
  leerPin,
  obtenerCatalogo,
  type Catalogo,
} from './api';
import { encolar, pendientes, sincronizar } from './cola';

/**
 * Cantidades elegidas por articulo, EN CAJAS para los productos que se venden
 * por caja cerrada (los clientes piden asi) y en unidades para el resto.
 * Al enviar se convierte todo a unidad base: el servidor no sabe de cajas.
 */
type Seleccion = Readonly<Record<number, number>>;

/** El cliente es obligatorio elegirlo (aunque sea "mostrador") antes de cargar. */
type ClienteElegido = number | 'mostrador' | '';

/* ----------------------- Talonario movil (Anyulin) ------------------------- */
// Mismas reglas que el talonario del escritorio (FormulariosOperacion), en
// version dedo: producto -> presentacion -> unidades por variedad que llenan
// la caja + cantidad de cajas. Si la mezcla coincide con el catalogo se
// reconoce; si no, viaja armada a medida con su receta.

const VARIEDADES_ALFAJOR = [
  { codigo: 'ALF-B', etiqueta: 'BLANCO' },
  { codigo: 'ALF-N', etiqueta: 'NEGRO' },
  { codigo: 'ALF-FB', etiqueta: 'FRUT. BLANCO' },
  { codigo: 'ALF-FN', etiqueta: 'FRUT. NEGRO' },
] as const;
const TIPOS_ALFAJOR = [
  { prefijo: 'CAJA', etiqueta: 'Caja x36', unidades: 36 },
  { prefijo: 'DOC', etiqueta: 'Docena', unidades: 12 },
  { prefijo: 'BOL', etiqueta: 'Bolsa x6', unidades: 6 },
  { prefijo: 'UNI', etiqueta: 'Unidad suelta', unidades: 1 },
] as const;
const VARIEDADES_ALMENDRA = [
  { codigo: 'ALM-CL', etiqueta: 'C/LECHE' },
  { codigo: 'ALM-B', etiqueta: 'BLANCO' },
  { codigo: 'ALM-SA', etiqueta: 'SEMIAMARGO' },
] as const;
const VARIEDADES_CUBANITO = [
  { codigo: 'CUB-DDL', etiqueta: 'D. LECHE' },
  { codigo: 'CUB-FRU', etiqueta: 'FRUTILLA' },
  { codigo: 'CUB-MANI', etiqueta: 'MANI' },
  { codigo: 'CUB-AVE', etiqueta: 'AVELLANA' },
  { codigo: 'CUB-BAN', etiqueta: 'BANANITA' },
] as const;
const TIPOS_CUBANITO = [
  { sel: 'CUB10', codigoPres: 'CAJA-CUB-10', etiqueta: 'Caja x10', unidades: 10 },
  { sel: 'CUB16', codigoPres: 'CAJA-CUB-16', etiqueta: 'Caja x16', unidades: 16 },
] as const;
const PRODUCTOS_TALONARIO = [
  { valor: 'ALFAJORES', etiqueta: 'ALFAJORES' },
  { valor: 'ALMENDRAS', etiqueta: 'ALMENDRAS' },
  { valor: 'CUBANITOS', etiqueta: 'CUBANITOS' },
  { valor: 'ANYULIN', etiqueta: 'CAJA ANYULIN' },
] as const;
type ProductoTalonario = (typeof PRODUCTOS_TALONARIO)[number]['valor'];

interface RenglonMovil {
  clave: string;
  presentacionId: number | null;
  descripcion: string | null;
  etiqueta: string;
  cantidad: number;
  unidades: number;
  componentes: { articuloId: number; unidades: number }[];
}

const MS_REINTENTO_COLA = 30_000;

export function AppPedidos(): JSX.Element {
  const [nombre] = useState(() => leerNombre());
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [desdeCache, setDesdeCache] = useState(false);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [clienteId, setClienteId] = useState<ClienteElegido>('');
  const [vendedorId, setVendedorId] = useState<number | ''>('');
  // Flujo por pasos, como el sistema: 1 cliente -> 2 vendedor -> 3 pedido.
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  // 'cargar' = el talonario; 'gestion' = los pedidos del dia, por si se equivoca.
  const [vista, setVista] = useState<'cargar' | 'gestion'>('cargar');
  const [seleccion, setSeleccion] = useState<Seleccion>({});
  const [notas, setNotas] = useState('');
  // Talonario movil.
  const [producto, setProducto] = useState<ProductoTalonario>('ALFAJORES');
  const [presentacionSel, setPresentacionSel] = useState<string>('CAJA');
  const [cantidades, setCantidades] = useState<Record<string, number | ''>>({});
  const [cantidadCajas, setCantidadCajas] = useState<number | ''>(1);
  const [renglones, setRenglones] = useState<RenglonMovil[]>([]);

  const [enCola, setEnCola] = useState(() => pendientes().length);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'info' | 'mal'; texto: string } | null>(null);
  const [pidePin, setPidePin] = useState(false);
  const [enviando, setEnviando] = useState(false);

  /* ------------------------------ Carga inicial ---------------------------- */

  const cargarCatalogo = useCallback(async (): Promise<void> => {
    try {
      const resultado = await obtenerCatalogo();
      setCatalogo(resultado.catalogo);
      setDesdeCache(resultado.desdeCache);
      setErrorCatalogo(null);
      setPidePin(false);
    } catch (causa) {
      // Con PIN pendiente se muestra el teclado del PIN, no un error de red.
      if (causa instanceof ErrorPinRequerido) {
        setPidePin(true);
        return;
      }
      setErrorCatalogo(
        'No hay conexion con la fabrica y este telefono todavia no tiene el catalogo guardado. ' +
          'Conectate una vez para descargarlo.',
      );
    }
  }, []);

  useEffect(() => {
    void cargarCatalogo();
  }, [cargarCatalogo]);

  /* ---------------------------- Sincronizacion cola ------------------------ */

  const sincronizarCola = useCallback(async (): Promise<void> => {
    if (pendientes().length === 0) return;
    const resultado = await sincronizar(async (pedido) => {
      const envio = await enviarPedido(pedido);
      if (envio === 'pin-invalido') {
        setPidePin(true);
        // El PIN vencido no descarta el pedido: corta la pasada como si fuera red.
        throw new Error('pin');
      }
      return envio;
    });
    setEnCola(resultado.quedan);
    if (resultado.enviados > 0) {
      setAviso({
        tono: 'ok',
        texto: `Se ${resultado.enviados === 1 ? 'envio 1 pedido' : `enviaron ${resultado.enviados} pedidos`} que estaban en cola.`,
      });
    }
  }, []);

  useEffect(() => {
    void sincronizarCola();
    window.addEventListener('online', () => void sincronizarCola());
    const reintento = setInterval(() => void sincronizarCola(), MS_REINTENTO_COLA);
    return () => clearInterval(reintento);
  }, [sincronizarCola]);

  /* --------------------------------- Derivados ----------------------------- */

  // Con catalogo de presentaciones el celular usa el TALONARIO (la version
  // movil del modulo de pedidos); sin el (catalogo viejo cacheado o sistema
  // sin Anyulin) cae al listado clasico por producto.
  const usaTalonario = (catalogo?.presentaciones?.length ?? 0) > 0;
  const porCodigo = useMemo(
    () => new Map((catalogo?.presentaciones ?? []).map((pr) => [pr.codigo, pr])),
    [catalogo],
  );
  const articuloPorCodigo = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const pres of catalogo?.presentaciones ?? []) {
      for (const c of pres.componentes) if (!mapa.has(c.articuloCodigo)) mapa.set(c.articuloCodigo, c.articuloId);
    }
    for (const art of catalogo?.productos ?? []) if (!mapa.has(art.codigo)) mapa.set(art.codigo, art.id);
    return mapa;
  }, [catalogo]);

  const variedades =
    producto === 'ALMENDRAS'
      ? VARIEDADES_ALMENDRA
      : producto === 'CUBANITOS'
        ? VARIEDADES_CUBANITO
        : VARIEDADES_ALFAJOR;
  const tipoAlfajor = producto === 'ALFAJORES' ? TIPOS_ALFAJOR.find((x) => x.prefijo === presentacionSel) : undefined;
  const tipoCubanito = producto === 'CUBANITOS' ? TIPOS_CUBANITO.find((x) => x.sel === presentacionSel) : undefined;
  const envase =
    tipoAlfajor !== undefined && tipoAlfajor.unidades > 1
      ? { unidades: tipoAlfajor.unidades, etiqueta: tipoAlfajor.etiqueta }
      : tipoCubanito !== undefined
        ? { unidades: tipoCubanito.unidades, etiqueta: tipoCubanito.etiqueta }
        : undefined;
  const esAlmendras = producto === 'ALMENDRAS';
  const esUnidadSuelta = tipoAlfajor !== undefined && tipoAlfajor.unidades === 1;
  const esDirecto = presentacionSel.startsWith('P');

  const numero = (clave: string): number => {
    const v = cantidades[clave];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  };
  const suma = variedades.reduce((s, v) => s + numero(v.codigo), 0);
  const cajas = typeof cantidadCajas === 'number' && cantidadCajas > 0 ? cantidadCajas : 0;
  const puedeAgregar = envase !== undefined
    ? suma === envase.unidades && cajas > 0
    : esDirecto
      ? numero('CANT') > 0
      : variedades.some((v) => numero(v.codigo) > 0) && (!esAlmendras || cajas > 0);

  const opcionesPresentacion = useMemo(() => {
    if (producto === 'ALFAJORES') {
      return TIPOS_ALFAJOR.filter((x) => porCodigo.has(`${x.prefijo}-ALF-B`)).map((x) => ({ valor: x.prefijo as string, etiqueta: x.etiqueta }));
    }
    if (producto === 'CUBANITOS') {
      return TIPOS_CUBANITO.filter((x) => porCodigo.has(x.codigoPres)).map((x) => ({ valor: x.sel as string, etiqueta: x.etiqueta }));
    }
    if (producto === 'ALMENDRAS') return [{ valor: 'VAR', etiqueta: 'Bolsa 200 g' }];
    return (catalogo?.presentaciones ?? [])
      .filter((pr) => pr.activo && pr.componentes.some((c) => c.articuloCodigo === 'ENV-ANY'))
      .map((pr) => ({ valor: `P${pr.id}`, etiqueta: pr.nombre }));
  }, [producto, porCodigo, catalogo]);

  const agregarRenglon = (): void => {
    if (catalogo === null) return;
    const nuevos: RenglonMovil[] = [];
    const buscarCatalogo = (comps: { articuloId: number; unidades: number }[]): PresentacionVista | undefined =>
      catalogo.presentaciones.find(
        (pr) => pr.activo && pr.componentes.length === comps.length &&
          comps.every((c) => pr.componentes.some((pc) => pc.articuloId === c.articuloId && pc.unidades === c.unidades)),
      );
    const deCatalogo = (pr: PresentacionVista, cantidad: number): RenglonMovil => ({
      clave: `P${pr.id}`,
      presentacionId: pr.id,
      descripcion: null,
      etiqueta: pr.nombre,
      cantidad,
      unidades: pr.unidadesTotales,
      componentes: pr.componentes.map((c) => ({ articuloId: c.articuloId, unidades: c.unidades })),
    });
    if (envase !== undefined) {
      const partes = variedades.filter((v) => numero(v.codigo) > 0);
      const comps = partes.flatMap((v) => {
        const id = articuloPorCodigo.get(v.codigo);
        return id === undefined ? [] : [{ articuloId: id, unidades: numero(v.codigo) }];
      });
      if (comps.length !== partes.length) return;
      const enCat = buscarCatalogo(comps);
      const detalle = partes.map((v) => `${numero(v.codigo)} ${v.etiqueta}`).join(' + ');
      const presCaja = tipoCubanito !== undefined ? porCodigo.get(tipoCubanito.codigoPres) : undefined;
      if (enCat !== undefined) nuevos.push(deCatalogo(enCat, cajas));
      else if (presCaja !== undefined) {
        const rotulo = `${presCaja.nombre}: ${detalle}`;
        nuevos.push({ clave: `M${Date.now()}`, presentacionId: presCaja.id, descripcion: rotulo, etiqueta: rotulo, cantidad: cajas, unidades: envase.unidades, componentes: comps });
      } else {
        const rotulo = `${envase.etiqueta} surtida: ${detalle}`;
        nuevos.push({ clave: `M${Date.now()}`, presentacionId: null, descripcion: rotulo, etiqueta: rotulo, cantidad: cajas, unidades: envase.unidades, componentes: comps });
      }
    } else if (esDirecto) {
      const pr = catalogo.presentaciones.find((x) => `P${x.id}` === presentacionSel);
      if (pr !== undefined && numero('CANT') > 0) nuevos.push(deCatalogo(pr, numero('CANT')));
    } else {
      const factor = esAlmendras ? cajas : 1;
      for (const v of variedades) {
        const cantidad = numero(v.codigo) * factor;
        if (cantidad === 0) continue;
        const pr = porCodigo.get(esUnidadSuelta ? `UNI-${v.codigo}` : v.codigo);
        if (pr !== undefined) nuevos.push(deCatalogo(pr, cantidad));
      }
    }
    if (nuevos.length === 0) return;
    setRenglones((actuales) => {
      let resultado = [...actuales];
      for (const nuevo of nuevos) {
        const puro = nuevo.presentacionId !== null && nuevo.descripcion === null;
        const ya = puro && resultado.some((r) => r.presentacionId === nuevo.presentacionId && r.descripcion === null);
        resultado = ya
          ? resultado.map((r) => (r.presentacionId === nuevo.presentacionId && r.descripcion === null ? { ...r, cantidad: r.cantidad + nuevo.cantidad } : r))
          : [...resultado, nuevo];
      }
      return resultado;
    });
    setCantidades({});
    setCantidadCajas(1);
  };

  const items = useMemo(() => {
    const porId = new Map((catalogo?.productos ?? []).map((p) => [p.id, p]));
    return Object.entries(seleccion)
      .map(([id, elegido]) => {
        const producto = porId.get(Number(id));
        const upc = producto?.unidadesPorCaja ?? null;
        // Lo elegido esta en cajas si el producto se vende por caja.
        return { articuloId: Number(id), cantidad: upc === null ? elegido : elegido * upc };
      })
      .filter((item) => item.cantidad > 0);
  }, [seleccion, catalogo]);

  const totalCajas = Object.values(seleccion).reduce((suma, n) => suma + Math.max(n, 0), 0);

  /* ---------------------------------- Envio -------------------------------- */

  const hayCarga = usaTalonario ? renglones.length > 0 : items.length > 0;

  const enviar = async (): Promise<void> => {
    if (!hayCarga || enviando) return;
    setEnviando(true);
    setAviso(null);

    const pedido: EntradaNuevoPedido = {
      clienteId: clienteId === 'mostrador' || clienteId === '' ? null : clienteId,
      vendedorId: vendedorId === '' ? null : vendedorId,
      origen: 'celular',
      cargadoPor:
        vendedorId !== '' && catalogo !== null
          ? (catalogo.vendedores.find((v) => v.id === vendedorId)?.nombre ?? null)
          : nombre || null,
      notas: notas.trim() || null,
      items: usaTalonario ? [] : items,
      renglones: usaTalonario
        ? renglones.map((r) => {
            if (r.presentacionId !== null && r.descripcion === null) {
              return { presentacionId: r.presentacionId, cantidad: r.cantidad };
            }
            if (r.presentacionId !== null) {
              return { presentacionId: r.presentacionId, cantidad: r.cantidad, descripcion: r.descripcion, componentes: r.componentes };
            }
            return { cantidad: r.cantidad, descripcion: r.descripcion, componentes: r.componentes };
          })
        : null,
      // La clave nace ACA, antes de saber si hay red: el mismo pedido, se envie
      // directo o desde la cola tras un corte, siempre viaja con la misma clave.
      // Es lo que evita que un reintento lo duplique en la fabrica.
      claveIdempotencia:
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    };

    const limpiar = (): void => {
      setSeleccion({});
      setRenglones([]);
      setCantidades({});
      setCantidadCajas(1);
      setNotas('');
      setClienteId('');
      setVendedorId('');
      setPaso(1);
    };

    try {
      const resultado = await enviarPedido(pedido);
      if (resultado === 'ok') {
        limpiar();
        setAviso({ tono: 'ok', texto: 'Pedido enviado a la fabrica.' });
      } else if (resultado === 'pin-invalido') {
        setPidePin(true);
      } else {
        setAviso({ tono: 'mal', texto: 'La fabrica rechazo el pedido. Revisa los articulos.' });
      }
    } catch {
      // Sin red: a la cola. El pedido NO se pierde.
      encolar(pedido);
      setEnCola(pendientes().length);
      limpiar();
      setAviso({
        tono: 'info',
        texto: 'Sin conexion: el pedido quedo guardado en el telefono y sale solo al reconectar.',
      });
    } finally {
      setEnviando(false);
    }
  };

  /* --------------------------------- Pantallas ----------------------------- */

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-masa-100 pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-dulce-600 px-4 py-3 text-white shadow-barra">
        <div className="flex min-w-0 items-center gap-2">
          {usaTalonario && paso > 1 && (
            <button
              type="button"
              onClick={() => setPaso((paso === 3 ? 2 : 1) as 1 | 2)}
              aria-label="Volver al paso anterior"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ficha border border-white/40 text-xl font-bold"
            >
              ←
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">Pedidos</h1>
            <p className="text-xs text-white/75">
              Alpha Gestión{usaTalonario ? ` · Paso ${paso} de 3` : ''}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {enCola > 0 && (
            <span className="rounded-pastilla bg-alerta-400 px-2.5 py-1 text-xs font-bold text-masa-900">
              {enCola} en cola
            </span>
          )}
          {usaTalonario && (
            <button
              type="button"
              onClick={() => setVista(vista === 'cargar' ? 'gestion' : 'cargar')}
              className="h-10 rounded-ficha border border-white/40 px-3 text-xs font-bold uppercase"
            >
              {vista === 'cargar' ? 'Mis pedidos' : 'Cargar'}
            </button>
          )}
        </div>
      </header>

      {aviso !== null && (
        <div
          role="status"
          className={[
            'mx-3 mt-3 rounded-ficha border px-3 py-2.5 text-sm',
            aviso.tono === 'ok' && 'border-menta-200 bg-menta-50 text-menta-700',
            aviso.tono === 'info' && 'border-info-200 bg-info-50 text-info-700',
            aviso.tono === 'mal' && 'border-peligro-200 bg-peligro-50 text-peligro-600',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {aviso.texto}
        </div>
      )}

      {desdeCache && (
        <p className="mx-3 mt-3 rounded-ficha border border-alerta-200 bg-alerta-50 px-3 py-2 text-xs text-alerta-700">
          Sin conexion: catalogo guardado en el telefono
          {catalogo ? ` (${new Date(catalogo.actualizadoEn).toLocaleDateString('es-AR')})` : ''}.
        </p>
      )}

      {errorCatalogo !== null ? (
        <div className="m-3 rounded-ficha border border-peligro-200 bg-peligro-50 p-4 text-sm text-peligro-600">
          {errorCatalogo}
          <button
            type="button"
            onClick={() => void cargarCatalogo()}
            className="mt-3 block rounded-pastilla bg-peligro-600 px-4 py-2 font-medium text-white"
          >
            Reintentar
          </button>
        </div>
      ) : catalogo === null ? (
        <p className="p-6 text-center text-sm text-masa-700">Cargando catalogo...</p>
      ) : vista === 'gestion' ? (
        <VistaGestionPedidos alAvisar={(a) => setAviso(a)} />
      ) : (
        <main className="flex flex-col gap-4 p-3">
          <section className={usaTalonario && paso !== 1 ? 'hidden' : ''}>
            <label htmlFor="cliente" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
              Paso 1 · Cliente
            </label>
            <select
              id="cliente"
              value={clienteId}
              onChange={(e) => {
                const valor = e.target.value;
                const nuevo = valor === '' ? '' : valor === 'mostrador' ? 'mostrador' : Number(valor);
                setClienteId(nuevo);
                // El vendedor habitual del cliente se propone solo (editable).
                if (typeof nuevo === 'number') {
                  const cliente = catalogo?.clientes.find((c) => c.id === nuevo);
                  if (cliente?.vendedorId != null) setVendedorId(cliente.vendedorId);
                }
              }}
              className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-base text-masa-900"
            >
              <option value="">Elegi el cliente...</option>
              {catalogo.clientes
                .filter((c) => c.activo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              <option value="mostrador">Mostrador / sin cliente</option>
            </select>
          </section>

          <section className={usaTalonario && paso !== 2 ? 'hidden' : ''}>
            <label htmlFor="vendedor" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
              Paso 2 · Vendedor
            </label>
            <select
              id="vendedor"
              value={vendedorId}
              onChange={(e) => setVendedorId(e.target.value === '' ? '' : Number(e.target.value))}
              className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-base text-masa-900"
            >
              <option value="">Venta directa / sin vendedor</option>
              {(catalogo.vendedores ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </select>
          </section>

          {clienteId === '' && !usaTalonario ? (
            <p className="rounded-ficha border border-dashed border-masa-300 bg-white px-4 py-8 text-center text-sm text-masa-700">
              Elegi el cliente para cargar el pedido.
            </p>
          ) : usaTalonario && paso !== 3 ? null : usaTalonario ? (
            <section className="space-y-3">
              <div className="rounded-ficha border border-masa-200 bg-white p-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
                  Producto
                </label>
                <select
                  value={producto}
                  onChange={(e) => {
                    const nuevoProducto = e.target.value as ProductoTalonario;
                    setProducto(nuevoProducto);
                    setCantidades({});
                    setCantidadCajas(1);
                    setPresentacionSel(
                      nuevoProducto === 'ALFAJORES' ? 'CAJA'
                        : nuevoProducto === 'CUBANITOS' ? 'CUB10'
                          : nuevoProducto === 'ALMENDRAS' ? 'VAR' : '',
                    );
                  }}
                  className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-base text-masa-900"
                >
                  {PRODUCTOS_TALONARIO.map((pt) => (
                    <option key={pt.valor} value={pt.valor}>{pt.etiqueta}</option>
                  ))}
                </select>

                <label className="mb-1 mt-3 block text-xs font-semibold uppercase tracking-wide text-masa-700">
                  Presentacion
                </label>
                <select
                  value={presentacionSel}
                  onChange={(e) => {
                    setPresentacionSel(e.target.value);
                    setCantidades({});
                    setCantidadCajas(1);
                  }}
                  className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-base text-masa-900"
                >
                  {opcionesPresentacion.map((o) => (
                    <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
                  ))}
                </select>

                {esDirecto ? (
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
                      Cantidad
                    </label>
                    <input
                      inputMode="numeric"
                      value={cantidades['CANT'] === undefined || cantidades['CANT'] === '' ? '' : String(cantidades['CANT'])}
                      onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        setCantidades((s) => ({ ...s, CANT: Number.isFinite(v) ? v : '' }));
                      }}
                      placeholder="0"
                      className="h-12 w-28 rounded-ficha border border-masa-300 bg-white text-center text-lg font-bold tabular-nums"
                    />
                  </div>
                ) : (
                  <>
                    <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-masa-700">
                      {envase !== undefined
                        ? `Unidades por variedad (suman ${envase.unidades})`
                        : esAlmendras
                          ? 'Bolsas de cada variedad'
                          : 'Unidades de cada variedad'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {variedades.map((v) => (
                        <label key={v.codigo} className="flex flex-col gap-0.5">
                          <span className="text-[11px] font-bold uppercase tracking-wide text-masa-800">{v.etiqueta}</span>
                          <input
                            inputMode="numeric"
                            value={cantidades[v.codigo] === undefined || cantidades[v.codigo] === '' ? '' : String(cantidades[v.codigo])}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              setCantidades((s) => ({ ...s, [v.codigo]: Number.isFinite(n) ? n : '' }));
                            }}
                            placeholder="0"
                            className="h-12 w-full rounded-ficha border border-masa-300 bg-white text-center text-lg font-bold tabular-nums"
                          />
                        </label>
                      ))}
                      {(envase !== undefined || esAlmendras) && (
                        <label className="col-span-2 flex flex-col gap-0.5 border-t border-masa-200 pt-2">
                          <span className="text-xs font-bold uppercase tracking-wide text-dulce-700">
                            {esAlmendras ? 'CANTIDAD DE BOLSAS' : 'CANTIDAD DE CAJAS'}
                          </span>
                          <input
                            inputMode="numeric"
                            value={cantidadCajas === '' ? '' : String(cantidadCajas)}
                            onChange={(e) => {
                              const n = Number.parseInt(e.target.value, 10);
                              setCantidadCajas(Number.isFinite(n) ? n : '');
                            }}
                            className="h-14 w-full rounded-ficha border-2 border-dulce-400 bg-dulce-50 text-center text-xl font-bold tabular-nums"
                          />
                        </label>
                      )}
                    </div>
                    {envase !== undefined && suma !== envase.unidades && suma > 0 && (
                      <p className="mt-1.5 text-xs font-medium text-alerta-700">
                        Van {suma} de {envase.unidades} unidades: ajusta para que la caja cierre.
                      </p>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={agregarRenglon}
                  disabled={!puedeAgregar}
                  className="mt-3 h-12 w-full rounded-ficha bg-dulce-600 text-base font-bold uppercase text-white disabled:bg-masa-300"
                >
                  Agregar al pedido
                </button>
              </div>

              {renglones.length > 0 && (
                <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
                  {renglones.map((r, i) => (
                    <div key={r.clave} className={['flex items-center gap-2 px-3 py-2', i > 0 ? 'border-t border-masa-100' : ''].join(' ')}>
                      <input
                        inputMode="numeric"
                        value={String(r.cantidad)}
                        onChange={(e) => {
                          const n = Number.parseInt(e.target.value, 10);
                          setRenglones((rs) => rs.map((x) => (x.clave === r.clave ? { ...x, cantidad: Number.isFinite(n) && n > 0 ? n : x.cantidad } : x)));
                        }}
                        className="h-10 w-14 shrink-0 rounded-ficha border border-masa-300 bg-white text-center text-base font-bold tabular-nums"
                      />
                      <span className="min-w-0 flex-1 text-sm text-masa-900">{r.etiqueta}</span>
                      <button
                        type="button"
                        onClick={() => setRenglones((rs) => rs.filter((x) => x.clave !== r.clave))}
                        className="h-9 shrink-0 rounded-ficha border border-peligro-300 bg-white px-2.5 text-xs font-bold uppercase text-peligro-700"
                      >
                        Quitar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-masa-700">
                Productos · cantidades en cajas
              </p>
              <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
                {catalogo.productos.map((productoFila, indice) => (
                  <FilaProducto
                    key={productoFila.id}
                    producto={productoFila}
                    cantidad={seleccion[productoFila.id] ?? 0}
                    conBorde={indice > 0}
                    alCambiar={(cantidad) =>
                      setSeleccion((actual) => ({ ...actual, [productoFila.id]: Math.max(cantidad, 0) }))
                    }
                  />
                ))}
              </div>
            </section>
          )}

          <section className={usaTalonario && paso !== 3 ? 'hidden' : ''}>
            <label htmlFor="notas" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
              Notas (opcional)
            </label>
            <textarea
              id="notas"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder="Sin coco, entregar antes de las 10..."
              className="w-full rounded-ficha border border-masa-300 bg-white px-3 py-2 text-base text-masa-900"
            />
          </section>
        </main>
      )}

      {/* Boton fijo abajo: siempre a mano del pulgar. */}
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-lg border-t border-masa-200 bg-white p-3">
        {usaTalonario && paso < 3 ? (
          <button
            type="button"
            onClick={() => setPaso((paso + 1) as 2 | 3)}
            disabled={paso === 1 && clienteId === ''}
            className="h-14 w-full rounded-ficha bg-dulce-600 text-lg font-bold text-white disabled:bg-masa-300 disabled:text-masa-500"
          >
            {paso === 1 && clienteId === '' ? 'Elegi el cliente' : 'Continuar'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!hayCarga || enviando}
            className="h-14 w-full rounded-ficha bg-dulce-600 text-lg font-bold text-white disabled:bg-masa-300 disabled:text-masa-500"
          >
            {enviando
              ? 'Enviando...'
              : clienteId === ''
                ? 'Elegi el cliente'
                : !hayCarga
                  ? 'Carga el pedido'
                  : usaTalonario
                    ? `Enviar pedido · ${renglones.length} ${renglones.length === 1 ? 'renglon' : 'renglones'}`
                    : `Enviar pedido · ${totalCajas} ${totalCajas === 1 ? 'caja' : 'cajas'}`}
          </button>
        )}
      </div>

      {pidePin && (
        <PantallaPin
          alGuardar={(pin) => {
            guardarPin(pin);
            setPidePin(false);
            void cargarCatalogo();
            void sincronizarCola();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------ Sub-pantallas ------------------------------ */

function FilaProducto({
  producto,
  cantidad,
  conBorde,
  alCambiar,
}: {
  readonly producto: ArticuloConStock;
  readonly cantidad: number;
  readonly conBorde: boolean;
  readonly alCambiar: (cantidad: number) => void;
}): JSX.Element {
  return (
    <div
      className={[
        'flex min-h-14 items-center justify-between gap-3 px-3 py-2',
        conBorde ? 'border-t border-masa-100' : '',
      ].join(' ')}
    >
      <div className="min-w-0">
        <p className="truncate text-base font-medium text-masa-900">{producto.nombre}</p>
        <p className="text-xs text-masa-700">
          {producto.unidadesPorCaja === null
            ? `Stock: ${producto.stock} ${producto.unidadAbreviatura}`
            : `Caja de ${producto.unidadesPorCaja} · stock ${Math.floor(producto.stock / producto.unidadesPorCaja)} cajas`}
          {producto.unidadesPorCaja !== null && cantidad > 0
            ? ` · pedis ${cantidad * producto.unidadesPorCaja} u`
            : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Sacar ${producto.nombre}`}
          onClick={() => alCambiar(cantidad - 1)}
          disabled={cantidad === 0}
          className="h-11 w-11 rounded-ficha border border-masa-300 bg-masa-50 text-xl font-bold text-masa-900 disabled:opacity-30"
        >
          −
        </button>
        <input
          inputMode="numeric"
          value={cantidad === 0 ? '' : String(cantidad)}
          onChange={(e) => {
            const valor = Number.parseInt(e.target.value, 10);
            alCambiar(Number.isFinite(valor) ? valor : 0);
          }}
          placeholder="0"
          aria-label={`Cantidad de ${producto.nombre}`}
          className="h-11 w-14 rounded-ficha border border-masa-300 bg-white text-center text-lg font-bold tabular-nums text-masa-900"
        />
        <button
          type="button"
          aria-label={`Agregar ${producto.nombre}`}
          onClick={() => alCambiar(cantidad + 1)}
          className="h-11 w-11 rounded-ficha border border-dulce-400 bg-dulce-500 text-xl font-bold text-white"
        >
          +
        </button>
      </div>
    </div>
  );
}

function PantallaPin({ alGuardar }: { readonly alGuardar: (pin: string) => void }): JSX.Element {
  const [valor, setValor] = useState(() => leerPin());
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-6">
      <div className="w-full max-w-sm rounded-panel bg-white p-5">
        <h2 className="text-lg font-bold text-masa-900">PIN de la fabrica</h2>
        <p className="mt-1 text-sm text-masa-700">
          La carga de pedidos esta protegida. Ingresa el PIN configurado en el sistema.
        </p>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="numeric"
          autoFocus
          maxLength={12}
          className="mt-3 h-12 w-full rounded-ficha border border-masa-300 text-center text-2xl tracking-[0.4em] text-masa-900"
        />
        <button
          type="button"
          onClick={() => valor.trim() !== '' && alGuardar(valor.trim())}
          disabled={valor.trim() === ''}
          className="mt-3 h-12 w-full rounded-ficha bg-dulce-600 font-bold text-white disabled:bg-masa-300"
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

/**
 * Gestion desde el celular: los pedidos de HOY con su estado, para controlar
 * lo cargado y CANCELAR si hubo un error. Nada mas: el resto del sistema se
 * opera desde el escritorio (el servidor ademas lo bloquea desde la red).
 */
function VistaGestionPedidos({
  alAvisar,
}: {
  readonly alAvisar: (aviso: { tono: 'ok' | 'info' | 'mal'; texto: string }) => void;
}): JSX.Element {
  interface PedidoRemoto {
    id: number;
    clienteNombre: string | null;
    vendedorNombre: string | null;
    estado: string;
    fechaPedido: string;
    renglones: { id: number; cantidad: number; descripcion: string | null; presentacionNombre: string | null }[];
    items: { id: number; cantidad: number; nombre: string }[];
  }
  const [pedidos, setPedidos] = useState<PedidoRemoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch('/api/pedidos', { headers: { 'x-pin-pedidos': leerPin() } });
      const cuerpo = (await r.json()) as { datos?: PedidoRemoto[] };
      if (!r.ok || !cuerpo.datos) throw new Error('No se pudieron traer los pedidos.');
      const hoy = new Date().toDateString();
      setPedidos(cuerpo.datos.filter((pd) => new Date(pd.fechaPedido).toDateString() === hoy));
      setError(null);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : String(causa));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cancelar = async (pedido: PedidoRemoto): Promise<void> => {
    if (!window.confirm(`¿Cancelar el pedido #${pedido.id}${pedido.clienteNombre !== null ? ` de ${pedido.clienteNombre}` : ''}?`)) return;
    setOcupado(true);
    try {
      const r = await fetch(`/api/pedidos/${pedido.id}/estado`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-pin-pedidos': leerPin() },
        body: JSON.stringify({ estado: 'cancelado' }),
      });
      if (!r.ok) {
        const cuerpo = (await r.json().catch(() => null)) as { error?: { mensaje?: string } } | null;
        throw new Error(cuerpo?.error?.mensaje ?? 'No se pudo cancelar.');
      }
      alAvisar({ tono: 'ok', texto: `Pedido #${pedido.id} cancelado.` });
      await cargar();
    } catch (causa) {
      alAvisar({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) });
    } finally {
      setOcupado(false);
    }
  };

  const ETIQUETAS: Record<string, string> = {
    pendiente: 'Pendiente',
    confirmado: 'Confirmado',
    en_produccion: 'En elaboracion',
    listo: 'Listo',
    entregado: 'Entregado',
    cancelado: 'Cancelado',
  };

  if (error !== null) {
    return (
      <div className="m-3 rounded-ficha border border-peligro-200 bg-peligro-50 p-4 text-sm text-peligro-600">
        {error}
        <button type="button" onClick={() => void cargar()} className="mt-3 block rounded-pastilla bg-peligro-600 px-4 py-2 font-medium text-white">
          Reintentar
        </button>
      </div>
    );
  }
  if (pedidos === null) return <p className="p-6 text-center text-sm text-masa-700">Cargando pedidos...</p>;

  return (
    <main className="flex flex-col gap-3 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-masa-700">
        Pedidos de hoy ({pedidos.length})
      </p>
      {pedidos.length === 0 ? (
        <p className="rounded-ficha border border-dashed border-masa-300 bg-white px-4 py-8 text-center text-sm text-masa-700">
          Todavia no se cargaron pedidos hoy.
        </p>
      ) : (
        pedidos.map((pedido) => {
          const cancelable = pedido.estado !== 'entregado' && pedido.estado !== 'cancelado';
          return (
            <div key={pedido.id} className="rounded-ficha border border-masa-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-bold text-masa-900">
                    #{pedido.id} · {pedido.clienteNombre ?? 'Mostrador'}
                  </p>
                  <p className="text-xs text-masa-700">
                    {new Date(pedido.fechaPedido).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    {pedido.vendedorNombre !== null ? ` · ${pedido.vendedorNombre}` : ''}
                    {' · '}
                    <span className="font-semibold">{ETIQUETAS[pedido.estado] ?? pedido.estado}</span>
                  </p>
                </div>
                {cancelable && (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => void cancelar(pedido)}
                    className="h-10 shrink-0 rounded-ficha border border-peligro-300 bg-white px-3 text-xs font-bold uppercase text-peligro-700 disabled:opacity-40"
                  >
                    Cancelar
                  </button>
                )}
              </div>
              <ul className="mt-2 space-y-0.5 border-t border-masa-100 pt-2">
                {(pedido.renglones.length > 0
                  ? pedido.renglones.map((r) => ({ id: `r${r.id}`, texto: `${r.cantidad} × ${r.descripcion ?? r.presentacionNombre ?? 'renglon'}` }))
                  : pedido.items.map((it) => ({ id: `i${it.id}`, texto: `${it.cantidad} u ${it.nombre}` }))
                ).map((linea) => (
                  <li key={linea.id} className="text-sm text-masa-900">{linea.texto}</li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </main>
  );
}

