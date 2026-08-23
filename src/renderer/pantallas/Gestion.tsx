/**
 * Pantallas de gestion: caja general, estadisticas, usuarios y contabilidad.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import {
  CONFIRMACION_EMPEZAR_DE_CERO,
  ETIQUETA_ROL,
  type ArticuloVendido,
  type DatosExistentes,
  type ResultadoInicializacion,
  type EntradaConfiguracionFiscal,
  type Estadisticas,
  type PeriodoEstadistica,
  type ResultadoPruebaArca,
  type ResumenCajaGeneral,
  type UsuarioVista,
} from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion, TarjetaIndicador } from '../componentes/comunes';
import { Aviso, BotonFila, BotonPrimario, CampoSelector, CampoTexto, ModalFormulario } from '../componentes/Formulario';
import { BarraFiltros, RANGO_VACIO, SelectorFiltro, type RangoFechas } from '../componentes/filtros';
import { FormularioUsuario } from './FormulariosMaestros';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  cambiarActivoUsuario,
  cargarDemostracion,
  empezarDeCero,
  guardarConfigFiscal,
  obtenerCajaGeneral,
  obtenerDatosDemo,
  obtenerConfigFiscal,
  obtenerEstadisticas,
  obtenerUsuarios,
  probarConexionArca,
} from '../servicios/cliente';
import { aCentavos, formatearCantidad, formatearEntero, formatearFecha, formatearMoneda, formatearMonedaConSigno } from '../utiles/formato';

/* ------------------------------- Caja general ------------------------------ */

function PestanaResumenCajas(): JSX.Element {
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

/**
 * Panel para dejar la base lista para el arranque real. Vive en la pantalla de
 * usuarios porque es una tarea de administracion que se hace UNA vez, el dia que
 * la fabrica empieza a cargar sus datos.
 */
function PanelEmpezarDeCero(): JSX.Element {
  const [datos, setDatos] = useState<DatosExistentes[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [confirmacion, setConfirmacion] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoInicializacion | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    obtenerDatosDemo()
      .then(setDatos)
      .catch(() => setDatos([]));
  }, []);

  const total = (datos ?? []).reduce((suma, d) => suma + d.filas, 0);

  const ejecutar = (): void => {
    setTrabajando(true);
    setError(null);
    empezarDeCero(confirmacion)
      .then((r) => {
        setResultado(r);
        setAbierto(false);
        setConfirmacion('');
        return obtenerDatosDemo().then(setDatos);
      })
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)))
      .finally(() => setTrabajando(false));
  };

  if (resultado !== null) {
    return (
      <div className="rounded-ficha border border-menta-200 bg-menta-50 px-5 py-4">
        <p className="font-semibold text-menta-700">La base quedo lista para arrancar</p>
        <p className="mt-1 text-sm text-masa-900">
          Se borraron {resultado.filasBorradas} registros de demostracion. Ya se pueden cargar los
          articulos, clientes y proveedores reales, y despues el stock inicial con un ajuste.
        </p>
        <p className="mt-2 font-mono text-xs text-masa-700">
          Copia de seguridad: {resultado.rutaCopiaSeguridad}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-ficha border border-alerta-200 bg-alerta-50 px-5 py-4">
      <p className="font-semibold text-alerta-700">Empezar con los datos reales</p>
      {total === 0 ? (
        <div className="mt-1 space-y-2">
          <p className="text-sm text-masa-900">
            La base esta vacia: se puede empezar a cargar los datos reales de la fabrica.
          </p>
          <p className="text-sm text-masa-900">
            Si primero queres <strong>ver el sistema funcionando</strong>, carga una fabrica de
            ejemplo con insumos, recetas, productos, clientes y operaciones ya hechas. Despues se
            borra con el mismo panel.
          </p>
          <button
            type="button"
            onClick={() => {
              setTrabajando(true);
              setError(null);
              cargarDemostracion()
                .then((r) => {
                  setError(null);
                  window.alert(`${r.detalle} Se crearon ${r.creados} registros.`);
                  return obtenerDatosDemo().then(setDatos);
                })
                .catch((causa: unknown) =>
                  setError(causa instanceof Error ? causa.message : String(causa)),
                )
                .finally(() => setTrabajando(false));
            }}
            disabled={trabajando}
            className="rounded-ficha border border-masa-300 bg-white px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-50 disabled:opacity-50"
          >
            {trabajando ? 'Cargando...' : 'Cargar una fabrica de ejemplo'}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-masa-900">
            El sistema tiene <strong>{total} registros</strong> de demostracion (ventas, compras,
            stock, clientes). El dia que la fabrica empiece a operar hay que sacarlos: un stock
            inventado contamina todos los numeros. Antes de borrar se guarda una copia completa de
            la base.
          </p>
          <p className="mt-2 text-sm text-masa-900">
            <strong>Se conservan:</strong> unidades de medida, usuarios y la configuracion de ARCA.
          </p>

          {!abierto ? (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="mt-3 rounded-ficha border border-peligro-300 bg-white px-4 py-2 text-sm font-medium text-peligro-600 outline-none hover:bg-peligro-50 focus-visible:ring-2 focus-visible:ring-peligro-400"
            >
              Preparar la base para el arranque...
            </button>
          ) : (
            <div className="mt-3 space-y-2 rounded-ficha border border-peligro-300 bg-white p-3">
              <p className="text-sm text-masa-900">
                Escribi <strong className="font-mono">{CONFIRMACION_EMPEZAR_DE_CERO}</strong> para
                confirmar:
              </p>
              <input
                value={confirmacion}
                onChange={(e) => setConfirmacion(e.target.value)}
                aria-label="Confirmacion"
                className="h-10 w-full rounded-ficha border border-masa-300 px-3 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-peligro-400"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={ejecutar}
                  disabled={confirmacion !== CONFIRMACION_EMPEZAR_DE_CERO || trabajando}
                  className="rounded-ficha bg-peligro-600 px-4 py-2 text-sm font-bold text-white outline-none hover:bg-peligro-700 disabled:bg-masa-300 disabled:text-masa-700"
                >
                  {trabajando ? 'Preparando...' : 'Borrar los datos de demostracion'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAbierto(false);
                    setConfirmacion('');
                  }}
                  className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 hover:bg-masa-50"
                >
                  Cancelar
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function PantallaUsuarios(): JSX.Element {
  const estado = usarRecurso(() => obtenerUsuarios(), []);
  const [enEdicion, setEnEdicion] = useState<UsuarioVista | null | undefined>(undefined);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const cambiarActivo = (usuario: UsuarioVista): void => {
    const alta = !usuario.activo;
    if (!alta && !window.confirm(`¿Dar de baja a ${usuario.username}? No va a poder entrar mas.`)) return;
    setAviso(null);
    cambiarActivoUsuario(usuario.id, alta)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `${usuario.username} ${alta ? 'reactivado' : 'dado de baja'}.` });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          El administrador puede todo; el empleado opera pero no administra usuarios.
        </p>
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo usuario
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <PanelEmpezarDeCero />
      <Vista
      estado={estado}
      que="los usuarios"
      tituloVacio="Sin usuarios"
      detalleVacio="Crea el primer usuario con el boton Nuevo usuario."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <>
          <p className="mb-2 text-xs text-masa-700">
            El hash de contrasena nunca sale del servidor: esta pantalla solo lee usuario, rol y
            estado.
          </p>
          <Tabla
            columnas={[
              ...COLUMNAS_USUARIOS,
              {
                clave: 'acciones',
                titulo: 'Acciones',
                celda: (u: UsuarioVista) => (
                  <div className="flex gap-1">
                    <BotonFila onClick={() => setEnEdicion(u)}>Editar</BotonFila>
                    <BotonFila onClick={() => cambiarActivo(u)} tono={u.activo ? 'peligro' : 'neutro'}>
                      {u.activo ? 'Dar de baja' : 'Reactivar'}
                    </BotonFila>
                  </div>
                ),
              },
            ]}
            filas={filas}
            claveDeFila={(u) => u.id}
          />
        </>
      )}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioUsuario
          usuario={enEdicion}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje) => {
            setEnEdicion(undefined);
            estado.recargar();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}
    </div>
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
 * Configuracion de ARCA. La factura NO se emite desde aca: se emite EN la venta
 * (como en StockFlow). Esta pantalla solo define con que datos y con que
 * certificado se le habla a ARCA, y permite probar la conexion antes de operar.
 */
/**
 * Campo de ruta de archivo con selector del sistema. Escribir la ruta a mano es
 * la principal fuente de errores al configurar ARCA —sobre todo en Windows, con
 * sus barras invertidas— y el sintoma es un rechazo que no explica nada.
 */
function CampoArchivo({
  id,
  rotulo,
  valor,
  extensiones,
  alCambiar,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: string;
  readonly extensiones: readonly string[];
  readonly alCambiar: (valor: string) => void;
}): JSX.Element {
  const puedeBuscar = typeof window.alfajores?.archivos?.elegir === 'function';
  const buscar = (): void => {
    void window.alfajores?.archivos.elegir(rotulo, extensiones).then((ruta) => {
      if (ruta !== null && ruta !== undefined) alCambiar(ruta);
    });
  };

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
        {rotulo}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          placeholder={extensiones.map((e) => `archivo.${e}`).join(' / ')}
          className="h-10 min-w-0 flex-1 rounded-ficha border border-masa-300 bg-white px-3 font-mono text-xs text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400"
        />
        {puedeBuscar && (
          <button
            type="button"
            onClick={buscar}
            className="shrink-0 rounded-ficha border border-masa-300 px-3 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Buscar...
          </button>
        )}
      </div>
    </div>
  );
}

export function PantallaFacturacion(): JSX.Element {
  const [config, setConfig] = useState<EntradaConfiguracionFiscal | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [probando, setProbando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);
  const [prueba, setPrueba] = useState<ResultadoPruebaArca | null>(null);

  useEffect(() => {
    obtenerConfigFiscal()
      .then((datos) => setConfig({ ...datos }))
      .catch((causa: unknown) => setErrorCarga(causa instanceof Error ? causa.message : String(causa)));
  }, []);

  const editar = <C extends keyof EntradaConfiguracionFiscal>(
    campo: C,
    valor: EntradaConfiguracionFiscal[C],
  ): void => setConfig((previo) => (previo === null ? previo : { ...previo, [campo]: valor }));

  const guardar = (): void => {
    if (config === null) return;
    setGuardando(true);
    setAviso(null);
    guardarConfigFiscal(config)
      .then((datos) => {
        setConfig({ ...datos });
        setAviso(
          datos.habilitada
            ? { tono: 'ok', texto: 'Configuracion guardada. Ya se puede facturar desde la venta.' }
            : {
                tono: 'mal',
                texto:
                  'Guardado, pero la facturacion queda DESACTIVADA: faltan CUIT de 11 digitos, certificado o clave.',
              },
        );
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      )
      .finally(() => setGuardando(false));
  };

  const probar = (): void => {
    setProbando(true);
    setPrueba(null);
    setAviso(null);
    probarConexionArca()
      .then(setPrueba)
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      )
      .finally(() => setProbando(false));
  };

  if (errorCarga !== null) {
    return (
      <EstadoError
        mensaje={`No se pudo leer la configuracion fiscal: ${errorCarga}`}
        alReintentar={() => window.location.reload()}
      />
    );
  }
  if (config === null) return <EstadoCargando que="la configuracion fiscal" />;

  const campo =
    'h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';
  const rotulo = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div
        className={[
          'rounded-ficha border px-5 py-4',
          config.habilitada ? 'border-menta-200 bg-menta-50' : 'border-info-200 bg-info-50',
        ].join(' ')}
      >
        <p className={config.habilitada ? 'font-semibold text-menta-700' : 'font-semibold text-info-700'}>
          {config.habilitada ? 'Facturacion electronica activa' : 'Facturacion electronica sin configurar'}
        </p>
        <p className="mt-1 text-sm text-masa-900">
          La factura se emite <strong>en la venta</strong>: al confirmar una venta con Factura A o B,
          el sistema pide el CAE a ARCA y solo registra la operacion si ARCA la autoriza. Aca se
          define el emisor y el certificado.
        </p>
      </div>

      <div className="space-y-4 rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={rotulo}>Entorno</span>
            <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
              {(
                [
                  ['homologacion', 'Homologacion (pruebas)'],
                  ['produccion', 'Produccion (real)'],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => editar('entorno', clave)}
                  className={[
                    'flex-1 rounded-pastilla px-2 py-1.5 text-xs font-medium outline-none',
                    config.entorno === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
                  ].join(' ')}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="f-pv" className={rotulo}>Punto de venta</label>
            <input
              id="f-pv"
              value={config.puntoVenta}
              onChange={(e) => editar('puntoVenta', Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1))}
              inputMode="numeric"
              className={campo}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="f-cuit" className={rotulo}>CUIT del emisor</label>
            <input
              id="f-cuit"
              value={config.cuit}
              onChange={(e) => editar('cuit', e.target.value)}
              placeholder="30712345678"
              inputMode="numeric"
              className={campo}
            />
          </div>
          <div>
            <label htmlFor="f-razon" className={rotulo}>Razon social</label>
            <input
              id="f-razon"
              value={config.razonSocial ?? ''}
              onChange={(e) => editar('razonSocial', e.target.value)}
              className={campo}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <span className={rotulo}>Condicion frente al IVA</span>
            <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
              {(
                [
                  ['RI', 'Responsable Inscripto'],
                  ['MT', 'Monotributo'],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => editar('condicionIva', clave)}
                  className={[
                    'flex-1 rounded-pastilla px-2 py-1.5 text-xs font-medium outline-none',
                    config.condicionIva === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
                  ].join(' ')}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor="f-iibb" className={rotulo}>Ingresos brutos</label>
            <input
              id="f-iibb"
              value={config.iibb ?? ''}
              onChange={(e) => editar('iibb', e.target.value)}
              className={campo}
            />
          </div>
        </div>

        <CampoArchivo
          id="f-cert"
          rotulo="Certificado ARCA (.crt / .pem)"
          valor={config.rutaCertificado ?? ''}
          extensiones={['crt', 'pem', 'cer']}
          alCambiar={(v) => editar('rutaCertificado', v)}
        />
        <div>
          <CampoArchivo
            id="f-key"
            rotulo="Clave privada (.key)"
            valor={config.rutaClave ?? ''}
            extensiones={['key', 'pem']}
            alCambiar={(v) => editar('rutaClave', v)}
          />
          <p className="mt-1 text-xs text-masa-700">
            Son los dos archivos del tramite de ARCA. No se copian a ningun lado: se leen del disco
            cada vez que se firma.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm text-masa-900">
          <input
            type="checkbox"
            checked={config.habilitada}
            onChange={(e) => editar('habilitada', e.target.checked)}
            className="h-4 w-4"
          />
          Ofrecer Factura A y B al registrar una venta
        </label>

        {aviso !== null && (
          <p
            role={aviso.tono === 'mal' ? 'alert' : 'status'}
            className={[
              'rounded-ficha border px-3 py-2 text-sm',
              aviso.tono === 'ok'
                ? 'border-menta-200 bg-menta-50 text-menta-700'
                : 'border-peligro-200 bg-peligro-50 text-peligro-600',
            ].join(' ')}
          >
            {aviso.texto}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="rounded-ficha bg-dulce-600 px-5 py-2 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300"
          >
            {guardando ? 'Guardando...' : 'Guardar configuracion'}
          </button>
          <button
            type="button"
            onClick={probar}
            disabled={probando}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:opacity-50"
          >
            {probando ? 'Probando...' : 'Probar conexion con ARCA'}
          </button>
        </div>
      </div>

      {prueba !== null && (
        <div className="rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
            Prueba en {prueba.entorno}
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-masa-900">
            <li>
              Servidores ARCA:{' '}
              {prueba.servidores === null ? (
                <span className="text-peligro-600">sin respuesta</span>
              ) : (
                <span className="font-mono text-xs">{prueba.servidores}</span>
              )}
            </li>
            <li>
              Autenticacion:{' '}
              {prueba.autenticacion === null ? (
                <span className="text-masa-700">no se probo</span>
              ) : (
                <span className="text-menta-700">{prueba.autenticacion}</span>
              )}
            </li>
            <li>
              Ultima Factura B autorizada:{' '}
              {prueba.ultimoNumero === null ? (
                <span className="text-masa-700">—</span>
              ) : (
                <span className="font-mono">N° {prueba.ultimoNumero}</span>
              )}
            </li>
          </ul>
          {prueba.errores.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-peligro-600">
              {prueba.errores.map((mensaje) => (
                <li key={mensaje}>{mensaje}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------ Caja General (caja fuerte) ----------------------- */

interface SaldosCajaGeneral {
  total: number;
  efectivo: number;
  electronico: number;
  chequesEnCartera: number;
  cantidadCheques: number;
}

interface MovimientoCajaGeneral {
  id: number;
  fecha: string;
  tipo: 'ingreso' | 'egreso' | 'desde_caja_diaria';
  monto: number;
  concepto: string;
  categoria: string | null;
  esEfectivo: boolean;
  saldoTotalDespues: number;
  saldoEfectivoDespues: number;
  saldoElectronicoDespues: number;
  usuario: string | null;
}

const CATEGORIAS: readonly { valor: string; etiqueta: string }[] = [
  { valor: 'retiro', etiqueta: 'Retiro' },
  { valor: 'servicios', etiqueta: 'Servicios' },
  { valor: 'sueldos', etiqueta: 'Sueldos' },
  { valor: 'impuestos', etiqueta: 'Impuestos' },
  { valor: 'proveedores', etiqueta: 'Proveedores' },
  { valor: 'deposito_cierre', etiqueta: 'Deposito de cierre' },
  { valor: 'otros', etiqueta: 'Otros' },
];

const ETIQUETA_TIPO_CG: Record<string, string> = {
  ingreso: 'Ingreso',
  egreso: 'Egreso',
  desde_caja_diaria: 'Desde caja diaria',
};

async function pedirCg<T>(ruta: string, init?: RequestInit): Promise<T> {
  const r = await fetch(ruta, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const cuerpo = (await r.json()) as { datos?: T; error?: { mensaje?: string } };
  if (!r.ok || cuerpo.datos === undefined) {
    throw new Error(cuerpo.error?.mensaje ?? `El servidor respondio ${r.status}.`);
  }
  return cuerpo.datos;
}

/** Alta manual de ingreso o egreso de la caja fuerte. */
function ModalMovimientoCg({
  tipo,
  saldos,
  alCerrar,
  alGuardar,
}: {
  readonly tipo: 'ingreso' | 'egreso';
  readonly saldos: SaldosCajaGeneral;
  readonly alCerrar: () => void;
  readonly alGuardar: () => void;
}): JSX.Element {
  const [monto, setMonto] = useState('');
  const [concepto, setConcepto] = useState('');
  const [categoria, setCategoria] = useState('');
  const [esEfectivo, setEsEfectivo] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const centavos = aCentavos(Number(monto.replace(',', '.')));
  const valido = centavos > 0 && concepto.trim().length >= 2;

  const guardar = async (): Promise<void> => {
    if (!valido) return;
    // Un egreso mayor al saldo deja la caja en rojo. No se bloquea (puede ser
    // una carga atrasada), pero se avisa antes de confirmarlo.
    if (tipo === 'egreso') {
      const disponible = esEfectivo ? saldos.efectivo : saldos.electronico;
      if (centavos > disponible) {
        const nombre = esEfectivo ? 'efectivo' : 'electronico';
        const ok = window.confirm(
          `En la caja general hay ${formatearMoneda(disponible)} en ${nombre} y estas sacando ${formatearMoneda(centavos)}.\n\n` +
            `El saldo ${nombre} quedaria en ${formatearMoneda(disponible - centavos)}.\n\n¿Registrar igual?`,
        );
        if (!ok) return;
      }
    }
    setGuardando(true);
    setError(null);
    try {
      await pedirCg('/api/caja-general/movimientos', {
        method: 'POST',
        body: JSON.stringify({
          tipo,
          monto: centavos,
          concepto: concepto.trim(),
          categoria: categoria === '' ? null : categoria,
          esEfectivo,
        }),
      });
      alGuardar();
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : String(causa));
      setGuardando(false);
    }
  };

  return (
    <ModalFormulario
      titulo={tipo === 'ingreso' ? 'Ingreso a caja general' : 'Egreso de caja general'}
      descripcion="Movimiento manual de la caja fuerte. No toca el arqueo de la caja diaria."
      ancho="max-w-lg"
      error={error}
      guardando={guardando}
      puedeGuardar={valido}
      etiquetaGuardar={tipo === 'ingreso' ? 'Registrar ingreso' : 'Registrar egreso'}
      alCerrar={alCerrar}
      alGuardar={() => void guardar()}
    >
      <CampoTexto id="cg-monto" rotulo="Monto ($)" valor={monto} alCambiar={setMonto} maximo={14} />
      <CampoTexto id="cg-concepto" rotulo="Concepto" valor={concepto} alCambiar={setConcepto} maximo={200} />
      <CampoSelector
        id="cg-categoria"
        rotulo="Categoria"
        valor={categoria}
        vacio="Sin categoria"
        opciones={CATEGORIAS.map((c) => ({ valor: c.valor, etiqueta: c.etiqueta }))}
        alCambiar={(v) => setCategoria(String(v))}
      />
      <div>
        <p className="mb-1 text-micro font-bold uppercase tracking-wide text-masa-700">Medio</p>
        {(
          [
            [true, 'Efectivo (billetes en la caja fuerte)'],
            [false, 'Electronico (transferencia, tarjeta)'],
          ] as const
        ).map(([valor, etiqueta]) => (
          <label key={String(valor)} className="flex cursor-pointer items-center gap-2 py-0.5 text-sm">
            <input
              type="radio"
              name="cg-medio"
              checked={esEfectivo === valor}
              onChange={() => setEsEfectivo(valor)}
              className="accent-dulce-600"
            />
            {etiqueta}
          </label>
        ))}
      </div>
    </ModalFormulario>
  );
}

function PestanaCajaFuerte(): JSX.Element {
  const saldos = usarRecurso<SaldosCajaGeneral>(() => pedirCg('/api/caja-general/saldos'), []);
  const [rango, setRango] = useState<RangoFechas>(RANGO_VACIO);
  const [tipoFiltro, setTipoFiltro] = useState('');
  const [medioFiltro, setMedioFiltro] = useState('');
  const [alta, setAlta] = useState<'ingreso' | 'egreso' | null>(null);
  const [version, setVersion] = useState(0);

  const movimientos = usarRecurso<MovimientoCajaGeneral[]>(() => {
    const p = new URLSearchParams();
    if (rango.desde !== '') p.set('desde', rango.desde);
    if (rango.hasta !== '') p.set('hasta', rango.hasta);
    if (tipoFiltro !== '') p.set('tipo', tipoFiltro);
    if (medioFiltro !== '') p.set('medio', medioFiltro);
    return pedirCg(`/api/caja-general/movimientos?${p.toString()}`);
  }, [rango.desde, rango.hasta, tipoFiltro, medioFiltro, version]);

  const refrescar = (): void => {
    saldos.recargar();
    setVersion((v) => v + 1);
  };

  const lista = movimientos.datos ?? [];
  const ingresos = lista.filter((m) => m.tipo !== 'egreso').reduce((s, m) => s + m.monto, 0);
  const egresos = lista.filter((m) => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0);
  const hayFiltros = rango.desde !== '' || rango.hasta !== '' || tipoFiltro !== '' || medioFiltro !== '';

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Saldos de la caja fuerte"
        acciones={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAlta('ingreso')}
              className="h-9 rounded-none border border-menta-500 bg-menta-600 px-4 text-sm font-bold uppercase tracking-wide text-white"
            >
              Ingreso
            </button>
            <button
              type="button"
              onClick={() => setAlta('egreso')}
              className="h-9 rounded-none border border-peligro-300 bg-white px-4 text-sm font-bold uppercase tracking-wide text-peligro-700"
            >
              Egreso
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador
            rotulo="Efectivo"
            valor={formatearMoneda(saldos.datos?.efectivo ?? 0)}
            detalle="Billetes en la caja fuerte"
          />
          <TarjetaIndicador
            rotulo="Electronico"
            valor={formatearMoneda(saldos.datos?.electronico ?? 0)}
            detalle="Transferencias y tarjetas"
            tono="info"
          />
          <TarjetaIndicador
            rotulo="Cheques en cartera"
            valor={formatearMoneda(saldos.datos?.chequesEnCartera ?? 0)}
            detalle={`${formatearEntero(saldos.datos?.cantidadCheques ?? 0)} cheque(s) — todavia no cobrados`}
            tono="alerta"
          />
          <TarjetaIndicador
            rotulo="Saldo total"
            valor={formatearMoneda(saldos.datos?.total ?? 0)}
            detalle="Efectivo + electronico (sin cheques)"
            tono="positivo"
          />
        </div>
      </Seccion>

      <Seccion titulo="Movimientos">
        <BarraFiltros
          rango={rango}
          alCambiarRango={setRango}
          selectores={
            <>
              <SelectorFiltro
                valor={tipoFiltro}
                alCambiar={(v) => setTipoFiltro(String(v))}
                vacio="Todos los tipos"
                opciones={[
                  { valor: 'ingreso', etiqueta: 'Ingresos' },
                  { valor: 'egreso', etiqueta: 'Egresos' },
                  { valor: 'desde_caja_diaria', etiqueta: 'Desde caja diaria' },
                ]}
              />
              <SelectorFiltro
                valor={medioFiltro}
                alCambiar={(v) => setMedioFiltro(String(v))}
                vacio="Todos los medios"
                opciones={[
                  { valor: 'efectivo', etiqueta: 'Efectivo' },
                  { valor: 'electronico', etiqueta: 'Electronico' },
                ]}
              />
            </>
          }
          resumen={`${lista.length} movimiento(s) · ingresos ${formatearMoneda(ingresos)} · egresos ${formatearMoneda(egresos)}`}
          alLimpiar={() => {
            setRango(RANGO_VACIO);
            setTipoFiltro('');
            setMedioFiltro('');
          }}
          hayFiltros={hayFiltros}
        />
        {movimientos.cargando ? (
          <p className="px-3 py-4 text-sm text-masa-700">Cargando movimientos...</p>
        ) : lista.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            Sin movimientos en el periodo.
          </p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-ficha border border-masa-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Tipo</th>
                  <th className="px-3 py-2 font-semibold">Concepto</th>
                  <th className="px-3 py-2 font-semibold">Categoria</th>
                  <th className="px-3 py-2 font-semibold">Medio</th>
                  <th className="px-3 py-2 text-right font-semibold">Monto</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((m) => (
                  <tr key={m.id} className="border-b border-masa-100">
                    <td className="whitespace-nowrap px-3 py-1.5 text-masa-800">{formatearFecha(m.fecha)}</td>
                    <td className="px-3 py-1.5 text-masa-800">{ETIQUETA_TIPO_CG[m.tipo] ?? m.tipo}</td>
                    <td className="px-3 py-1.5 text-masa-900">{m.concepto}</td>
                    <td className="px-3 py-1.5 text-masa-700">
                      {CATEGORIAS.find((c) => c.valor === m.categoria)?.etiqueta ?? '—'}
                    </td>
                    <td className="px-3 py-1.5">
                      <Pastilla texto={m.esEfectivo ? 'Efectivo' : 'Electronico'} tono={m.esEfectivo ? 'positivo' : 'info'} />
                    </td>
                    <td
                      className={[
                        'px-3 py-1.5 text-right font-mono font-bold tabular-nums',
                        m.tipo === 'egreso' ? 'text-peligro-600' : 'text-menta-700',
                      ].join(' ')}
                    >
                      {m.tipo === 'egreso' ? '−' : '+'}
                      {formatearMoneda(m.monto)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-masa-800">
                      {formatearMoneda(m.saldoTotalDespues)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {alta !== null && saldos.datos !== null && (
        <ModalMovimientoCg
          tipo={alta}
          saldos={saldos.datos}
          alCerrar={() => setAlta(null)}
          alGuardar={() => {
            setAlta(null);
            refrescar();
          }}
        />
      )}
    </div>
  );
}

export function PantallaCajaGeneral(): JSX.Element {
  const [pestania, setPestania] = useState<'caja' | 'cajas'>('caja');
  const claseTab = (activa: boolean): string =>
    [
      'h-10 rounded-none border-b-2 px-4 text-sm font-bold uppercase tracking-wide',
      activa ? 'border-dulce-500 text-dulce-700' : 'border-transparent text-masa-700 hover:text-masa-900',
    ].join(' ');
  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-masa-200">
        <button type="button" className={claseTab(pestania === 'caja')} onClick={() => setPestania('caja')}>
          Caja general
        </button>
        <button type="button" className={claseTab(pestania === 'cajas')} onClick={() => setPestania('cajas')}>
          Cajas diarias
        </button>
      </div>
      {pestania === 'caja' ? <PestanaCajaFuerte /> : <PestanaResumenCajas />}
    </div>
  );
}

