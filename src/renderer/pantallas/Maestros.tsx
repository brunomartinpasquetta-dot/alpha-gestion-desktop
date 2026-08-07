/**
 * Pantallas de maestros: clientes, proveedores y listas de precio.
 *
 * Clientes y proveedores tienen ABM completo. "Eliminar" es dar de baja: el
 * ledger los referencia y borrarlos dejaria ventas y compras sin titular.
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';

import {
  ETIQUETA_TIPO_CLIENTE,
  type ClienteVista,
  type ListaPrecioVista,
  type ProveedorVista,
} from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Aviso, BotonFila, BotonPrimario } from '../componentes/Formulario';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  actualizarListaPrecio,
  borrarPrecio,
  cambiarActivoCliente,
  cambiarActivoProveedor,
  obtenerClientes,
  obtenerListasPrecio,
  obtenerProveedores,
} from '../servicios/cliente';
import { FormularioCliente, FormularioProveedor } from './FormulariosMaestros';
import { FormularioNuevaLista, FormularioPrecio } from './FormulariosProduccion';
import { formatearFecha, formatearMoneda, formatearMonedaConSigno, formatearTexto } from '../utiles/formato';

/* -------------------------------- Clientes --------------------------------- */

const COLUMNAS_CLIENTES: readonly Columna<ClienteVista>[] = [
  { clave: 'nombre', titulo: 'Cliente', celda: (c) => c.nombre },
  {
    clave: 'tipo',
    titulo: 'Tipo',
    celda: (c) => (
      <Pastilla
        texto={ETIQUETA_TIPO_CLIENTE[c.tipo]}
        tono={c.tipo === 'mostrador' ? 'neutro' : 'info'}
      />
    ),
  },
  { clave: 'cuit', titulo: 'CUIT', celda: (c) => formatearTexto(c.cuit), numerica: true },
  { clave: 'telefono', titulo: 'Telefono', celda: (c) => formatearTexto(c.telefono), numerica: true },
  { clave: 'lista', titulo: 'Lista de precios', celda: (c) => formatearTexto(c.listaPrecioNombre) },
  {
    clave: 'saldo',
    titulo: 'Saldo CC',
    numerica: true,
    celda: (c) => (
      <span className={c.saldoCc > 0 ? 'text-alerta-700' : 'text-masa-800'}>
        {formatearMonedaConSigno(c.saldoCc)}
      </span>
    ),
  },
  {
    clave: 'activo',
    titulo: 'Estado',
    celda: (c) => (c.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />),
  },
];

export function PantallaClientes(): JSX.Element {
  const estado = usarRecurso(() => obtenerClientes(), []);
  // `undefined` = modal cerrado; `null` = alta; una entidad = edicion.
  const [enEdicion, setEnEdicion] = useState<ClienteVista | null | undefined>(undefined);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const cambiarActivo = (cliente: ClienteVista): void => {
    const alta = !cliente.activo;
    if (!alta && !window.confirm(`¿Dar de baja a ${cliente.nombre}? Deja de aparecer en los formularios.`)) return;
    setAviso(null);
    cambiarActivoCliente(cliente.id, alta)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `${cliente.nombre} ${alta ? 'reactivado' : 'dado de baja'}.` });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  const columnas: readonly Columna<ClienteVista>[] = [
    ...COLUMNAS_CLIENTES,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (c) => (
        <div className="flex gap-1">
          <BotonFila onClick={() => setEnEdicion(c)}>Editar</BotonFila>
          <BotonFila onClick={() => cambiarActivo(c)} tono={c.activo ? 'peligro' : 'neutro'}>
            {c.activo ? 'Dar de baja' : 'Reactivar'}
          </BotonFila>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          El CUIT es lo que habilita a emitirle Factura A; la lista define el precio sugerido.
        </p>
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo cliente
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="los clientes"
        tituloVacio="Sin clientes"
        detalleVacio="Cargá el primero con el boton Nuevo cliente."
        comandoVacio="npm run db:seed"
      >
        {(filas) => <Tabla columnas={columnas} filas={filas} claveDeFila={(c) => c.id} />}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioCliente
          cliente={enEdicion}
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

/* ------------------------------- Proveedores ------------------------------- */

const COLUMNAS_PROVEEDORES: readonly Columna<ProveedorVista>[] = [
  { clave: 'nombre', titulo: 'Proveedor', celda: (p) => p.nombre },
  { clave: 'cuit', titulo: 'CUIT', celda: (p) => formatearTexto(p.cuit), numerica: true },
  { clave: 'telefono', titulo: 'Telefono', celda: (p) => formatearTexto(p.telefono), numerica: true },
  { clave: 'email', titulo: 'Email', celda: (p) => formatearTexto(p.email) },
  { clave: 'direccion', titulo: 'Direccion', celda: (p) => formatearTexto(p.direccion) },
  {
    clave: 'saldo',
    titulo: 'Saldo CC',
    numerica: true,
    celda: (p) => (
      <span className={p.saldoCc < 0 ? 'text-peligro-600' : 'text-masa-800'}>
        {formatearMonedaConSigno(p.saldoCc)}
      </span>
    ),
  },
  {
    clave: 'activo',
    titulo: 'Estado',
    celda: (p) => (p.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />),
  },
];

export function PantallaProveedores(): JSX.Element {
  const estado = usarRecurso(() => obtenerProveedores(), []);
  const [enEdicion, setEnEdicion] = useState<ProveedorVista | null | undefined>(undefined);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null);

  const cambiarActivo = (proveedor: ProveedorVista): void => {
    const alta = !proveedor.activo;
    if (!alta && !window.confirm(`¿Dar de baja a ${proveedor.nombre}?`)) return;
    setAviso(null);
    cambiarActivoProveedor(proveedor.id, alta)
      .then(() => {
        estado.recargar();
        setAviso({ tono: 'ok', texto: `${proveedor.nombre} ${alta ? 'reactivado' : 'dado de baja'}.` });
      })
      .catch((causa: unknown) =>
        setAviso({ tono: 'mal', texto: causa instanceof Error ? causa.message : String(causa) }),
      );
  };

  const columnas: readonly Columna<ProveedorVista>[] = [
    ...COLUMNAS_PROVEEDORES,
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (p) => (
        <div className="flex gap-1">
          <BotonFila onClick={() => setEnEdicion(p)}>Editar</BotonFila>
          <BotonFila onClick={() => cambiarActivo(p)} tono={p.activo ? 'peligro' : 'neutro'}>
            {p.activo ? 'Dar de baja' : 'Reactivar'}
          </BotonFila>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Saldo en rojo significa que le debemos al proveedor.
        </p>
        <BotonPrimario onClick={() => setEnEdicion(null)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo proveedor
        </BotonPrimario>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="los proveedores"
        tituloVacio="Sin proveedores"
        detalleVacio="Cargá el primero con el boton Nuevo proveedor."
        comandoVacio="npm run db:seed"
      >
        {(filas) => <Tabla columnas={columnas} filas={filas} claveDeFila={(p) => p.id} />}
      </Vista>

      {enEdicion !== undefined && (
        <FormularioProveedor
          proveedor={enEdicion}
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
