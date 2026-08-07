/**
 * Maestro de clientes y de proveedores, con el mismo patron que el de articulos:
 * barra de acciones, grilla y ficha siempre visible abajo.
 *
 * Los dos comparten componente porque comparten la forma de trabajo —buscar en
 * una lista larga, elegir uno, ver o corregir sus datos— y lo unico que cambia
 * son los campos. Tenerlos separados garantizaba que uno recibiera mejoras que
 * el otro no.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, Pencil, Plus, Printer, Search, Trash2, X } from 'lucide-react';

import {
  CONDICIONES_IVA_RECEPTOR,
  ETIQUETA_TIPO_CLIENTE,
  TIPOS_DOCUMENTO,
  nombreCondicionReceptor,
  type ClienteVista,
  type EntradaCliente,
  type EntradaProveedor,
  type ListaPrecioVista,
  type ProveedorVista,
  type TipoCliente,
} from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Aviso } from '../componentes/Formulario';
import {
  actualizarCliente,
  actualizarProveedor,
  cambiarActivoCliente,
  cambiarActivoProveedor,
  crearCliente,
  crearProveedor,
  obtenerClientes,
  obtenerListasPrecio,
  obtenerProveedores,
} from '../servicios/cliente';
import { aCentavos, formatearMoneda, formatearMonedaConSigno } from '../utiles/formato';

type Modo = 'ver' | 'editar' | 'crear';

const CLASE_INPUT =
  'h-9 w-full rounded-ficha border border-masa-300 bg-white px-2 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-100 disabled:text-masa-700';

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

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

interface FormCliente {
  nombre: string;
  tipoDocumento: string;
  numeroDocumento: string;
  cuit: string;
  condicionIva: number;
  tipo: TipoCliente;
  listaPrecioId: number | '';
  limiteCredito: string;
  telefono: string;
  celular: string;
  email: string;
  direccion: string;
  localidad: string;
  notas: string;
}

interface FormProveedor {
  codigo: string;
  nombre: string;
  cuit: string;
  iibb: string;
  telefono: string;
  celular: string;
  email: string;
  direccion: string;
  localidad: string;
  notas: string;
}

const CLIENTE_VACIO: FormCliente = {
  nombre: '', tipoDocumento: 'CUIT', numeroDocumento: '', cuit: '', condicionIva: 5,
  tipo: 'mostrador', listaPrecioId: '', limiteCredito: '', telefono: '', celular: '',
  email: '', direccion: '', localidad: '', notas: '',
};

const PROVEEDOR_VACIO: FormProveedor = {
  codigo: '', nombre: '', cuit: '', iibb: '', telefono: '', celular: '',
  email: '', direccion: '', localidad: '', notas: '',
};

export function MaestroTerceros({ que }: { readonly que: 'clientes' | 'proveedores' }): JSX.Element {
  const esCliente = que === 'clientes';

  const [filas, setFilas] = useState<(ClienteVista | ProveedorVista)[]>([]);
  const [listas, setListas] = useState<ListaPrecioVista[]>([]);
  const [cargando, setCargando] = useState(true);
  const [seleccionadoId, setSeleccionadoId] = useState<number | null>(null);
  const [modo, setModo] = useState<Modo>('ver');
  const [formC, setFormC] = useState<FormCliente>(CLIENTE_VACIO);
  const [formP, setFormP] = useState<FormProveedor>(PROVEEDOR_VACIO);
  const [busqueda, setBusqueda] = useState('');
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const refBusqueda = useRef<HTMLInputElement>(null);

  const editando = modo !== 'ver';

  const recargar = useCallback(async () => {
    const lista = esCliente ? await obtenerClientes() : await obtenerProveedores();
    setFilas(lista);
    setCargando(false);
    return lista;
  }, [esCliente]);

  useEffect(() => {
    void recargar().catch((causa: unknown) => {
      setAviso({ tono: 'mal', texto: mensajeDeError(causa) });
      setCargando(false);
    });
    if (esCliente) void obtenerListasPrecio().then(setListas).catch(() => setListas([]));
  }, [recargar, esCliente]);

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return filas.filter((f) => {
      if (soloConDeuda && f.saldoCc === 0) return false;
      if (texto === '') return true;
      const campos = [f.nombre, f.cuit ?? '', (f as ProveedorVista).codigo ?? '', (f as ClienteVista).localidad ?? ''];
      return campos.some((c) => c.toLowerCase().includes(texto));
    });
  }, [filas, busqueda, soloConDeuda]);

  const seleccionado = filas.find((f) => f.id === seleccionadoId) ?? null;

  const seleccionar = (fila: ClienteVista | ProveedorVista): void => {
    if (editando) return;
    setSeleccionadoId(fila.id);
    if (esCliente) {
      const c = fila as ClienteVista;
      setFormC({
        nombre: c.nombre,
        tipoDocumento: c.tipoDocumento ?? 'CUIT',
        numeroDocumento: c.numeroDocumento ?? '',
        cuit: c.cuit ?? '',
        condicionIva: c.condicionIva,
        tipo: c.tipo,
        listaPrecioId: c.listaPrecioId ?? '',
        limiteCredito: c.limiteCredito === 0 ? '' : String(c.limiteCredito / 100),
        telefono: c.telefono ?? '',
        celular: c.celular ?? '',
        email: c.email ?? '',
        direccion: c.direccion ?? '',
        localidad: c.localidad ?? '',
        notas: '',
      });
    } else {
      const p = fila as ProveedorVista;
      setFormP({
        codigo: p.codigo ?? '',
        nombre: p.nombre,
        cuit: p.cuit ?? '',
        iibb: p.iibb ?? '',
        telefono: p.telefono ?? '',
        celular: p.celular ?? '',
        email: p.email ?? '',
        direccion: p.direccion ?? '',
        localidad: p.localidad ?? '',
        notas: '',
      });
    }
  };

  const empezarAlta = (): void => {
    setSeleccionadoId(null);
    setFormC(CLIENTE_VACIO);
    setFormP(PROVEEDOR_VACIO);
    setModo('crear');
    setAviso(null);
  };

  const cancelar = (): void => {
    setModo('ver');
    setAviso(null);
    if (seleccionado !== null) seleccionar(seleccionado);
  };

  const guardar = async (): Promise<void> => {
    setGuardando(true);
    setAviso(null);
    try {
      let id: number;
      let nombre: string;
      if (esCliente) {
        const entrada: EntradaCliente = {
          nombre: formC.nombre,
          cuit: formC.cuit.trim() || null,
          tipoDocumento: formC.tipoDocumento || null,
          numeroDocumento: formC.numeroDocumento.trim() || null,
          condicionIva: formC.condicionIva,
          telefono: formC.telefono.trim() || null,
          celular: formC.celular.trim() || null,
          localidad: formC.localidad.trim() || null,
          limiteCredito:
            formC.limiteCredito.trim() === '' ? 0 : aCentavos(Number(formC.limiteCredito.replace(',', '.'))),
          email: formC.email.trim() || null,
          direccion: formC.direccion.trim() || null,
          tipo: formC.tipo,
          listaPrecioId: formC.listaPrecioId === '' ? null : formC.listaPrecioId,
        };
        const g = modo === 'crear'
          ? await crearCliente(entrada)
          : await actualizarCliente(seleccionadoId as number, entrada);
        id = g.id;
        nombre = g.nombre;
      } else {
        const entrada: EntradaProveedor = {
          codigo: formP.codigo.trim() || null,
          nombre: formP.nombre,
          cuit: formP.cuit.trim() || null,
          iibb: formP.iibb.trim() || null,
          telefono: formP.telefono.trim() || null,
          celular: formP.celular.trim() || null,
          localidad: formP.localidad.trim() || null,
          email: formP.email.trim() || null,
          direccion: formP.direccion.trim() || null,
        };
        const g = modo === 'crear'
          ? await crearProveedor(entrada)
          : await actualizarProveedor(seleccionadoId as number, entrada);
        id = g.id;
        nombre = g.nombre;
      }

      const lista = await recargar();
      setSeleccionadoId(id);
      setModo('ver');
      const actualizado = lista.find((f) => f.id === id);
      if (actualizado !== undefined) seleccionar(actualizado);
      setAviso({ tono: 'ok', texto: `${nombre} ${modo === 'crear' ? 'dado de alta' : 'actualizado'}.` });
    } catch (causa) {
      setAviso({ tono: 'mal', texto: mensajeDeError(causa) });
    } finally {
      setGuardando(false);
    }
  };

  const cambiarActivo = (): void => {
    if (seleccionado === null) return;
    const alta = !seleccionado.activo;
    if (!alta && !window.confirm(`¿Dar de baja a ${seleccionado.nombre}?`)) return;
    const operacion = esCliente
      ? cambiarActivoCliente(seleccionado.id, alta)
      : cambiarActivoProveedor(seleccionado.id, alta);
    operacion
      .then(() => recargar())
      .then(() =>
        setAviso({ tono: 'ok', texto: `${seleccionado.nombre} ${alta ? 'reactivado' : 'dado de baja'}.` }),
      )
      .catch((causa: unknown) => setAviso({ tono: 'mal', texto: mensajeDeError(causa) }));
  };

  const exportarCsv = (): void => {
    const encabezados = esCliente
      ? ['Nombre', 'CUIT', 'Condicion IVA', 'Tipo', 'Lista', 'Localidad', 'Telefono', 'Celular', 'Email', 'Limite credito', 'Saldo', 'Estado']
      : ['Codigo', 'Nombre', 'CUIT', 'IIBB', 'Localidad', 'Telefono', 'Celular', 'Email', 'Saldo', 'Estado'];
    const filasCsv = filtradas.map((f) =>
      esCliente
        ? (() => {
            const c = f as ClienteVista;
            return [c.nombre, c.cuit ?? '', nombreCondicionReceptor(c.condicionIva),
              ETIQUETA_TIPO_CLIENTE[c.tipo], c.listaPrecioNombre ?? '', c.localidad ?? '',
              c.telefono ?? '', c.celular ?? '', c.email ?? '',
              (c.limiteCredito / 100).toFixed(2), (c.saldoCc / 100).toFixed(2),
              c.activo ? 'Activo' : 'Inactivo'];
          })()
        : (() => {
            const p = f as ProveedorVista;
            return [p.codigo ?? '', p.nombre, p.cuit ?? '', p.iibb ?? '', p.localidad ?? '',
              p.telefono ?? '', p.celular ?? '', p.email ?? '',
              (p.saldoCc / 100).toFixed(2), p.activo ? 'Activo' : 'Inactivo'];
          })(),
    );
    const csv = [encabezados, ...filasCsv]
      .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    enlace.download = `${que}-${new Date().toISOString().slice(0, 10)}.csv`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  };

  useEffect(() => {
    const alPresionar = (e: KeyboardEvent): void => {
      const enCampo = ['INPUT', 'TEXTAREA', 'SELECT'].includes(
        (e.target as HTMLElement | null)?.tagName ?? '',
      );
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        refBusqueda.current?.focus();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n' && !editando) {
        e.preventDefault();
        empezarAlta();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'e' && !editando && seleccionado !== null) {
        e.preventDefault();
        setModo('editar');
      } else if (e.key === 'Escape' && editando) {
        e.preventDefault();
        cancelar();
      } else if (!enCampo && !editando && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        const i = filtradas.findIndex((f) => f.id === seleccionadoId);
        const destino = filtradas[e.key === 'ArrowDown' ? i + 1 : Math.max(i - 1, 0)];
        if (destino !== undefined) seleccionar(destino);
      }
    };
    window.addEventListener('keydown', alPresionar);
    return () => window.removeEventListener('keydown', alPresionar);
  });

  const botonBarra =
    'inline-flex h-9 items-center gap-1.5 rounded-ficha border border-masa-300 px-3 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:opacity-40';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-masa-200 pb-2">
        <button
          type="button"
          onClick={empezarAlta}
          disabled={editando}
          title="Nuevo (Ctrl+N)"
          className="inline-flex h-9 items-center gap-1.5 rounded-ficha bg-dulce-600 px-3 text-sm font-medium text-white outline-none hover:bg-dulce-700 disabled:bg-masa-300"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo
        </button>
        <button
          type="button"
          onClick={() => setModo('editar')}
          disabled={seleccionado === null || editando}
          title="Modificar (Ctrl+E)"
          className={botonBarra}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          Modificar
        </button>
        <button
          type="button"
          onClick={cambiarActivo}
          disabled={seleccionado === null || editando}
          className={botonBarra}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {seleccionado !== null && !seleccionado.activo ? 'Reactivar' : 'Dar de baja'}
        </button>

        <span className="mx-1 h-6 w-px bg-masa-200" aria-hidden="true" />

        <button type="button" onClick={() => window.print()} className={botonBarra}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir
        </button>
        <button type="button" onClick={exportarCsv} className={botonBarra}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          Excel
        </button>

        <div className="flex-1" />

        <label className="flex items-center gap-1.5 text-sm text-masa-800">
          <input
            type="checkbox"
            checked={soloConDeuda}
            onChange={(e) => setSoloConDeuda(e.target.checked)}
            className="h-4 w-4"
          />
          Solo con saldo
        </label>

        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-masa-700" aria-hidden="true" />
          <input
            ref={refBusqueda}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar (Ctrl+F)..."
            aria-label="Buscar"
            className={`${CLASE_INPUT} pl-8`}
          />
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <div className="min-h-0 flex-1 overflow-auto rounded-ficha border border-masa-200 bg-white">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-masa-50">
            <tr className="text-left text-micro uppercase tracking-wide text-masa-700">
              {!esCliente && <th scope="col" className="px-3 py-2">Codigo</th>}
              <th scope="col" className="px-3 py-2">{esCliente ? 'Cliente' : 'Proveedor'}</th>
              <th scope="col" className="px-3 py-2">CUIT</th>
              {esCliente && <th scope="col" className="px-3 py-2">Cond. IVA</th>}
              <th scope="col" className="px-3 py-2">Localidad</th>
              <th scope="col" className="px-3 py-2">Telefono</th>
              {esCliente && <th scope="col" className="px-3 py-2">Lista</th>}
              <th scope="col" className="px-3 py-2 text-right">Saldo</th>
              <th scope="col" className="px-3 py-2">Estado</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-masa-700">Cargando...</td></tr>
            ) : filtradas.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-masa-700">
                  {filas.length === 0 ? 'No hay nada cargado. Empeza con el boton Nuevo.' : 'Ninguno coincide con la busqueda.'}
                </td>
              </tr>
            ) : (
              filtradas.map((f) => {
                const c = f as ClienteVista;
                const p = f as ProveedorVista;
                const excedido = esCliente && c.limiteCredito > 0 && c.saldoCc > c.limiteCredito;
                return (
                  <tr
                    key={f.id}
                    onClick={() => seleccionar(f)}
                    className={[
                      'cursor-pointer border-t border-masa-100',
                      f.id === seleccionadoId ? 'bg-dulce-50' : 'hover:bg-masa-50',
                      !f.activo ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    {!esCliente && <td className="px-3 py-1.5 font-mono text-xs">{p.codigo ?? '—'}</td>}
                    <td className="px-3 py-1.5">{f.nombre}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{f.cuit ?? '—'}</td>
                    {esCliente && (
                      <td className="px-3 py-1.5 text-masa-800">{nombreCondicionReceptor(c.condicionIva)}</td>
                    )}
                    <td className="px-3 py-1.5 text-masa-800">
                      {(esCliente ? c.localidad : p.localidad) ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-masa-800">{f.telefono ?? '—'}</td>
                    {esCliente && <td className="px-3 py-1.5 text-masa-800">{c.listaPrecioNombre ?? 'General'}</td>}
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                      <span className={excedido ? 'font-semibold text-peligro-600' : ''}>
                        {formatearMonedaConSigno(f.saldoCc)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      {!f.activo ? (
                        <Pastilla texto="Inactivo" />
                      ) : excedido ? (
                        <Pastilla texto="Excede limite" tono="peligro" />
                      ) : (
                        <Pastilla texto="Activo" tono="positivo" />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Ficha */}
      <section className="flex h-[44%] min-h-[290px] shrink-0 flex-col overflow-hidden rounded-ficha border-2 border-masa-300 bg-white">
        <header className="flex shrink-0 items-center justify-between border-b border-masa-200 px-3 py-2">
          <h2 className="text-sm font-semibold text-masa-900">
            {modo === 'crear' && (esCliente ? 'Nuevo cliente' : 'Nuevo proveedor')}
            {modo === 'editar' && `Editando ${seleccionado?.nombre ?? ''}`}
            {modo === 'ver' && (seleccionado === null ? 'Ficha' : seleccionado.nombre)}
          </h2>
          {modo === 'ver' && seleccionado !== null && (
            <span className="text-xs text-masa-700">
              Saldo: <strong className="font-mono">{formatearMonedaConSigno(seleccionado.saldoCc)}</strong>
              {esCliente && (seleccionado as ClienteVista).limiteCredito > 0 && (
                <> · limite {formatearMoneda((seleccionado as ClienteVista).limiteCredito)}</>
              )}
            </span>
          )}
        </header>

        {modo === 'ver' && seleccionado === null ? (
          <p className="flex flex-1 items-center justify-center px-3 text-center text-sm text-masa-700">
            Elegi uno de la lista para ver su ficha, o cargá uno nuevo.
          </p>
        ) : esCliente ? (
          <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-3 gap-y-2 overflow-auto p-3">
            <Campo columnas="col-span-6" rotulo="Nombre o razon social">
              <input value={formC.nombre} onChange={(e) => setFormC({ ...formC, nombre: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-2" rotulo="Tipo de doc.">
              <select value={formC.tipoDocumento} onChange={(e) => setFormC({ ...formC, tipoDocumento: e.target.value })} disabled={!editando} className={CLASE_INPUT}>
                {TIPOS_DOCUMENTO.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo columnas="col-span-4" rotulo="CUIT / Documento">
              <input value={formC.cuit} onChange={(e) => setFormC({ ...formC, cuit: e.target.value })} disabled={!editando} placeholder="20-30111222-3" className={`${CLASE_INPUT} font-mono`} />
            </Campo>

            <Campo columnas="col-span-4" rotulo="Condicion frente al IVA">
              <select value={formC.condicionIva} onChange={(e) => setFormC({ ...formC, condicionIva: Number(e.target.value) })} disabled={!editando} className={CLASE_INPUT}>
                {CONDICIONES_IVA_RECEPTOR.map((c) => <option key={c.codigo} value={c.codigo}>{c.etiqueta}</option>)}
              </select>
            </Campo>
            <Campo columnas="col-span-4" rotulo="Tipo de cliente">
              <select value={formC.tipo} onChange={(e) => setFormC({ ...formC, tipo: e.target.value as TipoCliente })} disabled={!editando} className={CLASE_INPUT}>
                <option value="mostrador">Mostrador</option>
                <option value="mayorista">Mayorista</option>
                <option value="distribuidor">Distribuidor</option>
              </select>
            </Campo>
            <Campo columnas="col-span-4" rotulo="Lista de precios">
              <select value={formC.listaPrecioId} onChange={(e) => setFormC({ ...formC, listaPrecioId: e.target.value === '' ? '' : Number(e.target.value) })} disabled={!editando} className={CLASE_INPUT}>
                <option value="">General</option>
                {listas.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
              </select>
            </Campo>

            <Campo columnas="col-span-3" rotulo="Telefono">
              <input value={formC.telefono} onChange={(e) => setFormC({ ...formC, telefono: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Celular">
              <input value={formC.celular} onChange={(e) => setFormC({ ...formC, celular: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-6" rotulo="Email">
              <input value={formC.email} onChange={(e) => setFormC({ ...formC, email: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>

            <Campo columnas="col-span-6" rotulo="Direccion">
              <input value={formC.direccion} onChange={(e) => setFormC({ ...formC, direccion: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Localidad">
              <input value={formC.localidad} onChange={(e) => setFormC({ ...formC, localidad: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Limite de credito">
              <input value={formC.limiteCredito} onChange={(e) => setFormC({ ...formC, limiteCredito: e.target.value })} disabled={!editando} inputMode="decimal" placeholder="Sin limite" className={`${CLASE_INPUT} text-right font-mono tabular-nums`} />
            </Campo>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-12 gap-x-3 gap-y-2 overflow-auto p-3">
            <Campo columnas="col-span-2" rotulo="Codigo">
              <input value={formP.codigo} onChange={(e) => setFormP({ ...formP, codigo: e.target.value })} disabled={!editando} className={`${CLASE_INPUT} font-mono`} />
            </Campo>
            <Campo columnas="col-span-6" rotulo="Razon social">
              <input value={formP.nombre} onChange={(e) => setFormP({ ...formP, nombre: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-4" rotulo="CUIT">
              <input value={formP.cuit} onChange={(e) => setFormP({ ...formP, cuit: e.target.value })} disabled={!editando} placeholder="30-71555444-2" className={`${CLASE_INPUT} font-mono`} />
            </Campo>

            <Campo columnas="col-span-4" rotulo="Ingresos brutos">
              <input value={formP.iibb} onChange={(e) => setFormP({ ...formP, iibb: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-4" rotulo="Telefono">
              <input value={formP.telefono} onChange={(e) => setFormP({ ...formP, telefono: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-4" rotulo="Celular">
              <input value={formP.celular} onChange={(e) => setFormP({ ...formP, celular: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>

            <Campo columnas="col-span-6" rotulo="Direccion">
              <input value={formP.direccion} onChange={(e) => setFormP({ ...formP, direccion: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Localidad">
              <input value={formP.localidad} onChange={(e) => setFormP({ ...formP, localidad: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
            <Campo columnas="col-span-3" rotulo="Email">
              <input value={formP.email} onChange={(e) => setFormP({ ...formP, email: e.target.value })} disabled={!editando} className={CLASE_INPUT} />
            </Campo>
          </div>
        )}

        {editando && (
          <footer className="flex shrink-0 items-center gap-2 border-t border-masa-200 bg-masa-50 px-3 py-2">
            <button type="button" onClick={cancelar} disabled={guardando} className={botonBarra} title="Cancelar (Escape)">
              <X className="h-4 w-4" aria-hidden="true" />
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void guardar()}
              disabled={guardando || (esCliente ? formC.nombre : formP.nombre).trim().length < 2}
              className="inline-flex h-9 items-center rounded-ficha bg-dulce-600 px-5 text-sm font-bold text-white outline-none hover:bg-dulce-700 disabled:bg-masa-300 disabled:text-masa-700"
            >
              {guardando ? 'Guardando...' : 'Guardar'}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
