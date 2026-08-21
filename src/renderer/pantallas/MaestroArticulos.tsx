/**
 * Maestro de articulos con el patron de StockFlow: barra de acciones arriba,
 * grilla en el medio y el detalle SIEMPRE visible abajo.
 *
 * No es un modal por una razon concreta: quien carga articulos carga muchos
 * seguidos, y un modal obliga a abrir, guardar y cerrar por cada uno. Con el
 * panel fijo se recorre la lista con las flechas y los datos del articulo
 * seleccionado estan a la vista sin abrir nada.
 *
 * Tres modos: ver (solo lectura), editar y crear. Los atajos son los mismos que
 * en StockFlow —Ctrl+N nuevo, Ctrl+E modificar, Ctrl+F buscar, Escape cancela—
 * porque el operador que ya usa aquel sistema no tiene que reaprender nada.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, History, Pencil, Plus, Printer, Search, Trash2, X } from 'lucide-react';

import {
  ALICUOTAS_IVA_UI,
  ETIQUETA_TIPO_ARTICULO,
  type ArticuloConStock,
  type EntradaArticulo,
  type FamiliaVista,
  type PrecioDeArticulo,
  type ProveedorVista,
  type TipoArticulo,
  type UnidadMedidaVista,
} from '../../compartido/contratos';
import { TablaMovimientosStock } from './StockAjustes';
import { Pastilla } from '../componentes/comunes';
import { Aviso } from '../componentes/Formulario';
import { PanelLedger } from '../componentes/PanelLedger';
import {
  actualizarArticulo,
  cambiarActivoArticulo,
  crearArticulo,
  crearFamilia,
  crearProveedor,
  fijarPreciosDeArticulo,
  obtenerArticulos,
  obtenerFamilias,
  obtenerPreciosDeArticulo,
  obtenerProveedores,
  obtenerUnidades,
} from '../servicios/cliente';
import { aCentavos, formatearCantidad, formatearMoneda } from '../utiles/formato';

type Modo = 'ver' | 'editar' | 'crear';

interface EstadoFormulario {
  codigo: string;
  codigoBarras: string;
  nombre: string;
  marca: string;
  tipo: TipoArticulo;
  familiaId: number | '';
  proveedorHabitualId: number | '';
  alicuotaIva: number;
  unidadBaseId: number | '';
  unidadesPorCaja: string;
  costoActual: string;
  stockMin: string;
  stockIdeal: string;
  porPeso: boolean;
  notas: string;
  /** Un renglon por lista de precios, con su valor en PESOS como texto. */
  precios: { listaPrecioId: number; listaNombre: string; valor: string }[];
}

const FORMULARIO_VACIO: EstadoFormulario = {
  codigo: '',
  codigoBarras: '',
  nombre: '',
  marca: '',
  tipo: 'materia_prima',
  familiaId: '',
  proveedorHabitualId: '',
  alicuotaIva: 21,
  unidadBaseId: '',
  unidadesPorCaja: '12',
  costoActual: '',
  stockMin: '',
  stockIdeal: '',
  porPeso: false,
  notas: '',
  precios: [],
};

function aFormulario(a: ArticuloConStock, precios: PrecioDeArticulo[]): EstadoFormulario {
  return {
    codigo: a.codigo,
    codigoBarras: a.codigoBarras ?? '',
    nombre: a.nombre,
    marca: a.marca ?? '',
    tipo: a.tipo,
    familiaId: a.familiaId ?? '',
    proveedorHabitualId: a.proveedorHabitualId ?? '',
    alicuotaIva: a.alicuotaIva,
    unidadBaseId: a.unidadBaseId,
    unidadesPorCaja: a.unidadesPorCaja === null ? '' : String(a.unidadesPorCaja),
    costoActual: a.costoActual === null ? '' : String(a.costoActual / 100),
    stockMin: a.stockMin === null ? '' : String(a.stockMin),
    stockIdeal: a.stockIdeal === null ? '' : String(a.stockIdeal),
    porPeso: a.porPeso,
    notas: a.notas ?? '',
    precios: precios.map((p) => ({
      listaPrecioId: p.listaPrecioId,
      listaNombre: p.listaNombre,
      valor: p.precio === null ? '' : String(p.precio / 100),
    })),
  };
}

/**
 * Margen sobre el costo, en porcentaje. Es el numero que decide si un precio
 * tiene sentido, y por eso va al lado del precio y no en otra pantalla.
 */
function utilidad(precioPesos: string, costoPesos: string): string {
  const precio = Number(precioPesos.replace(',', '.'));
  const costo = Number(costoPesos.replace(',', '.'));
  if (!Number.isFinite(precio) || !Number.isFinite(costo) || costo <= 0 || precio <= 0) return '—';
  return `${(((precio - costo) / costo) * 100).toFixed(1)} %`;
}

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

/* -------------------------------------------------------------------------- */
/* Piezas visuales                                                            */
/* -------------------------------------------------------------------------- */

const CLASE_INPUT =
  'h-9 w-full rounded-ficha border border-masa-300 bg-white px-2 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-100 disabled:text-masa-700';

/** Campo con su rotulo, ocupando N columnas de la grilla de 12. */
function Campo({
  columnas,
  rotulo,
  children,
}: {
  readonly columnas: string;
  readonly rotulo: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className={columnas}>
      <label className="mb-1 block text-micro font-semibold uppercase tracking-wide text-masa-700">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

/** Valor calculado, no editable. Se ve distinto de un campo a proposito. */
function ValorCalculado({ children }: { readonly children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-9 items-center rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-2 font-mono text-sm tabular-nums text-masa-800">
      {children}
    </div>
  );
}

/**
 * Selector que ademas permite crear la opcion en el momento. Mandar al usuario a
 * otra pantalla para volver despues es lo que hace que los rubros y los
 * proveedores queden sin cargar.
 */
function SelectorConAlta({
  valor,
  opciones,
  vacio,
  deshabilitado,
  alCambiar,
  alCrear,
}: {
  readonly valor: number | '';
  readonly opciones: readonly { readonly id: number; readonly etiqueta: string }[];
  readonly vacio: string;
  readonly deshabilitado: boolean;
  readonly alCambiar: (id: number | '') => void;
  readonly alCrear: () => void;
}): JSX.Element {
  return (
    <div className="flex gap-1">
      <select
        value={valor}
        disabled={deshabilitado}
        onChange={(e) => alCambiar(e.target.value === '' ? '' : Number(e.target.value))}
        className={CLASE_INPUT}
      >
        <option value="">{vacio}</option>
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={alCrear}
        disabled={deshabilitado}
        title="Crear uno nuevo"
        className="h-9 shrink-0 rounded-ficha border border-masa-300 px-2 text-sm font-bold text-masa-800 outline-none hover:bg-masa-100 disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pantalla                                                                   */
/* -------------------------------------------------------------------------- */

export function MaestroArticulos({
  grupo,
  titulo,
  tipoNuevo,
}: {
  /** Que subconjunto se muestra. 'todos' es el maestro completo. */
  readonly grupo: 'insumos' | 'productos' | 'todos';
  readonly titulo: string;
  readonly tipoNuevo: TipoArticulo;
}): JSX.Element {
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [familias, setFamilias] = useState<FamiliaVista[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorVista[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedidaVista[]>([]);
  const [cargando, setCargando] = useState(true);

  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  const [modo, setModo] = useState<Modo>('ver');
  const [form, setForm] = useState<EstadoFormulario>(FORMULARIO_VACIO);
  const [busqueda, setBusqueda] = useState('');
  const [filtroFamilia, setFiltroFamilia] = useState('');
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verLedger, setVerLedger] = useState(false);
  const refBusqueda = useRef<HTMLInputElement>(null);

  const editando = modo !== 'ver';

  const recargar = useCallback(async (): Promise<ArticuloConStock[]> => {
    const todos = await obtenerArticulos();
    const visibles =
      grupo === 'todos'
        ? todos
        : todos.filter((a) =>
            grupo === 'insumos'
              ? a.tipo === 'materia_prima' || a.tipo === 'pre_elaborado'
              : a.tipo === 'producto_terminado',
          );
    setArticulos(visibles);
    setCargando(false);
    return visibles;
  }, [grupo]);

  useEffect(() => {
    void recargar().catch((causa: unknown) => {
      setAviso({ tono: 'mal', texto: mensajeDeError(causa) });
      setCargando(false);
    });
    void obtenerFamilias().then(setFamilias).catch(() => setFamilias([]));
    void obtenerProveedores()
      .then((l) => setProveedores(l.filter((p) => p.activo)))
      .catch(() => setProveedores([]));
    void obtenerUnidades().then(setUnidades).catch(() => setUnidades([]));
  }, [recargar]);

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return articulos.filter((a) => {
      if (filtroFamilia !== '' && String(a.familiaId ?? '') !== filtroFamilia) return false;
      if (texto === '') return true;
      return (
        a.codigo.toLowerCase().includes(texto) ||
        a.nombre.toLowerCase().includes(texto) ||
        (a.marca ?? '').toLowerCase().includes(texto) ||
        (a.codigoBarras ?? '').includes(texto)
      );
    });
  }, [articulos, busqueda, filtroFamilia]);

  const seleccionado = articulos.find((a) => a.id === seleccionadoId) ?? null;

  /** Al elegir una fila se cargan tambien sus precios, que viven aparte. */
  const seleccionar = (articulo: ArticuloConStock): void => {
    if (editando) return;
    setSeleccionadoId(articulo.id);
    void obtenerPreciosDeArticulo(articulo.id)
      .then((precios) => setForm(aFormulario(articulo, precios)))
      .catch(() => setForm(aFormulario(articulo, [])));
  };

  const empezarAlta = (): void => {
    setSeleccionadoId(null);
    setForm({
      ...FORMULARIO_VACIO,
      tipo: tipoNuevo,
      unidadBaseId: unidades[0]?.id ?? '',
      unidadesPorCaja: tipoNuevo === 'producto_terminado' ? '12' : '',
    });
    setModo('crear');
    setAviso(null);
  };

  const empezarEdicion = (): void => {
    if (seleccionado === null) return;
    setModo('editar');
    setAviso(null);
  };

  const cancelar = (): void => {
    setModo('ver');
    setAviso(null);
    if (seleccionado !== null) seleccionar(seleccionado);
    else setForm(FORMULARIO_VACIO);
  };

  const campo = <C extends keyof EstadoFormulario>(clave: C, valor: EstadoFormulario[C]): void =>
    setForm((f) => ({ ...f, [clave]: valor }));

  const guardar = async (): Promise<void> => {
    if (form.unidadBaseId === '') {
      setAviso({ tono: 'mal', texto: 'Elegi la unidad de medida.' });
      return;
    }
    const minimo = form.stockMin === '' ? null : Number(form.stockMin);
    const ideal = form.stockIdeal === '' ? null : Number(form.stockIdeal);
    if (minimo !== null && ideal !== null && ideal < minimo) {
      setAviso({ tono: 'mal', texto: 'El stock ideal no puede ser menor que el minimo.' });
      return;
    }

    setGuardando(true);
    setAviso(null);
    const entrada: EntradaArticulo = {
      codigo: form.codigo,
      nombre: form.nombre,
      tipo: form.tipo,
      unidadBaseId: form.unidadBaseId,
      stockMin: minimo,
      stockIdeal: ideal,
      codigoBarras: form.codigoBarras.trim() || null,
      marca: form.marca.trim() || null,
      familiaId: form.familiaId === '' ? null : form.familiaId,
      proveedorHabitualId: form.proveedorHabitualId === '' ? null : form.proveedorHabitualId,
      alicuotaIva: form.alicuotaIva,
      porPeso: form.porPeso,
      notas: form.notas.trim() || null,
      unidadesPorCaja:
        form.tipo === 'producto_terminado' && form.unidadesPorCaja !== ''
          ? Number(form.unidadesPorCaja)
          : null,
      costoActual: form.costoActual === '' ? null : aCentavos(Number(form.costoActual.replace(',', '.'))),
    };

    try {
      const guardado =
        modo === 'crear'
          ? await crearArticulo(entrada)
          : await actualizarArticulo(seleccionadoId as number, entrada);

      // Los precios van en su propio ledger: se fijan despues de tener el id.
      // Solo los productos terminados llevan precio de venta: los insumos se
      // compran, y el servidor rechaza ponerle precio a uno.
      const precios =
        form.tipo === 'producto_terminado'
          ? form.precios
              .filter((p) => p.valor.trim() !== '')
              .map((p) => ({
                listaPrecioId: p.listaPrecioId,
                precio: aCentavos(Number(p.valor.replace(',', '.'))),
              }))
          : [];
      if (precios.length > 0) await fijarPreciosDeArticulo(guardado.id, precios);

      const lista = await recargar();
      const actualizado = lista.find((a) => a.id === guardado.id) ?? null;
      setSeleccionadoId(guardado.id);
      setModo('ver');
      if (actualizado !== null) {
        const preciosNuevos = await obtenerPreciosDeArticulo(guardado.id).catch(() => []);
        setForm(aFormulario(actualizado, preciosNuevos));
      }
      setAviso({ tono: 'ok', texto: `${form.nombre} ${modo === 'crear' ? 'dado de alta' : 'actualizado'}.` });
    } catch (causa) {
      setAviso({ tono: 'mal', texto: mensajeDeError(causa) });
    } finally {
      setGuardando(false);
    }
  };

  const darDeBaja = (): void => {
    if (seleccionado === null) return;
    const alta = !seleccionado.activo;
    if (!alta && !window.confirm(`¿Dar de baja ${seleccionado.nombre}?`)) return;
    cambiarActivoArticulo(seleccionado.id, alta)
      .then(() => recargar())
      .then(() =>
        setAviso({
          tono: 'ok',
          texto: `${seleccionado.nombre} ${alta ? 'reactivado' : 'dado de baja'}.`,
        }),
      )
      .catch((causa: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(causa) }));
  };

  const nuevaFamilia = (): void => {
    const nombre = window.prompt('Nombre de la familia (rubro):');
    if (nombre === null || nombre.trim() === '') return;
    crearFamilia(nombre.trim())
      .then((f) => obtenerFamilias().then((lista) => {
        setFamilias(lista);
        campo('familiaId', f.id);
      }))
      .catch((causa: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(causa) }));
  };

  const nuevoProveedor = (): void => {
    const nombre = window.prompt('Nombre del proveedor:');
    if (nombre === null || nombre.trim() === '') return;
    crearProveedor({ nombre: nombre.trim() })
      .then((p) => obtenerProveedores().then((lista) => {
        setProveedores(lista.filter((x) => x.activo));
        campo('proveedorHabitualId', p.id);
      }))
      .catch((causa: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(causa) }));
  };

  /** Exporta lo que se ve en la grilla, con los filtros aplicados. */
  const exportarCsv = (): void => {
    const encabezados = [
      'Codigo', 'Codigo de barras', 'Articulo', 'Marca', 'Familia', 'Tipo', 'Unidad',
      'Proveedor habitual', 'Costo', 'IVA %', 'Stock', 'Stock minimo', 'Stock ideal',
      'A reponer', 'Estado',
    ];
    const filas = filtrados.map((a) => [
      a.codigo, a.codigoBarras ?? '', a.nombre, a.marca ?? '', a.familiaNombre ?? '',
      ETIQUETA_TIPO_ARTICULO[a.tipo], a.unidadAbreviatura, a.proveedorHabitualNombre ?? '',
      a.costoActual === null ? '' : (a.costoActual / 100).toFixed(2), String(a.alicuotaIva),
      String(a.stock), a.stockMin === null ? '' : String(a.stockMin),
      a.stockIdeal === null ? '' : String(a.stockIdeal), String(a.aReponer),
      a.activo ? 'Activo' : 'Inactivo',
    ]);
    // Punto y coma y BOM: es lo que abre bien el Excel en español sin importar nada.
    const csv = [encabezados, ...filas]
      .map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    enlace.download = `${grupo}-${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  };

  /* ------------------------------- Atajos -------------------------------- */

  useEffect(() => {
    const alPresionar = (e: KeyboardEvent): void => {
      const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement | null)?.tagName ?? '',
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        refBusqueda.current?.focus();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !editando) {
        e.preventDefault();
        empezarAlta();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && !editando) {
        e.preventDefault();
        empezarEdicion();
        return;
      }
      if (e.key === 'Escape' && editando) {
        e.preventDefault();
        cancelar();
        return;
      }
      // Recorrer la lista con las flechas, salvo mientras se escribe.
      if (!enCampo && !editando && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const indice = filtrados.findIndex((a) => a.id === seleccionadoId);
        const siguiente = e.key === 'ArrowDown' ? indice + 1 : indice - 1;
        const destino = filtrados[siguiente < 0 ? 0 : siguiente];
        if (destino !== undefined) seleccionar(destino);
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  });

  /* ------------------------------- Render -------------------------------- */

  const botonBarra =
    'inline-flex h-9 items-center gap-1.5 rounded-ficha border border-masa-300 px-3 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:opacity-40';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      {/* Barra de acciones */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-masa-200 pb-2">
        <button
          type="button"
          onClick={empezarAlta}
          disabled={editando}
          title="Nuevo (Ctrl+N)"
          className="inline-flex h-9 items-center gap-1.5 rounded-ficha bg-dulce-600 px-3 text-sm font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo
        </button>
        <button
          type="button"
          onClick={empezarEdicion}
          disabled={seleccionado === null || editando}
          title="Modificar (Ctrl+E)"
          className={botonBarra}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Modificar
        </button>
        <button
          type="button"
          onClick={darDeBaja}
          disabled={seleccionado === null || editando}
          title="Dar de baja"
          className={botonBarra}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {seleccionado !== null && !seleccionado.activo ? 'Reactivar' : 'Dar de baja'}
        </button>

        <span className="mx-1 h-6 w-px bg-masa-200" aria-hidden="true" />

        <button
          type="button"
          onClick={() => setVerLedger((v) => !v)}
          disabled={seleccionado === null}
          title="Ver de donde sale el stock de este articulo"
          className={botonBarra}
        >
          <History className="h-4 w-4" aria-hidden="true" />
          Movimientos
        </button>

        <span className="mx-1 h-6 w-px bg-masa-200" aria-hidden="true" />

        <button type="button" onClick={() => window.print()} title="Imprimir" className={botonBarra}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </button>
        <button type="button" onClick={exportarCsv} title="Exportar a Excel" className={botonBarra}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          Excel
        </button>

        <div className="flex-1" />

        <select
          value={filtroFamilia}
          onChange={(e) => setFiltroFamilia(e.target.value)}
          className="h-9 rounded-ficha border border-masa-300 bg-white px-2 text-sm text-masa-900 outline-none"
        >
          <option value="">Todas las familias</option>
          {familias.map((f) => (
            <option key={f.id} value={String(f.id)}>
              {f.nombre}
            </option>
          ))}
        </select>

        <div className="relative w-64">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-masa-700"
            aria-hidden="true"
          />
          <input
            ref={refBusqueda}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar (Ctrl+F)..."
            aria-label="Buscar articulo"
            className={`${CLASE_INPUT} pl-8`}
          />
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      {/* Grilla, con el ledger al costado cuando se pide */}
      <div className="flex min-h-0 flex-1 gap-2">
      <div className="min-h-0 flex-1 overflow-auto rounded-ficha border border-masa-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-masa-50">
            <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
              <th scope="col" className="px-3 py-2">Codigo</th>
              <th scope="col" className="px-3 py-2">Articulo</th>
              <th scope="col" className="px-3 py-2">Marca</th>
              <th scope="col" className="px-3 py-2">Familia</th>
              <th scope="col" className="px-3 py-2 text-right">Costo</th>
              <th scope="col" className="px-3 py-2 text-right">Stock</th>
              <th scope="col" className="px-3 py-2 text-right">Disponible</th>
              <th scope="col" className="px-3 py-2 text-right">Min./Ideal</th>
              <th scope="col" className="px-3 py-2 text-right">A reponer</th>
              <th scope="col" className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-masa-700">
                  Cargando {titulo.toLowerCase()}...
                </td>
              </tr>
            ) : filtrados.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-masa-700">
                  {articulos.length === 0
                    ? 'No hay articulos cargados. Empeza con el boton Nuevo.'
                    : 'Ningun articulo coincide con la busqueda.'}
                </td>
              </tr>
            ) : (
              filtrados.map((a) => (
                <tr
                  key={a.id}
                  onClick={() => seleccionar(a)}
                  className={[
                    'cursor-pointer border-t border-masa-100',
                    a.id === seleccionadoId ? 'bg-dulce-50' : 'hover:bg-masa-50',
                    a.bajoMinimo ? 'text-alerta-700' : '',
                    !a.activo ? 'opacity-50' : '',
                  ].join(' ')}
                >
                  <td className="px-3 py-1.5 font-mono text-xs">{a.codigo}</td>
                  <td className="px-3 py-1.5">{a.nombre}</td>
                  <td className="px-3 py-1.5 text-masa-800">{a.marca ?? '—'}</td>
                  <td className="px-3 py-1.5 text-masa-800">{a.familiaNombre ?? '—'}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {a.costoActual === null ? '—' : formatearMoneda(a.costoActual)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatearCantidad(a.stock)} {a.unidadAbreviatura}
                  </td>
                  {/* Lo que se puede prometer hoy. Cuando hay mercaderia apartada
                      para un pedido, este numero es menor que el stock: es el que
                      mira el que vende, no el del deposito. */}
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {a.reservado > 0 ? (
                      <span title={`${formatearCantidad(a.reservado)} apartado para pedidos`}>
                        <span className="font-semibold text-dulce-700">
                          {formatearCantidad(a.disponible)}
                        </span>
                        <span className="text-xs text-masa-700"> (−{formatearCantidad(a.reservado)})</span>
                      </span>
                    ) : (
                      <span className="text-masa-700">{formatearCantidad(a.disponible)}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs tabular-nums text-masa-700">
                    {a.stockMin === null ? '—' : formatearCantidad(a.stockMin)} /{' '}
                    {a.stockIdeal === null ? '—' : formatearCantidad(a.stockIdeal)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                    {a.aReponer > 0 ? (
                      <span className="font-semibold text-alerta-700">{formatearCantidad(a.aReponer)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {!a.activo ? (
                      <Pastilla texto="Inactivo" />
                    ) : a.bajoMinimo ? (
                      <Pastilla texto="Bajo minimo" tono="alerta" />
                    ) : (
                      <Pastilla texto="En regla" tono="positivo" />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {verLedger && seleccionado !== null && (
        <PanelLedger
          articuloId={seleccionado.id}
          titulo={seleccionado.nombre}
          subtitulo={`Ledger de stock · ${seleccionado.codigo}`}
          alCerrar={() => setVerLedger(false)}
        />
      )}
      </div>

      {/* Detalle: siempre visible */}
      <section className="flex h-[46%] min-h-[330px] shrink-0 flex-col overflow-hidden rounded-ficha border-2 border-masa-300 bg-white">
        <header className="flex shrink-0 items-center justify-between border-b border-masa-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-masa-900">
            {modo === 'crear' && 'Nuevo articulo'}
            {modo === 'editar' && `Editando ${seleccionado?.nombre ?? ''}`}
            {modo === 'ver' && (seleccionado === null ? 'Detalle del articulo' : seleccionado.nombre)}
          </h2>
          {modo === 'ver' && seleccionado !== null && (
            <span className="flex items-center gap-3 text-xs text-masa-700">
              {/* Como se repone: si tiene receta se elabora, si no se compra.
                  Es el dato que separa "hay que hacer una tanda" de "hay que
                  llamar al proveedor", y hasta ahora habia que ir a Recetas
                  para saberlo. */}
              {seleccionado.recetaId === null ? (
                <span title="No tiene receta: este articulo se compra, no se elabora">
                  Se compra
                </span>
              ) : (
                <span
                  className="text-dulce-700"
                  title={`Receta #${seleccionado.recetaId} con ${seleccionado.recetaInsumos} insumo(s)`}
                >
                  Se elabora · receta #{seleccionado.recetaId}
                  {seleccionado.recetaRinde !== null && (
                    <> · rinde {formatearCantidad(seleccionado.recetaRinde)} {seleccionado.unidadAbreviatura} por tanda</>
                  )}
                  {' · '}
                  {seleccionado.recetaInsumos} insumo{seleccionado.recetaInsumos === 1 ? '' : 's'}
                </span>
              )}
              <span>
                Stock:{' '}
                <strong className="font-mono">
                  {formatearCantidad(seleccionado.stock)} {seleccionado.unidadAbreviatura}
                </strong>
                {seleccionado.reservado > 0 && (
                  <>
                    {' · '}apartado{' '}
                    <strong className="font-mono text-alerta-700">
                      {formatearCantidad(seleccionado.reservado)}
                    </strong>
                    {' · '}libre{' '}
                    <strong className="font-mono text-dulce-700">
                      {formatearCantidad(seleccionado.disponible)}
                    </strong>
                  </>
                )}
              </span>
            </span>
          )}
        </header>

        {modo === 'ver' && seleccionado === null ? (
          <p className="flex flex-1 items-center justify-center px-3 text-center text-sm text-masa-700">
            Elegi un articulo de la lista para ver su ficha, o cargá uno nuevo.
          </p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-3 gap-y-2 overflow-auto p-3">
            {/* Identificacion */}
            <Campo columnas="col-span-3" rotulo="Codigo">
              <input
                value={form.codigo}
                onChange={(e) => campo('codigo', e.target.value)}
                disabled={!editando}
                className={CLASE_INPUT}
              />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Codigo de barras">
              <input
                value={form.codigoBarras}
                onChange={(e) => campo('codigoBarras', e.target.value)}
                disabled={!editando}
                placeholder="Para el lector"
                className={CLASE_INPUT}
              />
            </Campo>
            <Campo columnas="col-span-6" rotulo="Descripcion">
              <input
                value={form.nombre}
                onChange={(e) => campo('nombre', e.target.value)}
                disabled={!editando}
                className={CLASE_INPUT}
              />
            </Campo>

            {/* Clasificacion */}
            <Campo columnas="col-span-3" rotulo="Familia">
              <SelectorConAlta
                valor={form.familiaId}
                opciones={familias.map((f) => ({ id: f.id, etiqueta: f.nombre }))}
                vacio="Sin clasificar"
                deshabilitado={!editando}
                alCambiar={(v) => campo('familiaId', v)}
                alCrear={nuevaFamilia}
              />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Proveedor habitual">
              <SelectorConAlta
                valor={form.proveedorHabitualId}
                opciones={proveedores.map((p) => ({ id: p.id, etiqueta: p.nombre }))}
                vacio="Sin proveedor fijo"
                deshabilitado={!editando}
                alCambiar={(v) => campo('proveedorHabitualId', v)}
                alCrear={nuevoProveedor}
              />
            </Campo>
            <Campo columnas="col-span-2" rotulo="Marca">
              <input
                value={form.marca}
                onChange={(e) => campo('marca', e.target.value)}
                disabled={!editando}
                className={CLASE_INPUT}
              />
            </Campo>
            <Campo columnas="col-span-2" rotulo="Tipo">
              <select
                value={form.tipo}
                onChange={(e) => campo('tipo', e.target.value as TipoArticulo)}
                disabled={!editando}
                className={CLASE_INPUT}
              >
                <option value="materia_prima">Materia prima</option>
                <option value="pre_elaborado">Pre-elaborado</option>
                <option value="producto_terminado">Producto terminado</option>
              </select>
            </Campo>
            <Campo columnas="col-span-2" rotulo="Unidad">
              <select
                value={form.unidadBaseId}
                onChange={(e) => campo('unidadBaseId', e.target.value === '' ? '' : Number(e.target.value))}
                disabled={!editando}
                className={CLASE_INPUT}
              >
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
              </select>
            </Campo>

            {/* Costo, IVA y precios por lista con su utilidad */}
            <Campo columnas="col-span-3" rotulo="P. Costo">
              <input
                value={form.costoActual}
                onChange={(e) => campo('costoActual', e.target.value)}
                disabled={!editando}
                inputMode="decimal"
                placeholder="0,00"
                className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
              />
            </Campo>
            <Campo columnas="col-span-2" rotulo="IVA">
              <select
                value={form.alicuotaIva}
                onChange={(e) => campo('alicuotaIva', Number(e.target.value))}
                disabled={!editando}
                className={CLASE_INPUT}
              >
                {ALICUOTAS_IVA_UI.map((a) => (
                  <option key={a.valor} value={a.valor}>
                    {a.etiqueta}
                  </option>
                ))}
              </select>
            </Campo>
            <div className="col-span-7" />

            {/*
              Los precios de venta son SOLO de los productos terminados: los
              insumos se compran, no se venden, y mostrarles listas de precio
              confunde sobre que hace cada cosa.
            */}
            {form.tipo !== 'producto_terminado' && (
              <p className="col-span-12 rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2 text-micro text-masa-700">
                Los insumos no llevan precio de venta: se compran. Lo que importa aca es el{' '}
                <strong>costo</strong>, que se actualiza solo con cada compra.
              </p>
            )}

            {form.tipo === 'producto_terminado' && form.precios.length === 0 && (
              <p className="col-span-12 text-micro text-masa-700">
                Los precios de venta aparecen al guardar el articulo por primera vez.
              </p>
            )}

            {/* Un precio por lista, con la utilidad al lado: es el numero que
                decide si el precio tiene sentido. */}
            {form.tipo === 'producto_terminado' &&
              form.precios.map((precio) => (
              <div key={precio.listaPrecioId} className="col-span-6 grid grid-cols-6 gap-x-3">
                <Campo columnas="col-span-4" rotulo={`P. ${precio.listaNombre}`}>
                  <input
                    value={precio.valor}
                    onChange={(e) =>
                      campo(
                        'precios',
                        form.precios.map((p) =>
                          p.listaPrecioId === precio.listaPrecioId ? { ...p, valor: e.target.value } : p,
                        ),
                      )
                    }
                    disabled={!editando}
                    inputMode="decimal"
                    placeholder="0,00"
                    className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
                  />
                </Campo>
                <Campo columnas="col-span-2" rotulo="Utilidad">
                  <ValorCalculado>{utilidad(precio.valor, form.costoActual)}</ValorCalculado>
                </Campo>
              </div>
              ))}

            {/* Stock */}
            <Campo columnas="col-span-3" rotulo="Stock minimo">
              <input
                value={form.stockMin}
                onChange={(e) => campo('stockMin', e.target.value)}
                disabled={!editando}
                inputMode="decimal"
                className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
              />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Stock ideal">
              <input
                value={form.stockIdeal}
                onChange={(e) => campo('stockIdeal', e.target.value)}
                disabled={!editando}
                inputMode="decimal"
                className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
              />
            </Campo>
            {form.tipo === 'producto_terminado' && (
              <Campo columnas="col-span-3" rotulo="Unidades por caja">
                <input
                  value={form.unidadesPorCaja}
                  onChange={(e) => campo('unidadesPorCaja', e.target.value)}
                  disabled={!editando}
                  inputMode="numeric"
                  className={`${CLASE_INPUT} text-right font-mono tabular-nums`}
                />
              </Campo>
            )}
            <Campo columnas="col-span-3" rotulo="Venta por peso">
              <label className="inline-flex h-9 items-center gap-2 text-sm text-masa-900">
                <input
                  type="checkbox"
                  checked={form.porPeso}
                  onChange={(e) => campo('porPeso', e.target.checked)}
                  disabled={!editando}
                  className="h-4 w-4"
                />
                <span>Se vende por peso</span>
              </label>
            </Campo>

            {/* Notas */}
            <Campo columnas="col-span-12" rotulo="Notas">
              <textarea
                value={form.notas}
                onChange={(e) => campo('notas', e.target.value)}
                disabled={!editando}
                rows={2}
                className="w-full rounded-ficha border border-masa-300 bg-white px-2 py-1.5 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-100 disabled:text-masa-700"
              />
            </Campo>
          </div>
        )}

        {editando && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-masa-200 bg-masa-50 px-3 py-2">
            <button
              type="button"
              onClick={cancelar}
              disabled={guardando}
              className={botonBarra}
              title="Cancelar (Escape)"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || form.nombre.trim() === '' || form.codigo.trim() === ''}
              className="inline-flex h-9 items-center rounded-ficha bg-dulce-600 px-5 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300 disabled:text-masa-700"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}


/* ------------------------- Stock Productos con pestanias ------------------- */

/**
 * Modulo "Stock Productos": absorbe al viejo "Maestro de articulos".
 *
 * Productos y Articulos tenian las mismas funciones sobre los mismos datos —
 * Articulos era la union de Insumos y Productos— y dos modulos iguales
 * confunden mas de lo que ayudan. La vista combinada sobrevive como pestania,
 * que es util para buscar cualquier cosa por codigo de barras o exportar el
 * catalogo entero, sin ocupar un lugar en el menu.
 */
export function PantallaStockProductos(): JSX.Element {
  const [pestania, setPestania] = useState<'productos' | 'movimientos' | 'todos'>('productos');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-masa-200 bg-masa-50 px-2 pt-1">
        {(
          [
            ['productos', 'Productos'],
            ['movimientos', 'Movimientos'],
            ['todos', 'Todos los articulos'],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            onClick={() => setPestania(clave)}
            className={[
              'rounded-t-ficha px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-dulce-400',
              pestania === clave
                ? 'border border-b-0 border-masa-200 bg-white font-semibold text-masa-900'
                : 'text-masa-700 hover:bg-masa-100',
            ].join(' ')}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {/* key: cambiar de pestania reinicia el maestro con su propio filtro */}
        {pestania === 'productos' ? (
          <MaestroArticulos
            key="productos"
            grupo="productos"
            titulo="Stock Productos"
            tipoNuevo="producto_terminado"
          />
        ) : pestania === 'movimientos' ? (
          <div className="h-full overflow-auto p-4">
            <TablaMovimientosStock grupo="productos" />
          </div>
        ) : (
          <MaestroArticulos key="todos" grupo="todos" titulo="Todos los articulos" tipoNuevo="materia_prima" />
        )}
      </div>
    </div>
  );
}

/* -------------------------- Stock Insumos con pestanias -------------------- */

/**
 * Insumos y su ledger, separados en pestanias: el maestro (que hay) y los
 * MOVIMIENTOS (que paso). Antes los movimientos vivian en un modulo aparte y
 * habia que abrirlo por el menu; aca estan al lado de lo que explican.
 */
export function PantallaStockInsumos(): JSX.Element {
  const [pestania, setPestania] = useState<'insumos' | 'movimientos'>('insumos');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 gap-1 border-b border-masa-200 bg-masa-50 px-2 pt-1">
        {(
          [
            ['insumos', 'Insumos'],
            ['movimientos', 'Movimientos'],
          ] as const
        ).map(([clave, etiqueta]) => (
          <button
            key={clave}
            type="button"
            onClick={() => setPestania(clave)}
            className={[
              'rounded-t-ficha px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-dulce-400',
              pestania === clave
                ? 'border border-b-0 border-masa-200 bg-white font-semibold text-masa-900'
                : 'text-masa-700 hover:bg-masa-100',
            ].join(' ')}
          >
            {etiqueta}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {pestania === 'insumos' ? (
          <MaestroArticulos key="insumos" grupo="insumos" titulo="Stock Insumos" tipoNuevo="materia_prima" />
        ) : (
          <div className="h-full overflow-auto p-4">
            <TablaMovimientosStock grupo="insumos" />
          </div>
        )}
      </div>
    </div>
  );
}
