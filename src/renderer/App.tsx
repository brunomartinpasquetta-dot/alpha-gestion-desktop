/**
 * Shell del ERP: navegacion lateral, encabezado del modulo activo y el panel de
 * detalle del ledger de un articulo.
 *
 * El ruteo es propio y minimo, sin librerias: el modulo activo vive en el estado
 * y se refleja en `location.hash`, asi el refresh y el HMR no pierden la pantalla.
 * Alcanza de sobra para una app de escritorio con un solo nivel de navegacion.
 */

import { useCallback, useEffect, useState } from 'react';

import { BarraLateral } from './componentes/BarraLateral';
import { PanelLedger } from './componentes/PanelLedger';
import { usarRecurso } from './ganchos/usarRecurso';
import { definicionDeModulo, hashDeModulo, moduloDesdeHash, type ClaveModulo } from './navegacion';
import { PantallaCaja, PantallaCuentasCorrientes } from './pantallas/Finanzas';
import { PantallaClientes, PantallaPrecios, PantallaProveedores } from './pantallas/Maestros';
import { PantallaCompras, PantallaPedidos, PantallaVentas } from './pantallas/Comercial';
import { PantallaInicio } from './pantallas/Inicio';
import { PantallaOrdenes, PantallaRecetas } from './pantallas/Produccion';
import { PantallaArticulos, PantallaStockInsumos, PantallaStockProductos } from './pantallas/Stock';
import { obtenerSalud } from './servicios/cliente';

interface ArticuloElegido {
  readonly id: number;
  readonly nombre: string;
  readonly codigo: string;
}

export default function App(): JSX.Element {
  const [modulo, setModulo] = useState<ClaveModulo>(() => moduloDesdeHash(window.location.hash));
  const [articulo, setArticulo] = useState<ArticuloElegido | null>(null);

  // El estado de salud vive en el shell: lo muestra la barra lateral y no tiene
  // sentido volver a pedirlo en cada modulo.
  const salud = usarRecurso(() => obtenerSalud(), []);

  // Sincronizacion con el hash: los botones atras/adelante del navegador y la
  // edicion manual de la URL tienen que funcionar.
  useEffect(() => {
    const alCambiarHash = (): void => setModulo(moduloDesdeHash(window.location.hash));
    window.addEventListener('hashchange', alCambiarHash);
    if (window.location.hash === '') {
      window.location.hash = hashDeModulo(moduloDesdeHash(''));
    }
    return () => window.removeEventListener('hashchange', alCambiarHash);
  }, []);

  const navegar = useCallback((clave: ClaveModulo): void => {
    setModulo(clave);
    // Al cambiar de modulo cerramos el detalle: pertenece a la pantalla anterior.
    setArticulo(null);
    if (window.location.hash !== hashDeModulo(clave)) {
      window.location.hash = hashDeModulo(clave);
    }
  }, []);

  const alSeleccionarArticulo = useCallback((elegido: ArticuloElegido): void => {
    // Volver a clickear la misma fila cierra el panel.
    setArticulo((actual) => (actual?.id === elegido.id ? null : elegido));
  }, []);

  const definicion = definicionDeModulo(modulo);
  const propsSeleccion = {
    articuloSeleccionadoId: articulo?.id ?? null,
    alSeleccionarArticulo,
  };

  function contenido(): JSX.Element {
    switch (modulo) {
      case 'inicio':
        return <PantallaInicio />;
      case 'stock-insumos':
        return <PantallaStockInsumos {...propsSeleccion} />;
      case 'stock-productos':
        return <PantallaStockProductos {...propsSeleccion} />;
      case 'articulos':
        return <PantallaArticulos {...propsSeleccion} />;
      case 'recetas':
        return <PantallaRecetas />;
      case 'ordenes':
        return <PantallaOrdenes />;
      case 'pedidos':
        return <PantallaPedidos />;
      case 'ventas':
        return <PantallaVentas />;
      case 'compras':
        return <PantallaCompras />;
      case 'caja':
        return <PantallaCaja />;
      case 'cuentas-corrientes':
        return <PantallaCuentasCorrientes />;
      case 'clientes':
        return <PantallaClientes />;
      case 'proveedores':
        return <PantallaProveedores />;
      case 'listas-precio':
        return <PantallaPrecios />;
      default:
        return <PantallaInicio />;
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-masa-100 text-masa-800">
      <BarraLateral
        moduloActivo={modulo}
        alNavegar={navegar}
        salud={salud.datos}
        errorSalud={salud.error}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-barra shrink-0 items-center justify-between gap-4 border-b border-masa-200 bg-white px-6 py-2">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-masa-800">{definicion.titulo}</h1>
            <p className="truncate text-xs text-masa-600">{definicion.descripcion}</p>
          </div>
          {salud.datos !== null && (
            <p
              className="hidden shrink-0 font-mono text-micro text-masa-500 lg:block"
              title={salud.datos.db.rutaDb}
            >
              {salud.datos.db.rutaDb}
            </p>
          )}
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto p-6">{contenido()}</div>

          {articulo !== null && (
            <PanelLedger
              articuloId={articulo.id}
              titulo={articulo.nombre}
              subtitulo={`Ledger de stock · ${articulo.codigo}`}
              alCerrar={() => setArticulo(null)}
            />
          )}
        </div>
      </main>
    </div>
  );
}
