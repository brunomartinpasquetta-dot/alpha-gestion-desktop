/**
 * ABM de PROMOCIONES (combos), copiado del modulo de StockFlow.
 *
 * Una promo agrupa articulos con sus cantidades y se vende como UN renglon al
 * precio elegido; al venderse el stock se descuenta de los COMPONENTES. Se
 * muestra el costo real (Σ unidades × costo de cada componente) y el margen en
 * vivo, que es lo que evita armar un combo que pierde plata.
 *
 * Dos cosas que agrega Alpha y StockFlow no tiene:
 *  - Precio por LISTA (hasta 4 listas, y las derivadas se resuelven solas).
 *  - VIGENCIA: una promo con fecha de fin deja de liquidar cuando vence, y el
 *    corte esta en el servidor, no aca.
 */

import { useMemo, useState } from 'react';

import type {
  ArticuloConStock,
  ListaPrecioVista,
  PromocionVista,
} from '../../compartido/contratos';
import { Pastilla, Seccion } from '../componentes/comunes';
import { CampoFecha, CampoTexto, ModalFormulario } from '../componentes/Formulario';
import { Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  actualizarPromocion,
  cambiarActivoPromocion,
  crearPromocion,
  obtenerArticulos,
  obtenerListasPrecio,
  obtenerPromociones,
} from '../servicios/cliente';
import { aCentavos, formatearMoneda } from '../utiles/formato';

interface RenglonForm {
  articuloId: number;
  nombre: string;
  codigo: string;
  costo: number;
  unidades: string;
}

export function PantallaPromociones(): JSX.Element {
  const promos = usarRecurso<PromocionVista[]>(() => obtenerPromociones(), []);
  const articulos = usarRecurso<ArticuloConStock[]>(() => obtenerArticulos(), []);
  const listas = usarRecurso<ListaPrecioVista[]>(() => obtenerListasPrecio(), []);
  const [editando, setEditando] = useState<PromocionVista | 'nueva' | null>(null);
  const [error, setError] = useState<string | null>(null);

  usarEventos('promociones:cambio', () => promos.recargar());

  const alternar = (promo: PromocionVista): void => {
    setError(null);
    cambiarActivoPromocion(promo.id, !promo.activo)
      .then(() => promos.recargar())
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)));
  };

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Promociones"
        acciones={
          <button
            type="button"
            onClick={() => {
              setError(null);
              setEditando('nueva');
            }}
            className="h-9 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase tracking-wide text-white"
          >
            Nueva promo
          </button>
        }
      >
        {error !== null && (
          <p className="mb-2 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-1.5 text-sm text-peligro-700">
            {error}
          </p>
        )}

        <Vista
          estado={promos}
          que="las promociones"
          tituloVacio="Todavia no hay promociones"
          detalleVacio="Una promo agrupa articulos y se vende a un precio propio. Crea la primera con Nueva promo."
        >
          {(lista) => (
            <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                    <th className="px-3 py-2 font-semibold">Codigo</th>
                    <th className="px-3 py-2 font-semibold">Promocion</th>
                    <th className="px-3 py-2 font-semibold">Incluye</th>
                    <th className="px-3 py-2 font-semibold">Vigencia</th>
                    <th className="px-3 py-2 text-right font-semibold">Costo</th>
                    <th className="px-3 py-2 text-right font-semibold">Precio</th>
                    <th className="px-3 py-2 text-right font-semibold">Margen</th>
                    <th className="px-3 py-2 font-semibold">Estado</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {lista.map((promo) => {
                    // El margen se mide contra la lista 1, que es la de mostrador:
                    // es el piso. Si ahi ya pierde, en las demas tambien.
                    const precio = promo.precios[0]?.precio ?? 0;
                    const margen = precio - promo.costoComponentes;
                    const pct =
                      promo.costoComponentes > 0 ? (margen / promo.costoComponentes) * 100 : 0;
                    return (
                      <tr
                        key={promo.id}
                        className={[
                          'border-b border-masa-100',
                          !promo.vigenteHoy ? 'opacity-60' : '',
                        ].join(' ')}
                      >
                        <td className="px-3 py-2 font-mono text-xs text-masa-700">{promo.codigo}</td>
                        <td className="px-3 py-2 font-medium text-masa-900">{promo.nombre}</td>
                        <td className="px-3 py-2 text-xs text-masa-700">
                          {promo.componentes
                            .map((c) => `${c.unidades}× ${c.articuloNombre}`)
                            .join(' + ')}
                        </td>
                        <td className="px-3 py-2 text-xs text-masa-700">
                          {promo.vigenciaDesde === null && promo.vigenciaHasta === null
                            ? 'Sin limite'
                            : `${promo.vigenciaDesde ?? 'ya'} → ${promo.vigenciaHasta ?? 'sin fin'}`}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-700">
                          {formatearMoneda(promo.costoComponentes)}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-masa-900">
                          {formatearMoneda(precio)}
                        </td>
                        <td
                          className={[
                            'px-3 py-2 text-right font-mono tabular-nums',
                            margen < 0 ? 'font-semibold text-peligro-700' : 'text-menta-800',
                          ].join(' ')}
                        >
                          {formatearMoneda(margen)}
                          {promo.costoComponentes > 0 && ` (${pct.toFixed(0)}%)`}
                        </td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => alternar(promo)}>
                            <Pastilla
                              texto={promo.vigenteHoy ? 'Vigente' : (promo.motivoNoVigente ?? 'Inactiva')}
                              tono={promo.vigenteHoy ? 'positivo' : 'neutro'}
                            />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="text-sm text-dulce-700 underline"
                            onClick={() => {
                              setError(null);
                              setEditando(promo);
                            }}
                          >
                            Editar
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Vista>
      </Seccion>

      {editando !== null && (
        <FormularioPromocion
          promo={editando === 'nueva' ? null : editando}
          articulos={articulos.datos ?? []}
          listas={listas.datos ?? []}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null);
            promos.recargar();
          }}
        />
      )}
    </div>
  );
}

function FormularioPromocion({
  promo,
  articulos,
  listas,
  alCerrar,
  alGuardar,
}: {
  readonly promo: PromocionVista | null;
  readonly articulos: readonly ArticuloConStock[];
  readonly listas: readonly ListaPrecioVista[];
  readonly alCerrar: () => void;
  readonly alGuardar: () => void;
}): JSX.Element {
  const [nombre, setNombre] = useState(promo?.nombre ?? '');
  const [codigo, setCodigo] = useState(promo?.codigo ?? '');
  const [desde, setDesde] = useState(promo?.vigenciaDesde ?? '');
  const [hasta, setHasta] = useState(promo?.vigenciaHasta ?? '');
  const [busqueda, setBusqueda] = useState('');
  const [renglones, setRenglones] = useState<RenglonForm[]>(() =>
    (promo?.componentes ?? []).map((c) => {
      const articulo = articulos.find((a) => a.id === c.articuloId);
      return {
        articuloId: c.articuloId,
        nombre: c.articuloNombre,
        codigo: c.articuloCodigo,
        costo: articulo?.costoActual ?? 0,
        unidades: String(c.unidades),
      };
    }),
  );
  // Solo las listas BASE llevan precio propio: las derivadas salen del recargo.
  const listasBase = listas.filter((l) => l.baseListaId === null);
  const [precios, setPrecios] = useState<Record<number, string>>(() => {
    const inicial: Record<number, string> = {};
    for (const lista of listas) {
      const cargado = promo?.precios.find((p) => p.listaPrecioId === lista.id);
      inicial[lista.id] = cargado === undefined ? '' : String(cargado.precio / 100);
    }
    return inicial;
  });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const candidatos = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const elegidos = new Set(renglones.map((r) => r.articuloId));
    return articulos
      .filter(
        (a) =>
          a.activo &&
          !elegidos.has(a.id) &&
          (q === '' ||
            a.nombre.toLowerCase().includes(q) ||
            a.codigo.toLowerCase().includes(q)),
      )
      .slice(0, 30);
  }, [articulos, busqueda, renglones]);

  const costo = renglones.reduce(
    (suma, r) => suma + Math.round(r.costo * (Number(r.unidades.replace(',', '.')) || 0)),
    0,
  );
  const precioPrimera = aCentavos(
    Number((precios[listasBase[0]?.id ?? 0] ?? '').replace(',', '.')) || 0,
  );
  const margen = precioPrimera - costo;

  const guardar = (): void => {
    if (guardando) return;
    const componentes = renglones.map((r) => ({
      articuloId: r.articuloId,
      unidades: Number(r.unidades.replace(',', '.')) || 0,
    }));
    const preciosCargados = listasBase
      .map((l) => ({
        listaPrecioId: l.id,
        precio: aCentavos(Number((precios[l.id] ?? '').replace(',', '.')) || 0),
      }))
      .filter((p) => p.precio > 0);

    if (componentes.length === 0) {
      setError('Agrega al menos un articulo a la promo.');
      return;
    }
    if (preciosCargados.length === 0) {
      setError('Carga el precio de la promo en al menos una lista.');
      return;
    }
    setGuardando(true);
    setError(null);
    const entrada = {
      nombre: nombre.trim(),
      codigo: codigo.trim(),
      vigenciaDesde: desde === '' ? null : desde,
      vigenciaHasta: hasta === '' ? null : hasta,
      componentes,
      precios: preciosCargados,
    };
    const operacion =
      promo === null ? crearPromocion(entrada) : actualizarPromocion(promo.id, entrada);
    operacion.then(alGuardar).catch((causa: unknown) => {
      setError(causa instanceof Error ? causa.message : String(causa));
      setGuardando(false);
    });
  };

  return (
    <ModalFormulario
      titulo={promo === null ? 'Nueva promocion' : `Editando ${promo.nombre}`}
      descripcion="Al vender la promo el stock sale de los articulos que la componen, no de la promo."
      error={error}
      guardando={guardando}
      ancho="max-w-3xl"
      puedeGuardar={nombre.trim().length >= 2 && codigo.trim() !== '' && renglones.length > 0}
      etiquetaGuardar={promo === null ? 'Crear promocion' : 'Guardar cambios'}
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        <span className="text-sm text-masa-800">
          Costo <strong className="font-mono">{formatearMoneda(costo)}</strong> · Margen{' '}
          <strong className={`font-mono ${margen < 0 ? 'text-peligro-700' : 'text-menta-800'}`}>
            {formatearMoneda(margen)}
          </strong>
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CampoTexto id="promo-nombre" rotulo="Nombre" valor={nombre} alCambiar={setNombre} maximo={120} />
        <CampoTexto
          id="promo-codigo"
          rotulo="Codigo"
          valor={codigo}
          alCambiar={setCodigo}
          maximo={30}
          ayuda="Corto, para el talonario: PROMO-1, COMBO-DOC."
        />
        <CampoFecha
          id="promo-desde"
          rotulo="Vigente desde"
          valor={desde}
          alCambiar={setDesde}
          ayuda="Vacio = arranca ya."
        />
        <CampoFecha
          id="promo-hasta"
          rotulo="Vigente hasta"
          valor={hasta}
          alCambiar={setHasta}
          ayuda="Vacio = sin vencimiento."
        />
      </div>

      {/* Composicion */}
      <div className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-masa-700">
          Que incluye la promo
        </h3>
        {renglones.length === 0 ? (
          <p className="mb-2 text-sm text-masa-700">Todavia no agregaste articulos.</p>
        ) : (
          <table className="mb-2 w-full text-sm">
            <tbody>
              {renglones.map((r) => (
                <tr key={r.articuloId} className="border-b border-masa-200 last:border-0">
                  <td className="py-1.5 font-mono text-xs text-masa-700">{r.codigo}</td>
                  <td className="py-1.5 text-masa-900">{r.nombre}</td>
                  <td className="py-1.5 text-right">
                    <input
                      className="h-8 w-20 rounded-ficha border border-masa-300 bg-white px-2 text-right text-sm"
                      value={r.unidades}
                      onChange={(e) =>
                        setRenglones((prev) =>
                          prev.map((x) =>
                            x.articuloId === r.articuloId ? { ...x, unidades: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </td>
                  <td className="py-1.5 pl-2 text-right font-mono text-xs text-masa-700">
                    {formatearMoneda(
                      Math.round(r.costo * (Number(r.unidades.replace(',', '.')) || 0)),
                    )}
                  </td>
                  <td className="py-1.5 pl-2 text-right">
                    <button
                      type="button"
                      className="text-sm text-peligro-700 underline"
                      onClick={() =>
                        setRenglones((prev) => prev.filter((x) => x.articuloId !== r.articuloId))
                      }
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <input
          className="h-9 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm"
          placeholder="Buscar articulo para agregar…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {busqueda.trim() !== '' && (
          <div className="mt-1 max-h-40 overflow-auto rounded-ficha border border-masa-200 bg-white">
            {candidatos.length === 0 ? (
              <p className="px-3 py-2 text-sm text-masa-700">Sin resultados.</p>
            ) : (
              candidatos.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="flex w-full items-center justify-between border-b border-masa-100 px-3 py-1.5 text-left text-sm last:border-0 hover:bg-masa-50"
                  onClick={() => {
                    setRenglones((prev) => [
                      ...prev,
                      {
                        articuloId: a.id,
                        nombre: a.nombre,
                        codigo: a.codigo,
                        costo: a.costoActual ?? 0,
                        unidades: '1',
                      },
                    ]);
                    setBusqueda('');
                  }}
                >
                  <span>
                    <span className="font-mono text-xs text-masa-700">{a.codigo}</span> {a.nombre}
                  </span>
                  <span className="font-mono text-xs text-masa-700">
                    {formatearMoneda(a.costoActual ?? 0)}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Precio por lista */}
      <div className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-masa-700">
          Precio de la promo por lista
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {listasBase.map((lista) => (
            <div key={lista.id}>
              <label
                className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700"
                htmlFor={`promo-precio-${lista.id}`}
              >
                {lista.nombre}
              </label>
              <input
                id={`promo-precio-${lista.id}`}
                className="h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm"
                placeholder="0,00"
                value={precios[lista.id] ?? ''}
                onChange={(e) =>
                  setPrecios((prev) => ({ ...prev, [lista.id]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
        {listas.some((l) => l.baseListaId !== null) && (
          <p className="mt-2 text-xs text-masa-700">
            Las listas derivadas toman este precio y le aplican su recargo: no hay que cargarlas.
          </p>
        )}
      </div>
    </ModalFormulario>
  );
}
