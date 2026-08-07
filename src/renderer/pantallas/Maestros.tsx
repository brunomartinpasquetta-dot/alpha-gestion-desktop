/**
 * Listas de precio. Clientes y proveedores viven en MaestroTerceros, con el
 * patron de panel de detalle; aca queda solo lo que no lo comparte.
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { ListaPrecioVista } from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Aviso, BotonFila, BotonPrimario } from '../componentes/Formulario';
import { Tabla } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import { actualizarListaPrecio, borrarPrecio, obtenerListasPrecio } from '../servicios/cliente';
import { FormularioNuevaLista, FormularioPrecio } from './FormulariosProduccion';
import { formatearFecha, formatearMoneda } from '../utiles/formato';

/* ----------------------------- Listas de precio ---------------------------- */

export function PantallaPrecios(): JSX.Element {
  const estado = usarRecurso(() => obtenerListasPrecio(), []);
  const [modal, setModal] = useState<'lista' | 'precio' | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const cerrarConExito = (mensaje: string): void => {
    setModal(null);
    estado.recargar();
    setAviso({ tono: 'ok', texto: mensaje });
  };

  const fallar = (causa: unknown): void =>
    setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) });

  /** Borrar un precio es corregir un error de carga, no anular un hecho. */
  const quitarPrecio = (precioId: number, nombre: string): void => {
    if (!window.confirm(`¿Borrar el precio de ${nombre}? Vuelve a regir el anterior, si habia.`)) return;
    setAviso(null);
    borrarPrecio(precioId)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `Precio de ${nombre} borrado.` });
      })
      .catch(fallar);
  };

  const renombrar = (lista: ListaPrecioVista): void => {
    const nombre = window.prompt('Nuevo nombre de la lista:', lista.nombre);
    if (nombre === null || nombre.trim() === lista.nombre) return;
    setAviso(null);
    actualizarListaPrecio(lista.id, nombre.trim(), lista.activa)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `Lista renombrada a "${nombre.trim()}".` });
      })
      .catch(fallar);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Un precio nuevo no pisa al anterior: rige desde hoy y el historial queda.
        </p>
        <div className="flex shrink-0 gap-2">
          <BotonPrimario onClick={() => setModal('precio')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Fijar precio
          </BotonPrimario>
          <button
            type="button"
            onClick={() => setModal('lista')}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Nueva lista
          </button>
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
      estado={estado}
      que="las listas de precio"
      tituloVacio="Sin listas de precio"
      detalleVacio="No hay listas cargadas. Corre el seed para crear la lista General."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(listas) => (
        <div className="space-y-4">
          {listas.map((lista: ListaPrecioVista) => (
            <section key={lista.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
                  {lista.nombre}
                </h2>
                <BotonFila onClick={() => renombrar(lista)}>Renombrar</BotonFila>
                {lista.activa ? (
                  <Pastilla texto="Activa" tono="positivo" />
                ) : (
                  <Pastilla texto="Inactiva" />
                )}
                <span className="text-xs text-masa-700">{lista.precios.length} articulo(s)</span>
              </div>

              {lista.precios.length === 0 ? (
                <p className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-6 text-center text-sm text-masa-700">
                  Esta lista todavia no tiene precios cargados.
                </p>
              ) : (
                <Tabla
                  columnas={[
                    {
                      clave: 'codigo',
                      titulo: 'Codigo',
                      celda: (p) => <span className="font-mono">{p.codigo}</span>,
                    },
                    { clave: 'nombre', titulo: 'Articulo', celda: (p) => p.nombre },
                    {
                      clave: 'precio',
                      titulo: 'Precio',
                      celda: (p) => formatearMoneda(p.precio),
                      numerica: true,
                    },
                    {
                      clave: 'vigente',
                      titulo: 'Vigente desde',
                      celda: (p) => formatearFecha(p.vigenteDesde),
                      numerica: true,
                    },
                    {
                      clave: 'acciones',
                      titulo: 'Acciones',
                      celda: (p) => (
                        <BotonFila onClick={() => quitarPrecio(p.id, p.nombre)} tono="peligro">
                          Borrar
                        </BotonFila>
                      ),
                    },
                  ]}
                  filas={lista.precios}
                  claveDeFila={(p) => p.id}
                />
              )}
            </section>
          ))}
        </div>
      )}
      </Vista>

      {modal === 'lista' && (
        <FormularioNuevaLista alCerrar={() => setModal(null)} alGuardar={cerrarConExito} />
      )}
      {modal === 'precio' && (
        <FormularioPrecio alCerrar={() => setModal(null)} alGuardar={cerrarConExito} />
      )}
    </div>
  );
}
