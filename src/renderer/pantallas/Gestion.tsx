/**
 * Pantallas de gestion: caja general, estadisticas, usuarios y contabilidad.
 */

import {
  ETIQUETA_ROL,
  type ArticuloVendido,
  type Estadisticas,
  type PeriodoEstadistica,
  type ResumenCajaGeneral,
  type UsuarioVista,
} from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion, TarjetaIndicador } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerCajaGeneral, obtenerEstadisticas, obtenerUsuarios } from '../servicios/cliente';
import { formatearCantidad, formatearEntero, formatearMoneda, formatearMonedaConSigno } from '../utiles/formato';

/* ------------------------------- Caja general ------------------------------ */

export function PantallaCajaGeneral(): JSX.Element {
  const { datos, cargando, error, recargar } = usarRecurso<ResumenCajaGeneral>(
    () => obtenerCajaGeneral(),
    [],
  );

  if (cargando) return <EstadoCargando que="la caja general" />;
  if (error !== null) return <EstadoError mensaje={error} alReintentar={recargar} />;
  if (datos === null) return <EstadoCargando que="la caja general" />;

  return (
    <div className="space-y-6">
      <p className="text-sm text-masa-700">
        Consolidado de <strong>todas</strong> las cajas, no de una jornada. La caja diaria muestra
        turno por turno; esta pantalla los suma.
      </p>

      <Seccion titulo="Movimiento acumulado">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador rotulo="Aperturas" valor={formatearMoneda(datos.totalAperturas)} />
          <TarjetaIndicador
            rotulo="Ingresos"
            valor={formatearMoneda(datos.totalIngresos)}
            tono="positivo"
          />
          <TarjetaIndicador
            rotulo="Egresos"
            valor={formatearMoneda(datos.totalEgresos)}
            tono="peligro"
          />
          <TarjetaIndicador
            rotulo="Saldo acumulado"
            valor={formatearMoneda(datos.saldoAcumulado)}
            detalle="Aperturas + ingresos − egresos"
            tono="info"
          />
        </div>
      </Seccion>

      <Seccion titulo="Control de cajas">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador rotulo="Cajas totales" valor={formatearEntero(datos.totalCajas)} />
          <TarjetaIndicador
            rotulo="Abiertas"
            valor={formatearEntero(datos.cajasAbiertas)}
            tono={datos.cajasAbiertas > 0 ? 'info' : 'neutro'}
          />
          <TarjetaIndicador rotulo="Cerradas" valor={formatearEntero(datos.cajasCerradas)} />
          <TarjetaIndicador
            rotulo="Diferencia acumulada"
            valor={formatearMonedaConSigno(datos.diferenciaAcumulada)}
            detalle={datos.diferenciaAcumulada < 0 ? 'Faltante historico' : 'Sobrante historico'}
            tono={datos.diferenciaAcumulada < 0 ? 'peligro' : 'positivo'}
          />
        </div>
      </Seccion>
    </div>
  );
}

/* ------------------------------- Estadisticas ------------------------------ */

/** Barra proporcional al maximo de la serie. Suficiente para leer la tendencia. */
function BarraPeriodo({
  periodo,
  maximo,
}: {
  readonly periodo: PeriodoEstadistica;
  readonly maximo: number;
}): JSX.Element {
  const porcentaje = maximo === 0 ? 0 : Math.round((periodo.total / maximo) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-masa-700">{periodo.mes}</span>
      <div className="h-5 min-w-0 flex-1 overflow-hidden rounded bg-masa-100">
        <div
          className="h-full rounded bg-dulce-500"
          style={{ width: `${Math.max(porcentaje, periodo.total > 0 ? 2 : 0)}%` }}
        />
      </div>
      <span className="w-32 shrink-0 text-right font-mono text-xs tabular-nums text-masa-900">
        {formatearMoneda(periodo.total)}
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-masa-700">
        {formatearEntero(periodo.cantidad)}
      </span>
    </div>
  );
}

function SerieMensual({
  titulo,
  periodos,
}: {
  readonly titulo: string;
  readonly periodos: readonly PeriodoEstadistica[];
}): JSX.Element {
  const maximo = periodos.reduce((mayor, p) => Math.max(mayor, p.total), 0);

  return (
    <Seccion titulo={titulo}>
      {periodos.length === 0 ? (
        <p className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-6 text-center text-sm text-masa-700">
          Sin movimientos registrados.
        </p>
      ) : (
        <div className="space-y-1.5 rounded-ficha border border-masa-200 bg-white p-4 shadow-ficha">
          <div className="flex items-center gap-3 text-micro uppercase tracking-wide text-masa-700">
            <span className="w-16 shrink-0">Mes</span>
            <span className="min-w-0 flex-1" />
            <span className="w-32 shrink-0 text-right">Total</span>
            <span className="w-16 shrink-0 text-right">Comprob.</span>
          </div>
          {periodos.map((periodo) => (
            <BarraPeriodo key={periodo.mes} periodo={periodo} maximo={maximo} />
          ))}
        </div>
      )}
    </Seccion>
  );
}

const COLUMNAS_VENDIDOS: readonly Columna<ArticuloVendido>[] = [
  { clave: 'codigo', titulo: 'Codigo', celda: (a) => <span className="font-mono">{a.codigo}</span> },
  { clave: 'nombre', titulo: 'Articulo', celda: (a) => a.nombre },
  { clave: 'cantidad', titulo: 'Unidades', celda: (a) => formatearCantidad(a.cantidad), numerica: true },
  { clave: 'total', titulo: 'Facturado', celda: (a) => formatearMoneda(a.total), numerica: true },
];

export function PantallaEstadisticas(): JSX.Element {
  const { datos, cargando, error, recargar } = usarRecurso<Estadisticas>(
    () => obtenerEstadisticas(),
    [],
  );

  if (cargando) return <EstadoCargando que="las estadisticas" />;
  if (error !== null) return <EstadoError mensaje={error} alReintentar={recargar} />;
  if (datos === null) return <EstadoCargando que="las estadisticas" />;

  return (
    <div className="space-y-6">
      <Seccion titulo="Valorizacion del inventario">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <TarjetaIndicador rotulo="Insumos" valor={formatearMoneda(datos.valorizacion.insumos)} />
          <TarjetaIndicador
            rotulo="Productos terminados"
            valor={formatearMoneda(datos.valorizacion.productos)}
          />
          <TarjetaIndicador
            rotulo="Total"
            valor={formatearMoneda(datos.valorizacion.total)}
            detalle="Stock × costo actual"
            tono="info"
          />
        </div>
        <p className="mt-2 text-xs text-masa-700">
          El stock negativo se valoriza en cero: un activo negativo no significa nada.
        </p>
      </Seccion>

      <SerieMensual titulo="Ventas por mes" periodos={datos.ventasPorMes} />
      <SerieMensual titulo="Compras por mes" periodos={datos.comprasPorMes} />

      <Seccion titulo="Articulos mas vendidos">
        {datos.masVendidos.length === 0 ? (
          <p className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-6 text-center text-sm text-masa-700">
            Todavia no hay ventas registradas.
          </p>
        ) : (
          <Tabla
            columnas={COLUMNAS_VENDIDOS}
            filas={datos.masVendidos}
            claveDeFila={(a) => a.articuloId}
          />
        )}
      </Seccion>
    </div>
  );
}

/* --------------------------------- Usuarios -------------------------------- */

const COLUMNAS_USUARIOS: readonly Columna<UsuarioVista>[] = [
  { clave: 'usuario', titulo: 'Usuario', celda: (u) => <span className="font-mono">{u.username}</span> },
  {
    clave: 'rol',
    titulo: 'Rol',
    celda: (u) => (
      <Pastilla texto={ETIQUETA_ROL[u.rol]} tono={u.rol === 'admin' ? 'info' : 'neutro'} />
    ),
  },
  {
    clave: 'activo',
    titulo: 'Estado',
    celda: (u) => (u.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />),
  },
];

export function PantallaUsuarios(): JSX.Element {
  const estado = usarRecurso(() => obtenerUsuarios(), []);

  return (
    <Vista
      estado={estado}
      que="los usuarios"
      tituloVacio="Sin usuarios"
      detalleVacio="No hay usuarios cargados. Corre el seed para crear el administrador inicial."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <>
          <p className="mb-2 text-xs text-masa-700">
            El hash de contrasena nunca sale del servidor: esta pantalla solo lee usuario, rol y
            estado.
          </p>
          <Tabla columnas={COLUMNAS_USUARIOS} filas={filas} claveDeFila={(u) => u.id} />
        </>
      )}
    </Vista>
  );
}

/* ------------------------------- Contabilidad ------------------------------ */

/**
 * Contabilidad todavia NO existe: no hay plan de cuentas, ni asientos, ni libro
 * IVA en el modelo de datos. En vez de simular una pantalla vacia, se dice que
 * falta y que decision hay que tomar antes de construirla.
 */
export function PantallaContabilidad(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-ficha border border-alerta-200 bg-alerta-50 px-5 py-4">
        <p className="font-semibold text-alerta-700">Modulo no implementado</p>
        <p className="mt-1 text-sm text-masa-900">
          El modelo de datos todavia no tiene plan de cuentas, asientos ni libro IVA. Esta pantalla
          existe para marcar el lugar del modulo, no para simular que funciona.
        </p>
      </div>

      <div className="rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
          Que hace falta definir primero
        </h2>
        <ul className="mt-2 space-y-2 text-sm text-masa-900">
          <li>
            <strong>De donde salen los asientos.</strong> El ledger de cuentas corrientes ya usa
            partida doble (debe / haber), asi que lo natural es generar los asientos desde los
            ledgers existentes en vez de armar un modulo contable desconectado que haya que
            alimentar aparte.
          </li>
          <li>
            <strong>Facturacion e IVA.</strong> Hoy el total de una venta es un unico entero: no
            hay neto, alicuota, tipo de comprobante, punto de venta ni numeracion. Sin eso no hay
            libro IVA posible.
          </li>
          <li>
            <strong>Metodo de costeo.</strong> El costo del articulo es un cache sin metodo
            declarado. Sin definir FIFO o promedio ponderado no se puede calcular resultado.
          </li>
        </ul>
      </div>

      <p className="text-xs text-masa-700">
        Lo que si existe y alimenta a este modulo cuando se construya: los dos ledgers, las compras
        y ventas con sus items, y la caja con su arqueo.
      </p>
    </div>
  );
}

/* ------------------------- Facturacion electronica ------------------------- */

/**
 * ARCA todavia no esta integrado. La pantalla existe para que el alcance quede
 * a la vista: el cliente es Responsable Inscripto y VA a facturar desde aca.
 * El motor fiscal (WSAA + WSFEv1) ya esta resuelto y probado en StockFlow y se
 * porta cuando el circuito de ventas este construido.
 */
export function PantallaFacturacion(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-ficha border border-info-200 bg-info-50 px-5 py-4">
        <p className="font-semibold text-info-700">En preparacion</p>
        <p className="mt-1 text-sm text-masa-900">
          El cliente es Responsable Inscripto: la facturacion electronica con CAE de ARCA es parte
          del alcance confirmado. El motor fiscal (autenticacion WSAA con firma CMS y emision por
          WSFEv1) ya esta construido y probado en produccion en otro producto de BPSG, y se porta
          aca cuando exista el circuito de ventas.
        </p>
      </div>

      <div className="rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
          Que falta para activarla
        </h2>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-masa-900">
          <li>
            <strong>Circuito de ventas.</strong> Hoy las ventas son datos de demostracion: no se
            emiten desde la interfaz. Primero se construye emitir la venta; facturarla es el paso
            siguiente del mismo flujo.
          </li>
          <li>
            <strong>Datos fiscales en la venta.</strong> Neto, alicuota de IVA, tipo de comprobante
            (A/B), punto de venta y numeracion. Definidos junto con el circuito.
          </li>
          <li>
            <strong>Tramite del cliente.</strong> Certificado digital de ARCA (X.509) asociado al
            CUIT de la fabrica, alta del punto de venta para factura electronica, y pruebas en
            homologacion antes de tocar produccion.
          </li>
        </ol>
      </div>

      <div className="rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
          Lo que ya queda resuelto desde ahora
        </h2>
        <ul className="mt-2 space-y-2 text-sm text-masa-900">
          <li>
            <strong>CUIT de clientes y proveedores</strong> ya se cargan en los maestros: son el
            dato clave para discriminar comprobantes A y B.
          </li>
          <li>
            <strong>Dinero en centavos enteros</strong> en toda la base: los importes fiscales no
            arrastran errores de redondeo.
          </li>
          <li>
            <strong>Cheques y cuentas corrientes</strong> ya registran como se cobra: la factura se
            engancha a esos medios de pago sin rehacer nada.
          </li>
        </ul>
      </div>
    </div>
  );
}
