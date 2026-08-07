/**
 * Pantallas de stock: insumos, productos terminados y el maestro de articulos.
 *
 * Los tres saldos salen del ledger `movimientos_stock`. Al hacer clic en una fila
 * se abre el detalle de ese ledger, que es la prueba de que el numero no esta
 * guardado en ningun lado.
 */

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import {
  ETIQUETA_TIPO_ARTICULO,
  type ArticuloConStock,
  type SaldoStock,
  type TipoArticulo,
  type UnidadMedidaVista,
} from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Aviso, BotonFila, BotonPrimario } from '../componentes/Formulario';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  cambiarActivoArticulo,
  obtenerArticulos,
  obtenerStock,
  obtenerUnidades,
} from '../servicios/cliente';
import { FormularioArticulo } from './FormulariosMaestros';
import { FormularioAjusteStock } from './FormulariosProduccion';
import { formatearCajas, formatearCantidad, formatearMoneda } from '../utiles/formato';

export interface PropsConSeleccion {
  readonly articuloSeleccionadoId: number | null;
  readonly alSeleccionarArticulo: (articulo: { id: number; nombre: string; codigo: string }) => void;
}

/** Un articulo bajo su minimo se marca en ambar: es la alerta operativa del dia. */
function pastillaDeStock(bajoMinimo: boolean): JSX.Element {
  return bajoMinimo ? (
    <Pastilla texto="Bajo minimo" tono="alerta" />
  ) : (
    <Pastilla texto="En regla" tono="positivo" />
  );
}

function columnasSaldo(): readonly Columna<SaldoStock>[] {
  return [
    { clave: 'codigo', titulo: 'Codigo', celda: (a) => <span className="font-mono">{a.codigo}</span> },
    { clave: 'nombre', titulo: 'Articulo', celda: (a) => a.nombre },
    { clave: 'tipo', titulo: 'Tipo', celda: (a) => ETIQUETA_TIPO_ARTICULO[a.tipo] },
    { clave: 'unidad', titulo: 'Unidad', celda: (a) => a.unidadAbreviatura },
    { clave: 'stock', titulo: 'Stock', celda: (a) => formatearCantidad(a.stock), numerica: true },
    {
      clave: 'cajas',
      titulo: 'Cajas',
      celda: (a) => formatearCajas(a.stock, a.unidadesPorCaja),
      numerica: true,
    },
    {
      clave: 'minimo',
      titulo: 'Minimo',
      celda: (a) => (a.stockMin === null ? '—' : formatearCantidad(a.stockMin)),
      numerica: true,
    },
    { clave: 'estado', titulo: 'Estado', celda: (a) => pastillaDeStock(a.bajoMinimo) },
  ];
}

/**
 * Saldos de un grupo con su ABM.
 *
 * El alta, la edicion y la baja viven TAMBIEN aca, y no solo en el maestro de
 * articulos: quien esta mirando el stock de insumos y ve que falta cargar uno
 * espera darlo de alta ahi mismo, no ir a buscar otra pantalla.
 */
function PantallaSaldos({
  grupo,
  que,
  tipoNuevo,
  etiquetaNuevo,
  tituloVacio,
  detalleVacio,
  articuloSeleccionadoId,
  alSeleccionarArticulo,
}: PropsConSeleccion & {
  readonly grupo: 'insumos' | 'productos';
  readonly que: string;
  /** Tipo con el que arranca un alta desde esta pantalla. */
  readonly tipoNuevo: TipoArticulo;
  readonly etiquetaNuevo: string;
  readonly tituloVacio: string;
  readonly detalleVacio: string;
}): JSX.Element {
  const estado = usarRecurso(() => obtenerStock(grupo), [grupo]);
  // El saldo trae lo justo para la grilla; para editar hace falta el articulo
  // completo (unidad base, costo), asi que se carga el maestro en paralelo.
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedidaVista[]>([]);
  const [enEdicion, setEnEdicion] = useState<ArticuloConStock | null | undefined>(undefined);
  const [ajustando, setAjustando] = useState<ArticuloConStock | null | undefined>(undefined);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const recargarTodo = (): void => {
    estado.recargar();
    void obtenerArticulos().then(setArticulos);
  };

  useEffect(() => {
    void obtenerArticulos().then(setArticulos).catch(() => setArticulos([]));
    void obtenerUnidades().then(setUnidades).catch(() => setUnidades([]));
  }, []);

  const articuloDe = (articuloId: number): ArticuloConStock | undefined =>
    articulos.find((a) => a.id === articuloId);

  const editar = (articuloId: number): void => {
    const articulo = articuloDe(articuloId);
    if (articulo === undefined) {
      setAviso({ tono: 'mal', texto: 'No se pudo cargar el articulo. Volve a abrir la ventana.' });
      return;
    }
    setEnEdicion(articulo);
  };

  const darDeBaja = (fila: SaldoStock): void => {
    const articulo = articuloDe(fila.articuloId);
    if (articulo === undefined) return;
    if (!window.confirm(`¿Dar de baja ${fila.nombre}? Deja de ofrecerse al comprar y producir.`)) return;
    setAviso(null);
    cambiarActivoArticulo(fila.articuloId, false)
      .then(() => {
        recargarTodo();
        setAviso({ tono: 'ok', texto: `${fila.nombre} dado de baja.` });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  const columnas: readonly Columna<SaldoStock>[] = [
    ...columnasSaldo(),
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (a) => (
        <div className="flex gap-1">
          <BotonFila onClick={() => editar(a.articuloId)}>Editar</BotonFila>
          <BotonFila onClick={() => setAjustando(articuloDe(a.articuloId) ?? null)}>Ajustar</BotonFila>
          <BotonFila onClick={() => darDeBaja(a)} tono="peligro">
            Dar de baja
          </BotonFila>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Hace clic en una fila para ver de donde sale el saldo.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setAjustando(null)}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Ajustar stock
          </button>
          <BotonPrimario onClick={() => setEnEdicion(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {etiquetaNuevo}
          </BotonPrimario>
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que={que}
        tituloVacio={tituloVacio}
        detalleVacio={detalleVacio}
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => (
          <Tabla
            columnas={columnas}
            filas={filas}
            claveDeFila={(a) => a.articuloId}
            filaEnAlerta={(a) => a.bajoMinimo}
            filaSeleccionada={(a) => a.articuloId === articuloSeleccionadoId}
            alSeleccionar={(a) =>
              alSeleccionarArticulo({ id: a.articuloId, nombre: a.nombre, codigo: a.codigo })
            }
          />
        )}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioArticulo
          articulo={enEdicion}
          tipoSugerido={tipoNuevo}
          unidades={unidades}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje) => {
            setEnEdicion(undefined);
            recargarTodo();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}

      {ajustando !== undefined && (
        <FormularioAjusteStock
          articulo={ajustando}
          alCerrar={() => setAjustando(undefined)}
          alGuardar={(mensaje) => {
            setAjustando(undefined);
            recargarTodo();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}
    </div>
  );
}

export function PantallaStockInsumos(props: PropsConSeleccion): JSX.Element {
  return (
    <PantallaSaldos
      {...props}
      grupo="insumos"
      que="el stock de insumos"
      tipoNuevo="materia_prima"
      etiquetaNuevo="Nuevo insumo"
      tituloVacio="Sin insumos cargados"
      detalleVacio="Cargá la primera materia prima con el boton Nuevo insumo."
    />
  );
}

export function PantallaStockProductos(props: PropsConSeleccion): JSX.Element {
  return (
    <PantallaSaldos
      {...props}
      grupo="productos"
      que="el stock de productos"
      tipoNuevo="producto_terminado"
      etiquetaNuevo="Nuevo producto"
      tituloVacio="Sin productos terminados"
      detalleVacio="Cargá el primer producto con el boton Nuevo producto."
    />
  );
}

const COLUMNAS_ARTICULOS: readonly Columna<ArticuloConStock>[] = [
  { clave: 'codigo', titulo: 'Codigo', celda: (a) => <span className="font-mono">{a.codigo}</span> },
  { clave: 'nombre', titulo: 'Articulo', celda: (a) => a.nombre },
  { clave: 'tipo', titulo: 'Tipo', celda: (a) => ETIQUETA_TIPO_ARTICULO[a.tipo] },
  { clave: 'unidad', titulo: 'Unidad', celda: (a) => a.unidadAbreviatura },
  { clave: 'stock', titulo: 'Stock', celda: (a) => formatearCantidad(a.stock), numerica: true },
  {
    clave: 'cajas',
    titulo: 'Cajas',
    celda: (a) => formatearCajas(a.stock, a.unidadesPorCaja),
    numerica: true,
  },
  {
    clave: 'minimo',
    titulo: 'Minimo',
    celda: (a) => (a.stockMin === null ? '—' : formatearCantidad(a.stockMin)),
    numerica: true,
  },
  {
    clave: 'costo',
    titulo: 'Costo unit.',
    celda: (a) => (a.costoActual === null ? '—' : formatearMoneda(a.costoActual)),
    numerica: true,
  },
  {
    clave: 'activo',
    titulo: 'Estado',
    celda: (a) =>
      a.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />,
  },
];

export function PantallaArticulos({
  articuloSeleccionadoId,
  alSeleccionarArticulo,
}: PropsConSeleccion): JSX.Element {
  const estado = usarRecurso(() => obtenerArticulos(), []);
  const [enEdicion, setEnEdicion] = useState<ArticuloConStock | null | undefined>(undefined);
  // `undefined` = cerrado; `null` = elegir el articulo dentro del formulario.
  const [ajustando, setAjustando] = useState<ArticuloConStock | null | undefined>(undefined);
  const [unidades, setUnidades] = useState<UnidadMedidaVista[]>([]);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  useEffect(() => {
    obtenerUnidades()
      .then(setUnidades)
      .catch(() => setUnidades([]));
  }, []);

  const cambiarActivo = (articulo: ArticuloConStock): void => {
    const alta = !articulo.activo;
    if (!alta && !window.confirm(`¿Dar de baja ${articulo.nombre}? Deja de ofrecerse al vender y comprar.`)) return;
    setAviso(null);
    cambiarActivoArticulo(articulo.id, alta)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `${articulo.nombre} ${alta ? 'reactivado' : 'dado de baja'}.` });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  const columnas: readonly Columna<ArticuloConStock>[] = [
    ...COLUMNAS_ARTICULOS,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (a) => (
        <div className="flex gap-1">
          <BotonFila onClick={() => setEnEdicion(a)}>Editar</BotonFila>
          <BotonFila onClick={() => setAjustando(a)}>Ajustar</BotonFila>
          <BotonFila onClick={() => cambiarActivo(a)} tono={a.activo ? 'peligro' : 'neutro'}>
            {a.activo ? 'Dar de baja' : 'Reactivar'}
          </BotonFila>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Hace clic en una fila para ver su ledger de movimientos.
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setAjustando(null)}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Ajustar stock
          </button>
          <BotonPrimario onClick={() => setEnEdicion(null)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo articulo
          </BotonPrimario>
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="el maestro de articulos"
        tituloVacio="Sin articulos"
        detalleVacio="Cargá el primero con el boton Nuevo articulo."
        comandoVacio="npm run db:seed"
      >
        {(filas) => (
          <Tabla
            columnas={columnas}
            filas={filas}
            claveDeFila={(a) => a.id}
            filaEnAlerta={(a) => a.bajoMinimo}
            filaSeleccionada={(a) => a.id === articuloSeleccionadoId}
            alSeleccionar={(a) => alSeleccionarArticulo({ id: a.id, nombre: a.nombre, codigo: a.codigo })}
          />
        )}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioArticulo
          articulo={enEdicion}
          unidades={unidades}
          alCerrar={() => setEnEdicion(undefined)}
          alGuardar={(mensaje) => {
            setEnEdicion(undefined);
            estado.recargar();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}

      {ajustando !== undefined && (
        <FormularioAjusteStock
          articulo={ajustando}
          alCerrar={() => setAjustando(undefined)}
          alGuardar={(mensaje) => {
            setAjustando(undefined);
            estado.recargar();
            setAviso({ tono: 'ok', texto: mensaje });
          }}
        />
      )}
    </div>
  );
}
