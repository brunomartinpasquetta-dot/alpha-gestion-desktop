/**
 * Contenido de una ventana de modulo.
 *
 * Es lo que monta la ruta `#/embedded/<clave>`: la pantalla sola, SIN el chrome
 * de la ventana principal (menu, accesos, estado, barra de tareas). Esta ventana
 * ya es una ventana nativa del sistema operativo, con su propia barra de titulo,
 * asi que repetir el chrome adentro seria ruido.
 */

import { useEffect } from 'react';

import { PantallaAyuda } from './pantallas/Ayuda';
import { MaestroArticulos } from './pantallas/MaestroArticulos';
import { MaestroTerceros } from './pantallas/MaestroTerceros';
import { PantallaActualizacionPrecios, PantallaReposicion } from './pantallas/PreciosYReposicion';
import { Comprobante } from './pantallas/Comprobante';
import { EstadoVacio } from './componentes/comunes';
import { PantallaCaja, PantallaCuentasCorrientes } from './pantallas/Finanzas';
import {
  PantallaCajaGeneral,
  PantallaContabilidad,
  PantallaEstadisticas,
  PantallaFacturacion,
  PantallaUsuarios,
} from './pantallas/Gestion';
import { PantallaCheques } from './pantallas/Cheques';
import { PantallaTrazabilidad } from './pantallas/Trazabilidad';
import { PantallaPrecios } from './pantallas/Maestros';
import { PantallaCompras, PantallaPedidos, PantallaVentas } from './pantallas/Comercial';
import { PantallaInicio } from './pantallas/Inicio';
import { PantallaOrdenes, PantallaRecetas } from './pantallas/Produccion';

import { definicionDeModulo, esClaveModulo, type ClaveModulo } from './ventanas';

/** Pantallas que ocupan todo el ancho, sin panel lateral. */
function Simple({ children }: { readonly children: JSX.Element }): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>;
}

function contenidoDe(clave: ClaveModulo, params: URLSearchParams): JSX.Element {
  switch (clave) {
    case 'comprobante': {
      const ventaId = Number(params.get('ventaId') ?? '');
      return Number.isInteger(ventaId) && ventaId > 0 ? (
        <Simple><Comprobante ventaId={ventaId} /></Simple>
      ) : (
        <Simple>
          <EstadoVacio
            titulo="Comprobante sin venta"
            detalle="Esta ventana necesita saber de que venta se trata. Abrila desde el boton Imprimir de la grilla de ventas."
          />
        </Simple>
      );
    }
    case 'tablero':
      return <Simple><PantallaInicio /></Simple>;
    case 'stock-insumos':
      return (
        <MaestroArticulos grupo="insumos" titulo="Insumos" tipoNuevo="materia_prima" />
      );
    case 'stock-productos':
      return (
        <MaestroArticulos grupo="productos" titulo="Productos" tipoNuevo="producto_terminado" />
      );
    case 'articulos':
      return <MaestroArticulos grupo="todos" titulo="Articulos" tipoNuevo="materia_prima" />;
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
      return <MaestroTerceros que="clientes" />;
    case 'proveedores':
      return <MaestroTerceros que="proveedores" />;
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
    case 'trazabilidad':
      return <Simple><PantallaTrazabilidad /></Simple>;
    case 'cheques':
      return <Simple><PantallaCheques /></Simple>;
    case 'actualizacion-precios':
      return <PantallaActualizacionPrecios />;
    case 'reposicion':
      return <PantallaReposicion />;
    case 'ayuda':
      return <Simple><PantallaAyuda /></Simple>;
    case 'facturacion':
      return <Simple><PantallaFacturacion /></Simple>;
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
  // Los parametros viajan en el query del hash: #/embedded/<clave>?ventaId=42
  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');

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

      {contenidoDe(clave, params)}
    </div>
  );
}
