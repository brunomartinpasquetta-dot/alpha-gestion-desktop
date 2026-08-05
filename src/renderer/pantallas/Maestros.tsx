/**
 * Pantallas de maestros: clientes, proveedores y listas de precio.
 */

import {
  ETIQUETA_TIPO_CLIENTE,
  type ClienteVista,
  type ListaPrecioVista,
  type ProveedorVista,
} from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerClientes, obtenerListasPrecio, obtenerProveedores } from '../servicios/cliente';
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

  return (
    <Vista
      estado={estado}
      que="los clientes"
      tituloVacio="Sin clientes"
      detalleVacio="No hay clientes cargados. Corre el seed para cargar el catalogo base."
      comandoVacio="npm run db:seed"
    >
      {(filas) => <Tabla columnas={COLUMNAS_CLIENTES} filas={filas} claveDeFila={(c) => c.id} />}
    </Vista>
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

  return (
    <Vista
      estado={estado}
      que="los proveedores"
      tituloVacio="Sin proveedores"
      detalleVacio="No hay proveedores cargados. Corre el seed para cargar el catalogo base."
      comandoVacio="npm run db:seed"
    >
      {(filas) => <Tabla columnas={COLUMNAS_PROVEEDORES} filas={filas} claveDeFila={(p) => p.id} />}
    </Vista>
  );
}

/* ----------------------------- Listas de precio ---------------------------- */

export function PantallaPrecios(): JSX.Element {
  const estado = usarRecurso(() => obtenerListasPrecio(), []);

  return (
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
  );
}
