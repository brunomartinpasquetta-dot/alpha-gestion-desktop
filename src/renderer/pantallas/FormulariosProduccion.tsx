/**
 * Formularios de ajuste de stock, recetas y precios.
 *
 * El ajuste de stock es el unico lugar del sistema donde se toca un saldo sin
 * que haya una venta, una compra o una tanda detras. Por eso el formulario pide
 * el conteo real —no el delta— y muestra la diferencia que va a asentar: el
 * operador cuenta cajas, no calcula restas.
 */

import { useEffect, useMemo, useState } from 'react';

import type {
  ArticuloConStock,
  EntradaItemReceta,
  ListaPrecioVista,
  RecetaVista,
} from '../../compartido/contratos';
import {
  CampoMoneda,
  CampoNumero,
  CampoOpciones,
  CampoSelector,
  CampoTexto,
  Fila,
  ModalFormulario,
} from '../componentes/Formulario';
import {
  actualizarReceta,
  ajustarStock,
  crearListaPrecio,
  crearReceta,
  fijarPrecio,
  obtenerArticulos,
  obtenerListasPrecio,
} from '../servicios/cliente';
import { formatearCantidad, formatearMoneda } from '../utiles/formato';

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

/* ----------------------------- Ajuste de stock ----------------------------- */

type ModoAjuste = 'conteo' | 'delta';

export function FormularioAjusteStock({
  articulo,
  alCerrar,
  alGuardar,
}: {
  /** Artículo preseleccionado (se abre desde su fila), o null para elegirlo. */
  readonly articulo: ArticuloConStock | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [articulos, setArticulos] = useState<ArticuloConStock[]>(articulo === null ? [] : [articulo]);
  const [articuloId, setArticuloId] = useState<number | ''>(articulo?.id ?? '');
  const [modo, setModo] = useState<ModoAjuste>('conteo');
  const [conteo, setConteo] = useState<number | ''>('');
  const [delta, setDelta] = useState<number | ''>('');
  const [motivo, setMotivo] = useState('');
  const [esMerma, setEsMerma] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (articulo !== null) return;
    obtenerArticulos()
      .then((lista) => setArticulos(lista.filter((a) => a.activo)))
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, [articulo]);

  const elegido = articulos.find((a) => a.id === articuloId);
  const stockActual = elegido?.stock ?? 0;

  // En modo conteo el operador carga lo que hay; el delta se deduce.
  const ajuste = useMemo(() => {
    if (modo === 'delta') return Number(delta || 0);
    if (conteo === '') return 0;
    return Number((Number(conteo) - stockActual).toFixed(4));
  }, [modo, delta, conteo, stockActual]);

  const guardar = (): void => {
    if (articuloId === '' || ajuste === 0) return;
    setGuardando(true);
    setError(null);
    ajustarStock({ articuloId, cantidad: ajuste, motivo, esMerma })
      .then((r) =>
        alGuardar(
          `${r.articuloNombre}: ${formatearCantidad(r.saldoPrevio)} → ${formatearCantidad(r.saldoNuevo)}.`,
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Ajustar stock"
      descripcion="No edita el saldo: asienta un movimiento con su motivo, que queda en el historial."
      error={error}
      guardando={guardando}
      puedeGuardar={articuloId !== '' && ajuste !== 0 && motivo.trim().length >= 3}
      etiquetaGuardar="Asentar ajuste"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        elegido !== undefined && ajuste !== 0 ? (
          <span className="text-sm text-masa-800">
            {formatearCantidad(stockActual)} →{' '}
            <strong className="font-mono">{formatearCantidad(stockActual + ajuste)}</strong>{' '}
            <span className={ajuste > 0 ? 'text-menta-700' : 'text-peligro-600'}>
              ({ajuste > 0 ? '+' : ''}
              {formatearCantidad(ajuste)})
            </span>
          </span>
        ) : undefined
      }
    >
      {articulo === null ? (
        <CampoSelector
          id="aj-art"
          rotulo="Articulo"
          valor={articuloId}
          vacio="Elegi el articulo"
          opciones={articulos.map((a) => ({
            valor: a.id,
            etiqueta: `${a.codigo} · ${a.nombre} (hoy: ${formatearCantidad(a.stock)} ${a.unidadAbreviatura})`,
          }))}
          alCambiar={(v) => setArticuloId(v === '' ? '' : Number(v))}
        />
      ) : (
        <p className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2 text-sm text-masa-900">
          <strong>{articulo.nombre}</strong> · stock actual{' '}
          <span className="font-mono">
            {formatearCantidad(articulo.stock)} {articulo.unidadAbreviatura}
          </span>
        </p>
      )}

      <CampoOpciones
        rotulo="Como cargar el ajuste"
        valor={modo}
        opciones={[
          { valor: 'conteo', etiqueta: 'Conte y hay...' },
          { valor: 'delta', etiqueta: 'Sumar / restar' },
        ]}
        alCambiar={setModo}
        ayuda={
          modo === 'conteo'
            ? 'Carga lo que contaste de verdad; el sistema calcula la diferencia.'
            : 'Carga la diferencia con signo: 10 suma, -10 resta.'
        }
      />

      {modo === 'conteo' ? (
        <CampoNumero
          id="aj-conteo"
          rotulo={`Cantidad contada${elegido !== undefined ? ` (${elegido.unidadAbreviatura})` : ''}`}
          valor={conteo}
          alCambiar={setConteo}
        />
      ) : (
        <CampoNumero
          id="aj-delta"
          rotulo="Diferencia (con signo)"
          valor={delta}
          alCambiar={setDelta}
          minimo={-1000000}
        />
      )}

      <CampoTexto
        id="aj-motivo"
        rotulo="Motivo"
        valor={motivo}
        alCambiar={setMotivo}
        requerido
        maximo={300}
        marcador="Recuento de inventario, rotura, vencido..."
        ayuda="Queda asentado en el historial del articulo. Es obligatorio."
      />

      <label className="flex items-center gap-2 text-sm text-masa-900">
        <input
          type="checkbox"
          checked={esMerma}
          onChange={(e) => setEsMerma(e.target.checked)}
          className="h-4 w-4"
        />
        Es mercaderia descartada (se asienta como merma)
      </label>
    </ModalFormulario>
  );
}

/* --------------------------------- Recetas --------------------------------- */

interface LineaInsumo {
  articuloInsumoId: number | '';
  cantidad: number | '';
  mermaEsperadaPct: number | '';
}

export function FormularioReceta({
  receta,
  alCerrar,
  alGuardar,
}: {
  readonly receta: RecetaVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [articuloProducidoId, setArticuloProducidoId] = useState<number | ''>(
    receta?.articuloProducidoId ?? '',
  );
  const [rindeCantidad, setRindeCantidad] = useState<number | ''>(receta?.rindeCantidad ?? '');
  const [notas, setNotas] = useState(receta?.notas ?? '');
  const [lineas, setLineas] = useState<LineaInsumo[]>(
    receta === null
      ? [{ articuloInsumoId: '', cantidad: '', mermaEsperadaPct: '' }]
      : receta.items.map((i) => ({
          articuloInsumoId: i.articuloInsumoId,
          cantidad: i.cantidad,
          mermaEsperadaPct: i.mermaEsperadaPct || '',
        })),
  );
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerArticulos()
      .then((lista) => setArticulos(lista.filter((a) => a.activo)))
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  // Se produce lo que no es materia prima; se consume cualquier cosa menos el producido.
  const producibles = articulos.filter((a) => a.tipo !== 'materia_prima');
  const insumos = articulos.filter((a) => a.id !== articuloProducidoId);
  const producido = articulos.find((a) => a.id === articuloProducidoId);

  const editarLinea = (indice: number, cambio: Partial<LineaInsumo>): void =>
    setLineas((previas) => previas.map((l, i) => (i === indice ? { ...l, ...cambio } : l)));

  const completas = lineas.filter((l) => l.articuloInsumoId !== '' && Number(l.cantidad) > 0);

  const guardar = (): void => {
    if (articuloProducidoId === '' || Number(rindeCantidad) <= 0 || completas.length === 0) return;
    setGuardando(true);
    setError(null);
    const items: EntradaItemReceta[] = completas.map((l) => ({
      articuloInsumoId: Number(l.articuloInsumoId),
      cantidad: Number(l.cantidad),
      mermaEsperadaPct: l.mermaEsperadaPct === '' ? 0 : Number(l.mermaEsperadaPct),
    }));
    const entrada = {
      articuloProducidoId: Number(articuloProducidoId),
      rindeCantidad: Number(rindeCantidad),
      notas: notas.trim() || null,
      items,
    };
    const operacion = receta === null ? crearReceta(entrada) : actualizarReceta(receta.id, entrada);
    operacion
      .then(() =>
        alGuardar(
          `Receta de ${producido?.nombre ?? 'producto'} ${receta === null ? 'creada' : 'actualizada'}.`,
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={receta === null ? 'Nueva receta' : `Editar receta de ${receta.articuloProducidoNombre}`}
      descripcion="Editarla no cambia las tandas ya producidas: cada orden guarda su propia copia."
      ancho="max-w-2xl"
      error={error}
      guardando={guardando}
      puedeGuardar={articuloProducidoId !== '' && Number(rindeCantidad) > 0 && completas.length > 0}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <Fila>
        <CampoSelector
          id="re-prod"
          rotulo="Producto que sale"
          valor={articuloProducidoId}
          vacio="Elegi el producto"
          opciones={producibles.map((a) => ({ valor: a.id, etiqueta: `${a.codigo} · ${a.nombre}` }))}
          alCambiar={(v) => setArticuloProducidoId(v === '' ? '' : Number(v))}
        />
        <CampoNumero
          id="re-rinde"
          rotulo={`Rinde por tanda${producido !== undefined ? ` (${producido.unidadAbreviatura})` : ''}`}
          valor={rindeCantidad}
          alCambiar={setRindeCantidad}
          ayuda="Cuanto sale de una tanda completa."
        />
      </Fila>

      <div>
        <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
          Insumos que consume
        </p>
        <div className="space-y-2">
          {lineas.map((linea, indice) => {
            const insumo = articulos.find((a) => a.id === linea.articuloInsumoId);
            return (
              <div key={indice} className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <CampoSelector
                      id={`re-ins-${indice}`}
                      rotulo="Insumo"
                      valor={linea.articuloInsumoId}
                      vacio="Elegi el insumo"
                      opciones={insumos.map((a) => ({ valor: a.id, etiqueta: `${a.codigo} · ${a.nombre}` }))}
                      alCambiar={(v) => editarLinea(indice, { articuloInsumoId: v === '' ? '' : Number(v) })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <CampoNumero
                      id={`re-cant-${indice}`}
                      rotulo={`Cantidad${insumo !== undefined ? ` (${insumo.unidadAbreviatura})` : ''}`}
                      valor={linea.cantidad}
                      alCambiar={(v) => editarLinea(indice, { cantidad: v })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <CampoNumero
                      id={`re-merma-${indice}`}
                      rotulo="Merma %"
                      valor={linea.mermaEsperadaPct}
                      alCambiar={(v) => editarLinea(indice, { mermaEsperadaPct: v })}
                    />
                  </div>
                </div>
                {lineas.length > 1 && (
                  <div className="mt-1 text-right">
                    <button
                      type="button"
                      onClick={() => setLineas((p) => p.filter((_, i) => i !== indice))}
                      className="rounded-pastilla border border-peligro-300 px-2 py-0.5 text-xs font-medium text-peligro-600 hover:bg-peligro-50"
                    >
                      Quitar
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            setLineas((p) => [...p, { articuloInsumoId: '', cantidad: '', mermaEsperadaPct: '' }])
          }
          className="mt-2 rounded-ficha border border-masa-300 px-3 py-1.5 text-sm font-medium text-masa-800 hover:bg-masa-100"
        >
          + Agregar insumo
        </button>
      </div>

      <CampoTexto id="re-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/* ------------------------------ Precios de venta --------------------------- */

export function FormularioPrecio({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [listas, setListas] = useState<ListaPrecioVista[]>([]);
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [listaPrecioId, setListaPrecioId] = useState<number | ''>('');
  const [articuloId, setArticuloId] = useState<number | ''>('');
  const [precio, setPrecio] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerListasPrecio(), obtenerArticulos()])
      .then(([l, a]) => {
        setListas(l);
        setArticulos(a.filter((x) => x.activo && x.tipo === 'producto_terminado'));
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  const articulo = articulos.find((a) => a.id === articuloId);
  const lista = listas.find((l) => l.id === listaPrecioId);
  const vigente = lista?.precios
    .filter((p) => p.articuloId === articuloId)
    .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];

  const guardar = (): void => {
    if (listaPrecioId === '' || articuloId === '') return;
    setGuardando(true);
    setError(null);
    fijarPrecio({ listaPrecioId, articuloId, precio })
      .then(() =>
        alGuardar(`${articulo?.nombre ?? 'Producto'} a ${formatearMoneda(precio)} en ${lista?.nombre}.`),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Fijar precio"
      descripcion="No pisa el precio anterior: queda vigente desde hoy y el historial se conserva."
      error={error}
      guardando={guardando}
      puedeGuardar={listaPrecioId !== '' && articuloId !== '' && precio > 0}
      etiquetaGuardar="Fijar precio"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        vigente !== undefined ? (
          <span className="text-sm text-masa-800">
            Precio vigente: <strong className="font-mono">{formatearMoneda(vigente.precio)}</strong>
          </span>
        ) : undefined
      }
    >
      <CampoSelector
        id="pr-lista"
        rotulo="Lista"
        valor={listaPrecioId}
        vacio="Elegi la lista"
        opciones={listas.map((l) => ({ valor: l.id, etiqueta: l.nombre }))}
        alCambiar={(v) => setListaPrecioId(v === '' ? '' : Number(v))}
      />
      <CampoSelector
        id="pr-art"
        rotulo="Producto"
        valor={articuloId}
        vacio="Elegi el producto"
        opciones={articulos.map((a) => ({ valor: a.id, etiqueta: `${a.codigo} · ${a.nombre}` }))}
        alCambiar={(v) => setArticuloId(v === '' ? '' : Number(v))}
      />
      <CampoMoneda
        id="pr-precio"
        rotulo={`Precio por ${articulo?.unidadAbreviatura ?? 'unidad'}`}
        centavos={precio}
        alCambiar={setPrecio}
        ayuda={
          articulo?.unidadesPorCaja != null
            ? `La caja de ${articulo.unidadesPorCaja} sale ${formatearMoneda(precio * articulo.unidadesPorCaja)}.`
            : undefined
        }
      />
    </ModalFormulario>
  );
}

export function FormularioNuevaLista({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    crearListaPrecio({ nombre })
      .then(() => alGuardar(`Lista "${nombre.trim()}" creada.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Nueva lista de precios"
      descripcion="Cada cliente puede tener la suya: mayorista, distribuidor, mostrador."
      error={error}
      guardando={guardando}
      puedeGuardar={nombre.trim().length >= 2}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoTexto
        id="li-nombre"
        rotulo="Nombre"
        valor={nombre}
        alCambiar={setNombre}
        requerido
        maximo={80}
        marcador="Distribuidores 2026"
      />
    </ModalFormulario>
  );
}
