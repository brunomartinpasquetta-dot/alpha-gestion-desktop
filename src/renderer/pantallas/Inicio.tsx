/**
 * Tablero de inicio: los indicadores que un dueno de fabrica mira apenas abre el
 * sistema. Todo sale de `/api/resumen`, que resuelve los agregados en la base.
 */

import type { ReactNode } from 'react';

import type { ResumenGeneral } from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion, TarjetaIndicador } from '../componentes/comunes';
import { useState } from 'react';

import type { OrdenProduccionVista, PedidoVista } from '../../compartido/contratos';
import { usarRecurso } from '../ganchos/usarRecurso';
import { usarEventos } from '../ganchos/usarEventos';
import { obtenerOrdenesProduccion, obtenerPedidos, obtenerResumen } from '../servicios/cliente';
import { PantallaEstadisticas } from './Gestion';
import { formatearEntero, formatearMoneda, formatearMonedaConSigno } from '../utiles/formato';
import { definicionDeModulo, type ClaveModulo } from '../ventanas';

/**
 * Cada indicador del tablero es un ATAJO: el click abre el modulo que explica
 * ese numero. Funciona igual con el tablero fijado en el panel principal o
 * abierto como ventana.
 */
function Atajo({ clave, children }: { readonly clave: ClaveModulo; readonly children: ReactNode }): JSX.Element {
  const abrir = (): void => {
    const definicion = definicionDeModulo(clave);
    window.alfajores?.ventanas.abrir(clave, definicion.titulo, definicion.icono);
  };
  return (
    <button
      type="button"
      onClick={abrir}
      title={`Abrir ${definicionDeModulo(clave).etiqueta}`}
      className="rounded-none text-left outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-dulce-400"
    >
      {children}
    </button>
  );
}

function PestanaTableroGeneral(): JSX.Element {
  const { datos, cargando, error, recargar } = usarRecurso<ResumenGeneral>(() => obtenerResumen(), []);

  if (cargando) return <EstadoCargando que="el tablero" />;
  if (error !== null) return <EstadoError mensaje={error} alReintentar={recargar} />;
  if (datos === null) return <EstadoCargando que="el tablero" />;

  const { articulos, pedidos, produccion, compras, ventas, caja, cuentasCorrientes } = datos;

  return (
    <div className="space-y-6">
      <Seccion titulo="Stock">
        <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4 [&>button]:h-full [&>button>*]:h-full">
          <Atajo clave="stock-productos"><TarjetaIndicador rotulo="Articulos activos" valor={formatearEntero(articulos.total)} /></Atajo>
          <Atajo clave="stock-insumos"><TarjetaIndicador
            rotulo="Insumos"
            valor={formatearEntero(articulos.insumos)}
            detalle="Materias primas y pre-elaborados"
          /></Atajo>
          <Atajo clave="stock-productos"><TarjetaIndicador
            rotulo="Productos"
            valor={formatearEntero(articulos.productos)}
            detalle="Terminados, listos para vender"
          /></Atajo>
          <Atajo clave="reposicion"><TarjetaIndicador
            rotulo="Bajo minimo"
            valor={formatearEntero(articulos.bajoMinimo)}
            detalle={articulos.bajoMinimo > 0 ? 'Requieren reposicion' : 'Todo en regla'}
            tono={articulos.bajoMinimo > 0 ? 'alerta' : 'positivo'}
          /></Atajo>
        </div>
      </Seccion>

      <Seccion titulo="Pedidos y produccion">
        <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-5 [&>button]:h-full [&>button>*]:h-full">
          <Atajo clave="pedidos"><TarjetaIndicador
            rotulo="Pedidos pendientes"
            valor={formatearEntero(pedidos.pendientes)}
            tono={pedidos.pendientes > 0 ? 'alerta' : 'neutro'}
          /></Atajo>
          <Atajo clave="pedidos"><TarjetaIndicador rotulo="En produccion" valor={formatearEntero(pedidos.enProduccion)} /></Atajo>
          <Atajo clave="ventas"><TarjetaIndicador
            rotulo="Listos para entregar"
            valor={formatearEntero(pedidos.listos)}
            tono={pedidos.listos > 0 ? 'positivo' : 'neutro'}
          /></Atajo>
          <Atajo clave="ordenes"><TarjetaIndicador
            rotulo="Ordenes planificadas"
            valor={formatearEntero(produccion.planificadas)}
          /></Atajo>
          <Atajo clave="ordenes"><TarjetaIndicador
            rotulo="Ordenes en proceso"
            valor={formatearEntero(produccion.enProceso)}
            tono={produccion.enProceso > 0 ? 'info' : 'neutro'}
          /></Atajo>
        </div>
      </Seccion>

      <Seccion titulo="Movimiento del mes">
        <div className="grid grid-cols-2 items-stretch gap-3 lg:grid-cols-4 [&>button]:h-full [&>button>*]:h-full">
          <Atajo clave="ventas"><TarjetaIndicador
            rotulo="Ventas del mes"
            valor={formatearMoneda(ventas.totalMes)}
            detalle={`${formatearEntero(ventas.cantidadMes)} comprobante(s)`}
            tono="positivo"
          /></Atajo>
          <Atajo clave="compras"><TarjetaIndicador
            rotulo="Compras del mes"
            valor={formatearMoneda(compras.totalMes)}
            detalle={`${formatearEntero(compras.pendientes)} pendiente(s) de recibir`}
          /></Atajo>
          <Atajo clave="caja"><TarjetaIndicador
            rotulo="Caja"
            valor={caja.abierta ? formatearMoneda(caja.saldoEstimado) : 'Cerrada'}
            detalle={caja.abierta ? `Caja #${caja.cajaId ?? '?'} abierta` : 'No hay caja abierta'}
            tono={caja.abierta ? 'info' : 'neutro'}
          /></Atajo>
          <Atajo clave="cuentas-corrientes"><TarjetaIndicador
            rotulo="Nos deben / debemos"
            valor={formatearMonedaConSigno(cuentasCorrientes.saldoClientes)}
            detalle={`A proveedores: ${formatearMonedaConSigno(cuentasCorrientes.saldoProveedores)}`}
            tono={cuentasCorrientes.saldoClientes > 0 ? 'alerta' : 'neutro'}
          /></Atajo>
        </div>
      </Seccion>
    </div>
  );
}

/* ------------------------- Pestania Elaboracion ---------------------------- */

/** Cantidad en la unidad de trabajo (docenas si upc=12). */
function enUnidadTablero(unidades: number, upc: number | null, abreviatura: string): string {
  if (upc === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${resto} u`;
    return resto === 0 ? `${docenas} ${docenas === 1 ? 'docena' : 'docenas'}` : `${docenas} doc + ${resto} u`;
  }
  return `${formatearEntero(unidades)} ${upc !== null && upc > 1 ? 'u' : abreviatura}`;
}

/**
 * Vista rapida de la fabrica dentro del tablero: que se esta elaborando AHORA
 * y que espera turno hoy. Solo lectura; el trabajo se opera en Elaboracion
 * (el click en una tarjeta la abre).
 */
function PestanaElaboracionDia(): JSX.Element {
  const ordenes = usarRecurso<OrdenProduccionVista[]>(() => obtenerOrdenesProduccion(), []);
  const pedidos = usarRecurso<PedidoVista[]>(() => obtenerPedidos(), []);
  usarEventos('ordenes:cambio', ordenes.recargar);
  usarEventos('pedidos:cambio', pedidos.recargar);

  if (ordenes.cargando) return <EstadoCargando que="las elaboraciones" />;
  if (ordenes.error !== null) return <EstadoError mensaje={ordenes.error} alReintentar={ordenes.recargar} />;

  const todas = ordenes.datos ?? [];
  const hoy = new Date().toDateString();
  const enProgreso = todas.filter((o) => o.estado === 'en_proceso' || o.estado === 'pausada');
  const pendientesHoy = todas.filter(
    (o) => o.estado === 'planificada' && new Date(o.fechaPlanificada).toDateString() === hoy,
  );
  const pendientesAnteriores = todas.filter(
    (o) => o.estado === 'planificada' && new Date(o.fechaPlanificada).toDateString() !== hoy,
  );
  const pedidoDe = (id: number | null): PedidoVista | undefined =>
    id === null ? undefined : (pedidos.datos ?? []).find((p) => p.id === id);

  const Tarjeta = ({ orden }: { readonly orden: OrdenProduccionVista }): JSX.Element => {
    const pedido = pedidoDe(orden.pedidoId);
    return (
      <Atajo clave="ordenes">
        <div
          className={[
            'rounded-ficha border-2 bg-white p-3',
            orden.estado === 'en_proceso' ? 'border-dulce-400' : orden.estado === 'pausada' ? 'border-masa-300' : 'border-masa-200',
          ].join(' ')}
        >
          <p className="text-sm font-bold text-masa-900">{orden.articuloProducidoNombre}</p>
          <p className="font-mono text-sm font-bold tabular-nums text-masa-900">
            {enUnidadTablero(orden.cantidadPlanificada, orden.unidadesPorCaja, orden.unidadAbreviatura)}
          </p>
          <p className="mt-0.5 text-xs text-masa-700">
            Orden #{orden.id}
            {orden.numeroLote !== null ? ` · Lote ${orden.numeroLote}` : ''}
            {orden.clienteNombre !== null ? ` · ${orden.clienteNombre}` : ' · stock interno'}
            {pedido !== undefined ? ` · Pedido #${pedido.id}` : ''}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {orden.estado === 'en_proceso' && <Pastilla texto="En elaboracion" tono="info" />}
            {orden.estado === 'pausada' && <Pastilla texto="En pausa" />}
            {orden.estado === 'planificada' && orden.esperaInsumos && (
              <Pastilla texto={`Espera insumos${orden.insumosFaltantes !== null ? `: ${orden.insumosFaltantes}` : ''}`} tono="alerta" />
            )}
            {orden.estado === 'planificada' && !orden.esperaInsumos && <Pastilla texto="Lista para elaborar" tono="positivo" />}
          </div>
        </div>
      </Atajo>
    );
  };

  return (
    <div className="space-y-5">
      <Seccion titulo={`En progreso (${enProgreso.length})`}>
        {enProgreso.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-3 text-sm text-masa-700">
            No hay tandas en marcha.
          </p>
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-3 [&>button]:h-full [&>button>*]:h-full">
            {enProgreso.map((o) => <Tarjeta key={o.id} orden={o} />)}
          </div>
        )}
      </Seccion>
      <Seccion titulo={`Pendientes de hoy (${pendientesHoy.length})`}>
        {pendientesHoy.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-3 text-sm text-masa-700">
            Nada pendiente cargado hoy.
          </p>
        ) : (
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-3 [&>button]:h-full [&>button>*]:h-full">
            {pendientesHoy.map((o) => <Tarjeta key={o.id} orden={o} />)}
          </div>
        )}
      </Seccion>
      {pendientesAnteriores.length > 0 && (
        <Seccion titulo={`Pendientes anteriores (${pendientesAnteriores.length})`}>
          <div className="grid grid-cols-1 items-stretch gap-3 md:grid-cols-2 lg:grid-cols-3 [&>button]:h-full [&>button>*]:h-full">
            {pendientesAnteriores.map((o) => <Tarjeta key={o.id} orden={o} />)}
          </div>
        </Seccion>
      )}
    </div>
  );
}

/* --------------------------- Tablero con pestanias ------------------------- */

export function PantallaInicio(): JSX.Element {
  const [pestania, setPestania] = useState<'general' | 'elaboracion' | 'estadisticas'>('general');
  const claseTab = (activa: boolean): string =>
    [
      'h-10 rounded-none border-b-2 px-4 text-sm font-bold uppercase tracking-wide',
      activa ? 'border-dulce-500 text-dulce-700' : 'border-transparent text-masa-700 hover:text-masa-900',
    ].join(' ');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-masa-200">
        <button type="button" className={claseTab(pestania === 'general')} onClick={() => setPestania('general')}>
          Tablero general
        </button>
        <button type="button" className={claseTab(pestania === 'elaboracion')} onClick={() => setPestania('elaboracion')}>
          Elaboracion
        </button>
        <button type="button" className={claseTab(pestania === 'estadisticas')} onClick={() => setPestania('estadisticas')}>
          Estadisticas
        </button>
      </div>
      {pestania === 'general' ? (
        <PestanaTableroGeneral />
      ) : pestania === 'elaboracion' ? (
        <PestanaElaboracionDia />
      ) : (
        <PantallaEstadisticas />
      )}
    </div>
  );
}

