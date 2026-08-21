/**
 * Ajustes de stock (toma de inventario) y ledger de movimientos.
 *
 *  - PantallaAjustesStock: la lista completa del grupo con la cantidad ACTUAL
 *    editable. Se cuenta lo fisico, se corrigen los numeros y "Guardar
 *    ajustes" asienta SOLO las diferencias, cada una como ajuste con motivo.
 *  - PantallaMovimientosStock: todos los movimientos del stock (ingresos,
 *    egresos y ajustes) con pestanias Insumos | Productos.
 */

import { useEffect, useState } from 'react';

import type {
  GrupoStock,
  MovimientoGrupoVista,
  SaldoStock,
  TipoMovimientoStock,
} from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion, type TonoPastilla } from '../componentes/comunes';
import {
  BarraFiltros,
  entraEnRango,
  RANGO_VACIO,
  SelectorFiltro,
  type RangoFechas,
} from '../componentes/filtros';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import { ajustarStock, obtenerMovimientosDeGrupo, obtenerStock } from '../servicios/cliente';
import { formatearCantidad, formatearFecha } from '../utiles/formato';

/* ------------------------------ Ajustes ------------------------------------ */

export function PantallaAjustesStock({ grupo }: { readonly grupo: GrupoStock }): JSX.Element {
  const estado = usarRecurso<SaldoStock[]>(() => obtenerStock(grupo), [grupo]);
  const [reales, setReales] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  // Al recargar la lista se descartan las ediciones: los numeros de base cambiaron.
  useEffect(() => {
    setReales({});
  }, [estado.datos]);

  if (estado.cargando) return <EstadoCargando que="el stock" />;
  if (estado.error !== null) return <EstadoError mensaje={estado.error} alReintentar={estado.recargar} />;
  const filas = estado.datos ?? [];

  const valorDe = (fila: SaldoStock): string =>
    reales[fila.articuloId] ?? String(fila.stock);
  const diferenciaDe = (fila: SaldoStock): number => {
    const crudo = reales[fila.articuloId];
    if (crudo === undefined || crudo.trim() === '') return 0;
    const numero = Number(crudo.replace(',', '.'));
    if (!Number.isFinite(numero)) return 0;
    return Math.round((numero - fila.stock) * 1000) / 1000;
  };
  const cambiadas = filas.filter((f) => diferenciaDe(f) !== 0);

  const guardar = async (): Promise<void> => {
    if (cambiadas.length === 0) return;
    const detalle = cambiadas
      .map((f) => `${f.nombre}: ${formatearCantidad(f.stock)} -> ${valorDe(f)} ${f.unidadAbreviatura}`)
      .join('\n');
    if (!window.confirm(`Se van a registrar ${cambiadas.length} ajuste(s):\n\n${detalle}\n\n¿Confirmar?`)) return;
    setGuardando(true);
    setAviso(null);
    try {
      for (const fila of cambiadas) {
        await ajustarStock({
          articuloId: fila.articuloId,
          cantidad: diferenciaDe(fila),
          motivo: 'Toma de inventario (ajuste de stock)',
        });
      }
      setAviso({ tono: 'ok', texto: `${cambiadas.length} ajuste(s) registrados en el historial.` });
      estado.recargar();
    } catch (causa) {
      setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) });
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <Seccion
        titulo={grupo === 'insumos' ? 'Ajustes de Stock Insumos' : 'Ajustes de Stock Productos'}
        acciones={
          <button
            type="button"
            disabled={guardando || cambiadas.length === 0}
            onClick={() => void guardar()}
            className="h-9 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-30"
          >
            {guardando ? 'Guardando...' : `Guardar ajustes${cambiadas.length > 0 ? ` (${cambiadas.length})` : ''}`}
          </button>
        }
      >
        {aviso !== null && (
          <p
            className={[
              'mb-2 rounded-ficha border px-3 py-1.5 text-sm',
              aviso.tono === 'ok'
                ? 'border-menta-300 bg-menta-50 text-menta-800'
                : 'border-peligro-300 bg-peligro-50 text-peligro-700',
            ].join(' ')}
          >
            {aviso.texto}
          </p>
        )}
        <p className="mb-2 text-xs text-masa-700">
          Conta lo fisico y corregi la cantidad. Solo se registran las diferencias, cada una como
          ajuste con su motivo, y quedan en el historial del articulo.
        </p>
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                <th className="px-3 py-2 font-semibold">Codigo</th>
                <th className="px-3 py-2 font-semibold">Articulo</th>
                <th className="px-3 py-2 text-right font-semibold">Stock segun sistema</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad real</th>
                <th className="px-3 py-2 font-semibold">Unidad</th>
                <th className="px-3 py-2 text-right font-semibold">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => {
                const diferencia = diferenciaDe(fila);
                return (
                  <tr key={fila.articuloId} className="border-b border-masa-100">
                    <td className="px-3 py-1.5 font-mono text-xs text-masa-700">{fila.codigo}</td>
                    <td className="px-3 py-1.5 text-masa-900">{fila.nombre}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-masa-800">
                      {formatearCantidad(fila.stock)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        inputMode="decimal"
                        value={valorDe(fila)}
                        onChange={(e) =>
                          setReales((s) => ({ ...s, [fila.articuloId]: e.target.value }))
                        }
                        className={[
                          'h-9 w-28 rounded-none border px-2 text-right font-mono text-sm font-bold tabular-nums',
                          diferencia !== 0 ? 'border-dulce-400 bg-dulce-50' : 'border-masa-300 bg-white',
                        ].join(' ')}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-masa-700">
                      {grupo === 'productos' ? 'u' : fila.unidadAbreviatura}
                    </td>
                    <td
                      className={[
                        'px-3 py-1.5 text-right font-mono font-bold tabular-nums',
                        diferencia > 0 ? 'text-menta-700' : diferencia < 0 ? 'text-peligro-600' : 'text-masa-500',
                      ].join(' ')}
                    >
                      {diferencia === 0 ? '—' : `${diferencia > 0 ? '+' : ''}${formatearCantidad(diferencia)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Seccion>
    </div>
  );
}

/* ---------------------------- Movimientos ---------------------------------- */

const ETIQUETA_MOVIMIENTO: Readonly<Record<TipoMovimientoStock, { texto: string; tono: TonoPastilla }>> = {
  compra: { texto: 'Ingreso por compra', tono: 'positivo' },
  ingreso_produccion: { texto: 'Ingreso de elaboracion', tono: 'positivo' },
  venta: { texto: 'Egreso por venta', tono: 'info' },
  consumo_produccion: { texto: 'Consumo de elaboracion', tono: 'info' },
  merma: { texto: 'Merma', tono: 'peligro' },
  ajuste: { texto: 'Ajuste', tono: 'alerta' },
};

export function TablaMovimientosStock({ grupo }: { readonly grupo: GrupoStock }): JSX.Element {
  const estado = usarRecurso<MovimientoGrupoVista[]>(() => obtenerMovimientosDeGrupo(grupo), [grupo]);
  usarEventos('ordenes:cambio', estado.recargar);
  const [busqueda, setBusqueda] = useState('');
  const [rango, setRango] = useState<RangoFechas>(RANGO_VACIO);
  const [articuloFiltro, setArticuloFiltro] = useState<number | ''>('');
  const [tipoFiltro, setTipoFiltro] = useState<TipoMovimientoStock | ''>('');

  if (estado.cargando) return <EstadoCargando que="los movimientos" />;
  if (estado.error !== null) return <EstadoError mensaje={estado.error} alReintentar={estado.recargar} />;
  const todos = estado.datos ?? [];
  const filas = todos
    .filter((m) => entraEnRango(m.fecha, rango))
    .filter((m) => articuloFiltro === '' || m.articuloId === articuloFiltro)
    .filter((m) => tipoFiltro === '' || m.tipo === tipoFiltro)
    .filter((m) => {
      const q = busqueda.trim().toLowerCase();
      if (q === '') return true;
      return (
        m.articuloNombre.toLowerCase().includes(q) ||
        m.articuloCodigo.toLowerCase().includes(q) ||
        (m.notas ?? '').toLowerCase().includes(q)
      );
    });

  const articulosDeLaLista = [...new Map(todos.map((m) => [m.articuloId, m.articuloNombre]))]
    .map(([valor, etiqueta]) => ({ valor, etiqueta }))
    .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));
  const tiposPresentes = [...new Set(todos.map((m) => m.tipo))].map((tipo) => ({
    valor: tipo,
    etiqueta: ETIQUETA_MOVIMIENTO[tipo].texto,
  }));
  const hayFiltros =
    rango.desde !== '' || rango.hasta !== '' || articuloFiltro !== '' || tipoFiltro !== '' || busqueda !== '';

  // Neto de lo filtrado: cuanto entro y cuanto salio en ese corte.
  const entradas = filas.filter((m) => m.cantidad > 0).reduce((s, m) => s + m.cantidad, 0);
  const salidas = filas.filter((m) => m.cantidad < 0).reduce((s, m) => s + m.cantidad, 0);

  return (
    <div className="space-y-2">
      <BarraFiltros
        rango={rango}
        alCambiarRango={setRango}
        texto={busqueda}
        alCambiarTexto={setBusqueda}
        placeholderTexto="Buscar por articulo o nota..."
        selectores={
          <>
            <SelectorFiltro
              valor={articuloFiltro}
              alCambiar={(v) => setArticuloFiltro(v === '' ? '' : Number(v))}
              vacio="Todos los articulos"
              opciones={articulosDeLaLista}
            />
            <SelectorFiltro
              valor={tipoFiltro}
              alCambiar={(v) => setTipoFiltro(v as TipoMovimientoStock | '')}
              vacio="Todos los movimientos"
              opciones={tiposPresentes}
            />
          </>
        }
        resumen={`${filas.length} de ${todos.length} movimientos`}
        alLimpiar={() => {
          setRango(RANGO_VACIO);
          setArticuloFiltro('');
          setTipoFiltro('');
          setBusqueda('');
        }}
        hayFiltros={hayFiltros}
      />
      {filas.length > 0 && (
        <p className="text-xs text-masa-700">
          Entradas <span className="font-mono font-bold text-menta-700">+{formatearCantidad(entradas)}</span>
          {' · '}
          Salidas <span className="font-mono font-bold text-peligro-600">{formatearCantidad(salidas)}</span>
          {' · '}
          Neto <span className="font-mono font-bold text-masa-900">{formatearCantidad(entradas + salidas)}</span>
        </p>
      )}
      {filas.length === 0 ? (
        <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
          {hayFiltros ? 'Ningun movimiento coincide con el filtro.' : 'Sin movimientos registrados.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Articulo</th>
                <th className="px-3 py-2 font-semibold">Movimiento</th>
                <th className="px-3 py-2 text-right font-semibold">Cantidad</th>
                <th className="px-3 py-2 font-semibold">Documento</th>
                <th className="px-3 py-2 font-semibold">Notas</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((m) => {
                const etiqueta = ETIQUETA_MOVIMIENTO[m.tipo];
                return (
                  <tr key={m.id} className="border-b border-masa-100">
                    <td className="px-3 py-1.5 whitespace-nowrap text-masa-800">{formatearFecha(m.fecha)}</td>
                    <td className="px-3 py-1.5 text-masa-900">
                      <span className="font-mono text-xs text-masa-700">{m.articuloCodigo}</span> {m.articuloNombre}
                    </td>
                    <td className="px-3 py-1.5">
                      <Pastilla texto={etiqueta.texto} tono={etiqueta.tono} />
                    </td>
                    <td
                      className={[
                        'px-3 py-1.5 text-right font-mono font-bold tabular-nums',
                        m.cantidad > 0 ? 'text-menta-700' : 'text-peligro-600',
                      ].join(' ')}
                    >
                      {m.cantidad > 0 ? '+' : ''}
                      {formatearCantidad(m.cantidad)} {m.unidadAbreviatura}
                    </td>
                    <td className="px-3 py-1.5 text-masa-700">
                      {m.documentoTipo !== null ? `${m.documentoTipo} #${m.documentoId ?? '?'}` : '—'}
                    </td>
                    <td className="max-w-64 truncate px-3 py-1.5 text-xs text-masa-700">{m.notas ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function PantallaMovimientosStock(): JSX.Element {
  const [pestania, setPestania] = useState<GrupoStock>('insumos');
  const claseTab = (activa: boolean): string =>
    [
      'h-10 rounded-none border-b-2 px-4 text-sm font-bold uppercase tracking-wide',
      activa ? 'border-dulce-500 text-dulce-700' : 'border-transparent text-masa-700 hover:text-masa-900',
    ].join(' ');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-masa-200">
        <button type="button" className={claseTab(pestania === 'insumos')} onClick={() => setPestania('insumos')}>
          Stock Insumos
        </button>
        <button type="button" className={claseTab(pestania === 'productos')} onClick={() => setPestania('productos')}>
          Stock Productos
        </button>
      </div>
      <TablaMovimientosStock grupo={pestania} />
    </div>
  );
}
