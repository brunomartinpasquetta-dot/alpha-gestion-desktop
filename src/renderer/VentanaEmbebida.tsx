/**
 * Contenido de una ventana de modulo.
 *
 * Es lo que monta la ruta `#/embedded/<clave>`: la pantalla sola, SIN el chrome
 * de la ventana principal (menu, accesos, estado, barra de tareas). Esta ventana
 * ya es una ventana nativa del sistema operativo, con su propia barra de titulo,
 * asi que repetir el chrome adentro seria ruido.
 */

import { useEffect, type CSSProperties } from 'react';

import { PantallaAyuda } from './pantallas/Ayuda';
import { PantallaStockInsumos, PantallaStockProductos } from './pantallas/MaestroArticulos';
import { MaestroTerceros } from './pantallas/MaestroTerceros';
import { PantallaVendedores } from './pantallas/Vendedores';
import { PantallaMediosPago } from './pantallas/MediosPago';
import { SitioWeb } from './pantallas/SitioWeb';
import { TicketPedido } from './pantallas/TicketPedido';
import { PantallaAjustesStock, PantallaMovimientosStock } from './pantallas/StockAjustes';
import {
  PantallaConfiguracionImpresion,
  PantallaConfiguracionLan,
  PantallaRespaldo,
} from './pantallas/Sistema';
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
import { PantallaPromociones } from './pantallas/Promociones';
import { PantallaInicio } from './pantallas/Inicio';
import { PantallaOrdenes, PantallaRecetas } from './pantallas/Produccion';

import { definicionDeModulo, esClaveModulo, type ClaveModulo } from './ventanas';

/** Pantallas que ocupan todo el ancho, sin panel lateral. */
function Simple({ children }: { readonly children: JSX.Element }): JSX.Element {
  return <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>;
}

function contenidoDe(clave: ClaveModulo, params: URLSearchParams): JSX.Element {
  switch (clave) {
    case 'ticket-pedido': {
      const pedidoId = Number(params.get('pedidoId') ?? '');
      return Number.isInteger(pedidoId) && pedidoId > 0 ? (
        <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
          <TicketPedido pedidoId={pedidoId} />
        </div>
      ) : (
        <Simple>
          <EstadoVacio
            titulo="Ticket sin pedido"
            detalle="Esta ventana necesita saber de que pedido se trata. Abrila con el boton Ticket del pedido."
          />
        </Simple>
      );
    }
    case 'sitio-web':
      return <SitioWeb />;
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
      return <PantallaStockInsumos />;
    case 'stock-productos':
    case 'articulos': // clave vieja: fusionada en Stock Productos
      return <PantallaStockProductos />;
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
    case 'vendedores':
      return <Simple><PantallaVendedores /></Simple>;
    case 'proveedores':
      return <MaestroTerceros que="proveedores" />;
    case 'listas-precio':
      return <Simple><PantallaPrecios /></Simple>;
    case 'promociones':
      return <Simple><PantallaPromociones /></Simple>;
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
    case 'ajustes-insumos':
      return <Simple><PantallaAjustesStock grupo="insumos" /></Simple>;
    case 'ajustes-productos':
      return <Simple><PantallaAjustesStock grupo="productos" /></Simple>;
    case 'movimientos-stock':
      return <Simple><PantallaMovimientosStock /></Simple>;
    case 'medios-pago':
      return <Simple><PantallaMediosPago /></Simple>;
    case 'configuracion-lan':
      return <Simple><PantallaConfiguracionLan /></Simple>;
    case 'respaldo':
      return <Simple><PantallaRespaldo /></Simple>;
    case 'configuracion-impresion':
      return <Simple><PantallaConfiguracionImpresion /></Simple>;
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

  const esMac = (window.alfajores?.plataforma ?? '') === 'darwin';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-masa-100 text-masa-900">
      {/* Topbar de la ventana del modulo: la misma franja marron de la
          principal, con el nombre del modulo. Los costados quedan libres para
          el semaforo (Mac) y los botones del sistema (Windows). */}
      <div
        className="relative flex h-8 shrink-0 items-center bg-dulce-600 text-white"
        style={
          {
            WebkitAppRegion: 'drag',
            paddingLeft: esMac ? 78 : 12,
            paddingRight: esMac ? 12 : 140,
          } as CSSProperties
        }
      >
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] font-semibold tracking-tight">
          {definicion.titulo}
        </span>
      </div>

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
