/**
 * Dos herramientas que trabajan sobre muchos articulos a la vez:
 *
 *  - ACTUALIZACION DE PRECIOS. Con inflacion, tocar los precios de a uno no es
 *    viable. Nunca aplica a ciegas: primero se ve como queda cada articulo y
 *    recien despues se confirma, porque un porcentaje mal tipeado sobre toda la
 *    lista es muy caro de revertir.
 *
 *  - REPOSICION. Que falta comprar y a quien, saliendo del stock contra el
 *    minimo o el ideal. Agrupa por proveedor porque las compras se hacen por
 *    proveedor, no por articulo suelto.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Printer, RefreshCw, Undo2 } from 'lucide-react';

import {
  MODOS_ACTUALIZACION,
  REDONDEOS_PRECIO,
  type ArticuloConStock,
  type LineaReposicion,
  type ListaPrecioVista,
  type LotePrecio,
  type ModoActualizacion,
  type VistaPreviaPrecio,
} from '../../compartido/contratos';
import { Aviso } from '../componentes/Formulario';
import {
  aplicarPrecios,
  obtenerArticulos,
  obtenerListasPrecio,
  obtenerLotesPrecio,
  obtenerReposicion,
  revertirLotePrecio,
  vistaPreviaPrecios,
} from '../servicios/cliente';
import { aCentavos, formatearCantidad, formatearMoneda } from '../utiles/formato';

const CLASE_INPUT =
  'h-9 w-full rounded-ficha border border-masa-300 bg-white px-2 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';

const BOTON_BARRA =
  'inline-flex h-9 items-center gap-1.5 rounded-ficha border border-masa-300 px-3 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:opacity-40';

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

function descargarCsv(nombre: string, encabezados: string[], filas: string[][]): void {
  const csv = [encabezados, ...filas]
    .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
  enlace.download = `${nombre}-${new Date().toISOString().slice(0, 10)}.csv`;
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

/* -------------------------------------------------------------------------- */
/* Actualizacion masiva de precios                                            */
/* -------------------------------------------------------------------------- */

export function PantallaActualizacionPrecios(): JSX.Element {
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [listas, setListas] = useState<ListaPrecioVista[]>([]);
  const [elegidos, setElegidos] = useState<Set<number>>(new Set());
  const [busqueda, setBusqueda] = useState('');
  const [filtroFamilia, setFiltroFamilia] = useState('');

  const [listaPrecioId, setListaPrecioId] = useState<number | ''>('');
  const [sobreCosto, setSobreCosto] = useState(false);
  const [modo, setModo] = useState<ModoActualizacion>('porcentaje');
  const [valor, setValor] = useState('');
  const [redondeo, setRedondeo] = useState('ninguno');

  const [previa, setPrevia] = useState<VistaPreviaPrecio[] | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);
  const [lotes, setLotes] = useState<LotePrecio[]>([]);
  const [verHistorial, setVerHistorial] = useState(false);

  useEffect(() => {
    void obtenerArticulos()
      .then((l) => setArticulos(l.filter((a) => a.activo && a.tipo === 'producto_terminado')))
      .catch((c: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(c) }));
    void obtenerListasPrecio()
      .then((l) => {
        setListas(l);
        if (l[0] !== undefined) setListaPrecioId(l[0].id);
      })
      .catch(() => setListas([]));
    void obtenerLotesPrecio().then(setLotes).catch(() => setLotes([]));
  }, []);

  const familias = useMemo(
    () => [...new Set(articulos.map((a) => a.familiaNombre).filter((f): f is string => f !== null))],
    [articulos],
  );

  const visibles = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return articulos.filter((a) => {
      if (filtroFamilia !== '' && a.familiaNombre !== filtroFamilia) return false;
      if (texto === '') return true;
      return a.nombre.toLowerCase().includes(texto) || a.codigo.toLowerCase().includes(texto);
    });
  }, [articulos, busqueda, filtroFamilia]);

  const alternar = (id: number): void =>
    setElegidos((previos) => {
      const siguiente = new Set(previos);
      if (siguiente.has(id)) siguiente.delete(id);
      else siguiente.add(id);
      return siguiente;
    });

  const todosVisiblesElegidos = visibles.length > 0 && visibles.every((a) => elegidos.has(a.id));

  const entrada = (): {
    articuloIds: number[];
    listaPrecioId: number;
    sobreCosto: boolean;
    modo: ModoActualizacion;
    valor: number;
    redondeo: string;
  } | null => {
    if (listaPrecioId === '' || elegidos.size === 0) return null;
    const numero = Number(valor.replace(',', '.'));
    if (!Number.isFinite(numero)) return null;
    return {
      articuloIds: [...elegidos],
      listaPrecioId,
      sobreCosto,
      modo,
      // El porcentaje va tal cual; el monto y el precio exacto, en centavos.
      valor: modo === 'porcentaje' ? numero : aCentavos(numero),
      redondeo,
    };
  };

  const verPrevia = (): void => {
    const datos = entrada();
    if (datos === null) return;
    setTrabajando(true);
    setAviso(null);
    vistaPreviaPrecios(datos)
      .then(setPrevia)
      .catch((c: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(c) }))
      .finally(() => setTrabajando(false));
  };

  const aplicar = (): void => {
    const datos = entrada();
    if (datos === null || previa === null) return;
    const suben = previa.filter((p) => p.precioNuevo > p.precioActual).length;
    if (!window.confirm(`¿Aplicar el cambio a ${previa.length} articulo(s)? (${suben} suben de precio)`)) return;
    setTrabajando(true);
    aplicarPrecios(datos)
      .then((r) => {
        setPrevia(null);
        setElegidos(new Set());
        setAviso({
          tono: 'ok',
          texto: `${r.actualizados} precio(s) actualizados. Si te equivocaste, se puede deshacer desde el historial.`,
        });
        void obtenerLotesPrecio().then(setLotes).catch(() => undefined);
        return obtenerArticulos().then((l) =>
          setArticulos(l.filter((a) => a.activo && a.tipo === 'producto_terminado')),
        );
      })
      .catch((c: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(c) }))
      .finally(() => setTrabajando(false));
  };

  /** Deshacer devuelve los precios al valor anterior al lote. */
  const deshacer = (lote: LotePrecio): void => {
    if (!window.confirm(`¿Deshacer "${lote.descripcion}"? Los precios vuelven a como estaban antes.`)) return;
    setTrabajando(true);
    revertirLotePrecio(lote.id)
      .then((r) => {
        setAviso({ tono: 'ok', texto: `${r.revertidos} precio(s) volvieron al valor anterior.` });
        return Promise.all([
          obtenerLotesPrecio().then(setLotes),
          obtenerArticulos().then((l) =>
            setArticulos(l.filter((a) => a.activo && a.tipo === 'producto_terminado')),
          ),
        ]);
      })
      .catch((c: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(c) }))
      .finally(() => setTrabajando(false));
  };

  const rotuloValor =
    modo === 'porcentaje' ? 'Porcentaje (%)' : modo === 'monto_fijo' ? 'Monto a sumar ($)' : 'Precio exacto ($)';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <p className="shrink-0 text-sm text-masa-800">
        Marcá los articulos, definí el cambio y mirá como queda antes de aplicarlo.
      </p>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      {/* Seleccion */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-sm text-masa-800">
          <input
            type="checkbox"
            checked={todosVisiblesElegidos}
            onChange={(e) =>
              setElegidos(e.target.checked ? new Set(visibles.map((a) => a.id)) : new Set())
            }
            className="h-4 w-4"
          />
          Marcar todos ({visibles.length})
        </label>
        <select
          value={filtroFamilia}
          onChange={(e) => setFiltroFamilia(e.target.value)}
          className="h-9 rounded-ficha border border-masa-300 bg-white px-2 text-sm"
        >
          <option value="">Todas las familias</option>
          {familias.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar..."
          aria-label="Buscar articulo"
          className={`${CLASE_INPUT} w-56`}
        />
        <span className="text-sm font-semibold text-masa-900">{elegidos.size} elegido(s)</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setVerHistorial((v) => !v)}
          className={BOTON_BARRA}
          title="Actualizaciones anteriores, con la opcion de deshacerlas"
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          Historial ({lotes.filter((l) => !l.revertido).length})
        </button>
      </div>

      {verHistorial && (
        <div className="max-h-52 shrink-0 overflow-auto rounded-ficha border border-masa-200 bg-white">
          {lotes.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-masa-700">
              Todavia no se hizo ninguna actualizacion masiva.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-masa-50">
                <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
                  <th scope="col" className="px-3 py-2">Cuando</th>
                  <th scope="col" className="px-3 py-2">Que se hizo</th>
                  <th scope="col" className="px-3 py-2 text-right">Articulos</th>
                  <th scope="col" className="px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lotes.map((l) => (
                  <tr key={l.id} className={`border-t border-masa-100 ${l.revertido ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-xs">
                      {new Date(l.fecha).toLocaleString('es-AR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-1.5">{l.descripcion}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{l.cantidadArticulos}</td>
                    <td className="px-3 py-1.5">
                      {l.revertido ? (
                        <span className="text-xs text-masa-700">Deshecho</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => deshacer(l)}
                          disabled={trabajando}
                          className="rounded-pastilla border border-peligro-300 px-2 py-0.5 text-xs font-medium text-peligro-600 outline-none hover:bg-peligro-50 disabled:opacity-40"
                        >
                          Deshacer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Lista con la previa al costado cuando existe */}
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="min-h-0 flex-1 overflow-auto rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-masa-50">
              <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
                <th scope="col" className="w-10 px-3 py-2"> </th>
                <th scope="col" className="px-3 py-2">Codigo</th>
                <th scope="col" className="px-3 py-2">Articulo</th>
                <th scope="col" className="px-3 py-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => alternar(a.id)}
                  className={[
                    'cursor-pointer border-t border-masa-100',
                    elegidos.has(a.id) ? 'bg-dulce-50' : 'hover:bg-masa-50',
                  ].join(' ')}
                >
                  <td className="px-3 py-1.5">
                    <input
                      type="checkbox"
                      checked={elegidos.has(a.id)}
                      onChange={() => alternar(a.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Elegir ${a.nombre}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-1.5 font-mono text-xs">{a.codigo}</td>
                  <td className="px-3 py-1.5">{a.nombre}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {a.costoActual === null ? '—' : formatearMoneda(a.costoActual)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {previa !== null && (
          <div className="min-h-0 w-[46%] shrink-0 overflow-auto rounded-ficha border-2 border-dulce-300 bg-white">
            <div className="sticky top-0 flex items-center justify-between border-b border-masa-200 bg-dulce-50 px-3 py-2">
              <h2 className="text-sm font-semibold text-masa-900">Como queda</h2>
              <button type="button" onClick={() => setPrevia(null)} className="text-xs text-masa-700 underline">
                Cerrar
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-masa-50">
                <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
                  <th scope="col" className="px-3 py-2">Articulo</th>
                  <th scope="col" className="px-3 py-2 text-right">Antes</th>
                  <th scope="col" className="px-3 py-2 text-right">Despues</th>
                  <th scope="col" className="px-3 py-2 text-right">Var.</th>
                </tr>
              </thead>
              <tbody>
                {previa.map((p) => (
                  <tr key={p.articuloId} className="border-t border-masa-100">
                    <td className="px-3 py-1.5">{p.nombre}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-masa-700">
                      {formatearMoneda(p.precioActual)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                      {formatearMoneda(p.precioNuevo)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums">
                      {p.variacionPct === null ? (
                        <span className="text-masa-700">nuevo</span>
                      ) : (
                        <span className={p.variacionPct >= 0 ? 'text-menta-700' : 'text-peligro-600'}>
                          {p.variacionPct > 0 ? '+' : ''}
                          {p.variacionPct}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Regla */}
      <section className="shrink-0 rounded-ficha border-2 border-masa-300 bg-white p-3">
        <div className="grid grid-cols-12 items-end gap-3">
          <div className="col-span-3">
            <label htmlFor="ap-lista" className="mb-1 block text-micro font-semibold uppercase tracking-wide text-masa-700">
              Sobre que precio
            </label>
            <select
              id="ap-lista"
              value={sobreCosto ? 'costo' : String(listaPrecioId)}
              onChange={(e) => {
                if (e.target.value === 'costo') setSobreCosto(true);
                else {
                  setSobreCosto(false);
                  setListaPrecioId(Number(e.target.value));
                }
              }}
              className={CLASE_INPUT}
            >
              {listas.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  Lista {l.nombre}
                </option>
              ))}
              <option value="costo">Costo de compra</option>
            </select>
          </div>
          <div className="col-span-3">
            <label htmlFor="ap-modo" className="mb-1 block text-micro font-semibold uppercase tracking-wide text-masa-700">
              Tipo de cambio
            </label>
            <select
              id="ap-modo"
              value={modo}
              onChange={(e) => setModo(e.target.value as ModoActualizacion)}
              className={CLASE_INPUT}
            >
              {MODOS_ACTUALIZACION.map((m) => (
                <option key={m} value={m}>
                  {m === 'porcentaje' ? 'Aumentar/bajar %' : m === 'monto_fijo' ? 'Sumar monto' : 'Fijar precio'}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label htmlFor="ap-valor" className="mb-1 block text-micro font-semibold uppercase tracking-wide text-masa-700">
              {rotuloValor}
            </label>
            <input
              id="ap-valor"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              inputMode="decimal"
              placeholder={modo === 'porcentaje' ? '15' : '0,00'}
              className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
            />
          </div>
          <div className="col-span-2">
            <label htmlFor="ap-red" className="mb-1 block text-micro font-semibold uppercase tracking-wide text-masa-700">
              Redondeo
            </label>
            <select id="ap-red" value={redondeo} onChange={(e) => setRedondeo(e.target.value)} className={CLASE_INPUT}>
              {REDONDEOS_PRECIO.map((r) => (
                <option key={r.valor} value={r.valor}>
                  {r.etiqueta}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2 flex gap-2">
            <button
              type="button"
              onClick={verPrevia}
              disabled={trabajando || entrada() === null}
              className={`${BOTON_BARRA} flex-1 justify-center`}
            >
              Ver como queda
            </button>
          </div>
        </div>

        {previa !== null && (
          <div className="mt-3 flex items-center gap-3 border-t border-masa-200 pt-3">
            <button
              type="button"
              onClick={aplicar}
              disabled={trabajando}
              className="inline-flex h-9 items-center rounded-ficha bg-dulce-600 px-5 text-sm font-bold text-white outline-none hover:bg-dulce-700 disabled:bg-masa-300"
            >
              {trabajando ? 'Aplicando...' : `Aplicar a ${previa.length} articulo(s)`}
            </button>
            <span className="text-sm text-masa-700">
              Revisá la columna de la derecha antes de confirmar.
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Reposicion: que comprar                                                    */
/* -------------------------------------------------------------------------- */

export function PantallaReposicion(): JSX.Element {
  const [criterio, setCriterio] = useState<'minimo' | 'ideal'>('ideal');
  const [lineas, setLineas] = useState<LineaReposicion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback((cual: 'minimo' | 'ideal') => {
    setCargando(true);
    setError(null);
    obtenerReposicion(cual)
      .then(setLineas)
      .catch((c: unknown) => setError(mensajeDeError(c)))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => cargar(criterio), [cargar, criterio]);

  // Lo que falta se repone de dos maneras distintas y no se pueden mezclar: los
  // insumos se le compran a un proveedor, los alfajores se producen.
  const aComprar = useMemo(() => lineas.filter((l) => l.comoSeRepone === 'comprar'), [lineas]);
  const aProducir = useMemo(() => lineas.filter((l) => l.comoSeRepone === 'producir'), [lineas]);

  const porProveedor = useMemo(() => {
    const mapa = new Map<string, LineaReposicion[]>();
    for (const l of aComprar) {
      const clave = l.proveedorNombre ?? 'Sin proveedor asignado';
      mapa.set(clave, [...(mapa.get(clave) ?? []), l]);
    }
    return [...mapa.entries()];
  }, [aComprar]);

  const total = aComprar.reduce((s, l) => s + (l.costoEstimado ?? 0), 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
          {(
            [
              ['ideal', 'Reponer hasta el ideal'],
              ['minimo', 'Solo lo que esta bajo el minimo'],
            ] as const
          ).map(([valor, etiqueta]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setCriterio(valor)}
              className={[
                'rounded-pastilla px-3 py-1.5 text-sm font-medium outline-none',
                criterio === valor ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
              ].join(' ')}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => cargar(criterio)} className={BOTON_BARRA}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Actualizar
        </button>
        <button type="button" onClick={() => window.print()} className={BOTON_BARRA}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </button>
        <button
          type="button"
          onClick={() =>
            descargarCsv(
              'reposicion',
              ['Proveedor', 'Codigo', 'Articulo', 'Stock', 'Objetivo', 'A pedir', 'Unidad', 'Costo estimado'],
              lineas.map((l) => [
                l.proveedorNombre ?? '', l.codigo, l.nombre, String(l.stock), String(l.objetivo),
                String(l.aPedir), l.unidadAbreviatura,
                l.costoEstimado === null ? '' : (l.costoEstimado / 100).toFixed(2),
              ]),
            )
          }
          disabled={lineas.length === 0}
          className={BOTON_BARRA}
        >
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          Excel
        </button>

        <div className="flex-1" />
        {total > 0 && (
          <span className="text-sm text-masa-800">
            Costo estimado de la compra: <strong className="font-mono">{formatearMoneda(total)}</strong>
          </span>
        )}
      </div>

      {error !== null && <Aviso tono="mal" texto={error} />}

      <div className="min-h-0 flex-1 overflow-auto">
        {cargando ? (
          <p className="px-3 py-8 text-center text-masa-700">Calculando que falta...</p>
        ) : lineas.length === 0 ? (
          <div className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-10 text-center">
            <p className="font-semibold text-masa-900">No hay nada para reponer</p>
            <p className="mt-1 text-sm text-masa-700">
              {criterio === 'ideal'
                ? 'Todo el stock esta en su nivel ideal, o falta cargar el stock ideal en los articulos.'
                : 'Ningun articulo esta por debajo de su minimo.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {aProducir.length > 0 && (
              <section>
                <div className="mb-1 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
                    Hay que producir
                  </h2>
                  <span className="text-xs text-masa-700">
                    {aProducir.length} producto(s) · se reponen con una orden de produccion, no
                    comprando
                  </span>
                </div>
                <div className="overflow-hidden rounded-ficha border border-dulce-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-dulce-50">
                      <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
                        <th scope="col" className="px-3 py-2">Codigo</th>
                        <th scope="col" className="px-3 py-2">Producto</th>
                        <th scope="col" className="px-3 py-2 text-right">Tiene</th>
                        <th scope="col" className="px-3 py-2 text-right">Objetivo</th>
                        <th scope="col" className="px-3 py-2 text-right">A producir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aProducir.map((l) => (
                        <tr key={l.articuloId} className="border-t border-masa-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{l.codigo}</td>
                          <td className="px-3 py-1.5">{l.nombre}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-peligro-600">
                            {formatearCantidad(l.stock)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-masa-700">
                            {formatearCantidad(l.objetivo)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                            {formatearCantidad(l.aPedir)} {l.unidadAbreviatura}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-micro text-masa-700">
                  Planificalos desde Produccion → Ordenes.
                </p>
              </section>
            )}

            {aComprar.length > 0 && (
              <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
                Hay que comprar
              </h2>
            )}

            {porProveedor.map(([proveedor, items]) => (
              <section key={proveedor}>
                <div className="mb-1 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
                    {proveedor}
                  </h2>
                  <span className="text-xs text-masa-700">
                    {items.length} articulo(s) ·{' '}
                    {formatearMoneda(items.reduce((s, l) => s + (l.costoEstimado ?? 0), 0))}
                  </span>
                </div>
                <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-masa-50">
                      <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
                        <th scope="col" className="px-3 py-2">Codigo</th>
                        <th scope="col" className="px-3 py-2">Articulo</th>
                        <th scope="col" className="px-3 py-2 text-right">Tiene</th>
                        <th scope="col" className="px-3 py-2 text-right">Objetivo</th>
                        <th scope="col" className="px-3 py-2 text-right">A pedir</th>
                        <th scope="col" className="px-3 py-2 text-right">Costo estimado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((l) => (
                        <tr key={l.articuloId} className="border-t border-masa-100">
                          <td className="px-3 py-1.5 font-mono text-xs">{l.codigo}</td>
                          <td className="px-3 py-1.5">{l.nombre}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-peligro-600">
                            {formatearCantidad(l.stock)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-masa-700">
                            {formatearCantidad(l.objetivo)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-semibold tabular-nums">
                            {formatearCantidad(l.aPedir)} {l.unidadAbreviatura}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                            {l.costoEstimado === null ? '—' : formatearMoneda(l.costoEstimado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
