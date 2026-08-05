/**
 * Tablero de inicio: los indicadores que un dueno de fabrica mira apenas abre el
 * sistema. Todo sale de `/api/resumen`, que resuelve los agregados en la base.
 */

import type { ResumenGeneral } from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Seccion, TarjetaIndicador } from '../componentes/comunes';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerResumen } from '../servicios/cliente';
import { formatearEntero, formatearMoneda, formatearMonedaConSigno } from '../utiles/formato';

export function PantallaInicio(): JSX.Element {
  const { datos, cargando, error, recargar } = usarRecurso<ResumenGeneral>(() => obtenerResumen(), []);

  if (cargando) return <EstadoCargando que="el tablero" />;
  if (error !== null) return <EstadoError mensaje={error} alReintentar={recargar} />;
  if (datos === null) return <EstadoCargando que="el tablero" />;

  const { articulos, pedidos, produccion, compras, ventas, caja, cuentasCorrientes } = datos;

  return (
    <div className="space-y-6">
      <Seccion titulo="Stock">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador rotulo="Articulos activos" valor={formatearEntero(articulos.total)} />
          <TarjetaIndicador
            rotulo="Insumos"
            valor={formatearEntero(articulos.insumos)}
            detalle="Materias primas y pre-elaborados"
          />
          <TarjetaIndicador
            rotulo="Productos"
            valor={formatearEntero(articulos.productos)}
            detalle="Terminados, listos para vender"
          />
          <TarjetaIndicador
            rotulo="Bajo minimo"
            valor={formatearEntero(articulos.bajoMinimo)}
            detalle={articulos.bajoMinimo > 0 ? 'Requieren reposicion' : 'Todo en regla'}
            tono={articulos.bajoMinimo > 0 ? 'alerta' : 'positivo'}
          />
        </div>
      </Seccion>

      <Seccion titulo="Pedidos y produccion">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <TarjetaIndicador
            rotulo="Pedidos pendientes"
            valor={formatearEntero(pedidos.pendientes)}
            tono={pedidos.pendientes > 0 ? 'alerta' : 'neutro'}
          />
          <TarjetaIndicador rotulo="En produccion" valor={formatearEntero(pedidos.enProduccion)} />
          <TarjetaIndicador
            rotulo="Listos para entregar"
            valor={formatearEntero(pedidos.listos)}
            tono={pedidos.listos > 0 ? 'positivo' : 'neutro'}
          />
          <TarjetaIndicador
            rotulo="Ordenes planificadas"
            valor={formatearEntero(produccion.planificadas)}
          />
          <TarjetaIndicador
            rotulo="Ordenes en proceso"
            valor={formatearEntero(produccion.enProceso)}
            tono={produccion.enProceso > 0 ? 'info' : 'neutro'}
          />
        </div>
      </Seccion>

      <Seccion titulo="Movimiento del mes">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador
            rotulo="Ventas del mes"
            valor={formatearMoneda(ventas.totalMes)}
            detalle={`${formatearEntero(ventas.cantidadMes)} comprobante(s)`}
            tono="positivo"
          />
          <TarjetaIndicador
            rotulo="Compras del mes"
            valor={formatearMoneda(compras.totalMes)}
            detalle={`${formatearEntero(compras.pendientes)} pendiente(s) de recibir`}
          />
          <TarjetaIndicador
            rotulo="Caja"
            valor={caja.abierta ? formatearMoneda(caja.saldoEstimado) : 'Cerrada'}
            detalle={caja.abierta ? `Caja #${caja.cajaId ?? '?'} abierta` : 'No hay caja abierta'}
            tono={caja.abierta ? 'info' : 'neutro'}
          />
          <TarjetaIndicador
            rotulo="Nos deben / debemos"
            valor={formatearMonedaConSigno(cuentasCorrientes.saldoClientes)}
            detalle={`A proveedores: ${formatearMonedaConSigno(cuentasCorrientes.saldoProveedores)}`}
            tono={cuentasCorrientes.saldoClientes > 0 ? 'alerta' : 'neutro'}
          />
        </div>
      </Seccion>
    </div>
  );
}
