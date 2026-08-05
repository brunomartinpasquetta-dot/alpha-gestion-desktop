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

import type { ArticuloConStock, EntradaNuevoPedido } from '../../compartido/contratos';
import {
  enviarPedido,
  guardarNombre,
  guardarPin,
  leerNombre,
  leerPin,
  obtenerCatalogo,
  type Catalogo,
} from './api';
import { encolar, pendientes, sincronizar } from './cola';

/** Cantidades elegidas por articulo. Solo los > 0 forman el pedido. */
type Seleccion = Readonly<Record<number, number>>;

const MS_REINTENTO_COLA = 30_000;

export function AppPedidos(): JSX.Element {
  const [nombre, setNombre] = useState(() => leerNombre());
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [desdeCache, setDesdeCache] = useState(false);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);

  const [clienteId, setClienteId] = useState<number | ''>('');
  const [seleccion, setSeleccion] = useState<Seleccion>({});
  const [notas, setNotas] = useState('');

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
    } catch {
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

  const items = useMemo(
    () =>
      Object.entries(seleccion)
        .map(([id, cantidad]) => ({ articuloId: Number(id), cantidad }))
        .filter((item) => item.cantidad > 0),
    [seleccion],
  );

  const totalUnidades = items.reduce((suma, item) => suma + item.cantidad, 0);

  /* ---------------------------------- Envio -------------------------------- */

  const enviar = async (): Promise<void> => {
    if (items.length === 0 || enviando) return;
    setEnviando(true);
    setAviso(null);

    const pedido: EntradaNuevoPedido = {
      clienteId: clienteId === '' ? null : clienteId,
      origen: 'celular',
      cargadoPor: nombre || null,
      notas: notas.trim() || null,
      items,
    };

    const limpiar = (): void => {
      setSeleccion({});
      setNotas('');
      setClienteId('');
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

  if (nombre === '') {
    return <PantallaNombre alGuardar={(n) => { guardarNombre(n); setNombre(n); }} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col bg-masa-100 pb-28">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-dulce-600 px-4 py-3 text-white shadow-barra">
        <div>
          <h1 className="text-lg font-bold leading-tight">Pedidos</h1>
          <p className="text-xs text-white/75">Alpha Gestión · {nombre}</p>
        </div>
        {enCola > 0 && (
          <span className="rounded-pastilla bg-alerta-400 px-2.5 py-1 text-xs font-bold text-masa-900">
            {enCola} en cola
          </span>
        )}
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
      ) : (
        <main className="flex flex-col gap-4 p-3">
          <section>
            <label htmlFor="cliente" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
              Cliente
            </label>
            <select
              id="cliente"
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value === '' ? '' : Number(e.target.value))}
              className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-base text-masa-900"
            >
              <option value="">Mostrador / sin cliente</option>
              {catalogo.clientes
                .filter((c) => c.activo)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
            </select>
          </section>

          <section>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-masa-700">Productos</p>
            <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
              {catalogo.productos.map((producto, indice) => (
                <FilaProducto
                  key={producto.id}
                  producto={producto}
                  cantidad={seleccion[producto.id] ?? 0}
                  conBorde={indice > 0}
                  alCambiar={(cantidad) =>
                    setSeleccion((actual) => ({ ...actual, [producto.id]: Math.max(cantidad, 0) }))
                  }
                />
              ))}
            </div>
          </section>

          <section>
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
        <button
          type="button"
          onClick={() => void enviar()}
          disabled={items.length === 0 || enviando}
          className="h-14 w-full rounded-ficha bg-dulce-600 text-lg font-bold text-white disabled:bg-masa-300 disabled:text-masa-500"
        >
          {enviando
            ? 'Enviando...'
            : items.length === 0
              ? 'Elegi productos'
              : `Enviar pedido · ${totalUnidades} u.`}
        </button>
      </div>

      {pidePin && (
        <PantallaPin
          alGuardar={(pin) => {
            guardarPin(pin);
            setPidePin(false);
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
          Stock: {producto.stock} {producto.unidadAbreviatura}
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

function PantallaNombre({ alGuardar }: { readonly alGuardar: (nombre: string) => void }): JSX.Element {
  const [valor, setValor] = useState('');
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 bg-masa-100 p-6">
      <h1 className="text-xl font-bold text-masa-900">¿Quien carga pedidos?</h1>
      <p className="text-center text-sm text-masa-700">
        Tu nombre queda en cada pedido para que en la fabrica sepan a quien preguntarle.
      </p>
      <input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Nombre"
        maxLength={40}
        className="h-12 w-full rounded-ficha border border-masa-300 bg-white px-3 text-center text-lg text-masa-900"
      />
      <button
        type="button"
        onClick={() => valor.trim() !== '' && alGuardar(valor.trim())}
        disabled={valor.trim() === ''}
        className="h-12 w-full rounded-ficha bg-dulce-600 font-bold text-white disabled:bg-masa-300"
      >
        Empezar
      </button>
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
