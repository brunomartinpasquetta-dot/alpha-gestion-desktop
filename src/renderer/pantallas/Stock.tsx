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

function PantallaSaldos({
  grupo,
  que,
  tituloVacio,
  detalleVacio,
  articuloSeleccionadoId,
  alSeleccionarArticulo,
}: PropsConSeleccion & {
  readonly grupo: 'insumos' | 'productos';
  readonly que: string;
  readonly tituloVacio: string;
  readonly detalleVacio: string;
}): JSX.Element {
  const estado = usarRecurso(() => obtenerStock(grupo), [grupo]);

  return (
    <Vista
      estado={estado}
      que={que}
      tituloVacio={tituloVacio}
      detalleVacio={detalleVacio}
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <Tabla
          columnas={columnasSaldo()}
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
  );
}

export function PantallaStockInsumos(props: PropsConSeleccion): JSX.Element {
  return (
    <PantallaSaldos
      {...props}
      grupo="insumos"
      que="el stock de insumos"
      tituloVacio="Sin insumos cargados"
      detalleVacio="No hay materias primas ni pre-elaborados activos. Carga los datos de prueba para ver el modulo en funcionamiento."
    />
  );
}

export function PantallaStockProductos(props: PropsConSeleccion): JSX.Element {
  return (
    <PantallaSaldos
      {...props}
      grupo="productos"
      que="el stock de productos"
      tituloVacio="Sin productos terminados"
      detalleVacio="No hay productos terminados activos. Carga los datos de prueba para ver el modulo en funcionamiento."
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
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo articulo
        </BotonPrimario>
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
    </div>
  );
}
