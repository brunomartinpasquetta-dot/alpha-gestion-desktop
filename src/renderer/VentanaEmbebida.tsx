/**
 * Contenido de una ventana de modulo.
 *
 * Es lo que monta la ruta `#/embedded/<clave>`: la pantalla sola, SIN el chrome
 * de la ventana principal (menu, accesos, estado, barra de tareas). Esta ventana
 * ya es una ventana nativa del sistema operativo, con su propia barra de titulo,
 * asi que repetir el chrome adentro seria ruido.
 */

import { useEffect, useState } from 'react';

import { EstadoVacio } from './componentes/comunes';
import { PanelLedger } from './componentes/PanelLedger';
import { PantallaCaja, PantallaCuentasCorrientes } from './pantallas/Finanzas';
import {
  PantallaCajaGeneral,
  PantallaContabilidad,
  PantallaEstadisticas,
  PantallaUsuarios,
} from './pantallas/Gestion';
import { PantallaClientes, PantallaPrecios, PantallaProveedores } from './pantallas/Maestros';
import { PantallaCompras, PantallaPedidos, PantallaVentas } from './pantallas/Comercial';
import { PantallaInicio } from './pantallas/Inicio';
import { PantallaOrdenes, PantallaRecetas } from './pantallas/Produccion';
import {
  PantallaArticulos,
  PantallaStockInsumos,
  PantallaStockProductos,
  type PropsConSeleccion,
} from './pantallas/Stock';
import { definicionDeModulo, esClaveModulo, type ClaveModulo } from './ventanas';

interface ArticuloElegido {
  readonly id: number;
  readonly nombre: string;
  readonly codigo: string;
}

/**
 * Envuelve las pantallas de stock para que el detalle del ledger viva DENTRO de
 * la misma ventana. La seleccion es estado local: cada ventana de stock recuerda
 * su propio articulo abierto, sin pisarse con las demas.
 */
function ConPanelLedger({
  Pantalla,
}: {
  readonly Pantalla: (props: PropsConSeleccion) => JSX.Element;
}): JSX.Element {
  const [articulo, setArticulo] = useState<ArticuloElegido | null>(null);

  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-auto p-5">
        <Pantalla
          articuloSeleccionadoId={articulo?.id ?? null}
          alSeleccionarArticulo={(elegido) =>
            setArticulo((actual) => (actual?.id === elegido.id ? null : elegido))
          }
        />
      </div>

      {articulo !== null && (
        <PanelLedger
          articuloId={articulo.id}
          titulo={articulo.nombre}
          subtitulo={`Ledger de stock · ${articulo.codigo}`}
          alCerrar={() => setArticulo(null)}
        />
      )}
    </div>
  );
}

/** Pantallas que ocupan todo el ancho, sin panel lateral. */
function Simple({ children }: { readonly children: JSX.Element }): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>;
}

function contenidoDe(clave: ClaveModulo): JSX.Element {
  switch (clave) {
    case 'tablero':
      return <Simple><PantallaInicio /></Simple>;
    case 'stock-insumos':
      return <ConPanelLedger Pantalla={PantallaStockInsumos} />;
    case 'stock-productos':
      return <ConPanelLedger Pantalla={PantallaStockProductos} />;
    case 'articulos':
      return <ConPanelLedger Pantalla={PantallaArticulos} />;
    case 'recetas':
      return <Simple><PantallaRecetas /></Simple>;
    case 'ordenes':
      return <Simple><PantallaOrdenes /></Simple>;
    case 'pedidos':
      return <Simple><PantallaPedidos /></Simple>;
    case 'ventas':
      return <Simple><PantallaVentas /></Simple>;
    case 'compras':
      return <Simple><PantallaCompras /></Simple>;
    case 'caja':
      return <Simple><PantallaCaja /></Simple>;
    case 'cuentas-corrientes':
      return <Simple><PantallaCuentasCorrientes /></Simple>;
    case 'clientes':
      return <Simple><PantallaClientes /></Simple>;
    case 'proveedores':
      return <Simple><PantallaProveedores /></Simple>;
    case 'listas-precio':
      return <Simple><PantallaPrecios /></Simple>;
    case 'caja-general':
      return <Simple><PantallaCajaGeneral /></Simple>;
    case 'estadisticas':
      return <Simple><PantallaEstadisticas /></Simple>;
    case 'contabilidad':
      return <Simple><PantallaContabilidad /></Simple>;
    case 'usuarios':
      return <Simple><PantallaUsuarios /></Simple>;
    default:
      // Inalcanzable: la clave viene de una union cerrada. Existe para que
      // sumar un modulo sin su pantalla sea un error de compilacion.
      return <Simple><PantallaInicio /></Simple>;
  }
}

export function VentanaEmbebida({ clave }: { readonly clave: string }): JSX.Element {
  if (!esClaveModulo(clave)) {
    return (
      <div className="flex h-screen items-center justify-center bg-masa-100 p-8">
        <EstadoVacio
          titulo="Modulo desconocido"
          detalle={`No existe ningun modulo con la clave "${clave}". Cerra esta ventana y volve a abrirlo desde el menu.`}
        />
      </div>
    );
  }

  const definicion = definicionDeModulo(clave);

  // El titulo del HTML es unico para todo el bundle: cada ventana de modulo pisa
  // el suyo para que la barra del sistema y el conmutador de apps digan de que
  // modulo se trata, no "Alpha Gestion" repetido N veces.
  useEffect(() => {
    document.title = definicion.titulo;
  }, [definicion.titulo]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-masa-100 text-masa-900">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-masa-200 bg-white px-5 py-2.5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-masa-900">
            {definicion.titulo}
          </h1>
          <p className="truncate text-xs text-masa-700">{definicion.descripcion}</p>
        </div>
      </header>

      {contenidoDe(clave)}
    </div>
  );
}
