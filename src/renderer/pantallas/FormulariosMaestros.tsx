/**
 * Formularios de alta y edicion de los maestros: clientes, proveedores y
 * articulos. Los tres siguen el mismo patron: reciben la entidad a editar (o
 * `null` para un alta), y avisan al padre cuando la operacion salio bien.
 */

import { useEffect, useState } from 'react';

import type {
  ArticuloConStock,
  ClienteVista,
  EntradaArticulo,
  EntradaCliente,
  EntradaProveedor,
  ListaPrecioVista,
  ProveedorVista,
  TipoArticulo,
  TipoCliente,
} from '../../compartido/contratos';
import {
  CampoMoneda,
  CampoNumero,
  CampoOpciones,
  CampoSelector,
  CampoTexto,
  Fila,
  ModalFormulario,
} from '../componentes/Formulario';
import {
  actualizarArticulo,
  actualizarCliente,
  actualizarProveedor,
  crearArticulo,
  crearCliente,
  crearProveedor,
  obtenerListasPrecio,
} from '../servicios/cliente';

const TIPOS_CLIENTE_UI: readonly { valor: TipoCliente; etiqueta: string }[] = [
  { valor: 'mostrador', etiqueta: 'Mostrador' },
  { valor: 'mayorista', etiqueta: 'Mayorista' },
  { valor: 'distribuidor', etiqueta: 'Distribuidor' },
];

const TIPOS_ARTICULO_UI: readonly { valor: TipoArticulo; etiqueta: string }[] = [
  { valor: 'producto_terminado', etiqueta: 'Producto terminado' },
  { valor: 'materia_prima', etiqueta: 'Materia prima' },
  { valor: 'pre_elaborado', etiqueta: 'Pre-elaborado' },
];

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

/* -------------------------------- Clientes --------------------------------- */

export function FormularioCliente({
  cliente,
  alCerrar,
  alGuardar,
}: {
  readonly cliente: ClienteVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [nombre, setNombre] = useState(cliente?.nombre ?? '');
  const [cuit, setCuit] = useState(cliente?.cuit ?? '');
  const [telefono, setTelefono] = useState(cliente?.telefono ?? '');
  const [email, setEmail] = useState(cliente?.email ?? '');
  const [direccion, setDireccion] = useState(cliente?.direccion ?? '');
  const [tipo, setTipo] = useState<TipoCliente>(cliente?.tipo ?? 'mostrador');
  const [listaPrecioId, setListaPrecioId] = useState<number | ''>(cliente?.listaPrecioId ?? '');
  const [listas, setListas] = useState<ListaPrecioVista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerListasPrecio()
      .then(setListas)
      .catch(() => setListas([]));
  }, []);

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    const entrada: EntradaCliente = {
      nombre,
      cuit: cuit.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      direccion: direccion.trim() || null,
      tipo,
      listaPrecioId: listaPrecioId === '' ? null : listaPrecioId,
    };
    const operacion =
      cliente === null ? crearCliente(entrada) : actualizarCliente(cliente.id, entrada);
    operacion
      .then((guardado) =>
        alGuardar(`${guardado.nombre} ${cliente === null ? 'dado de alta' : 'actualizado'}.`),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={cliente === null ? 'Nuevo cliente' : `Editar ${cliente.nombre}`}
      error={error}
      guardando={guardando}
      puedeGuardar={nombre.trim().length >= 2}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoTexto id="c-nombre" rotulo="Nombre" valor={nombre} alCambiar={setNombre} requerido maximo={120} />
      <Fila>
        <CampoTexto
          id="c-cuit"
          rotulo="CUIT"
          valor={cuit}
          alCambiar={setCuit}
          marcador="20-30111222-3"
          maximo={20}
          ayuda="Necesario para emitirle Factura A."
        />
        <CampoTexto id="c-tel" rotulo="Telefono" valor={telefono} alCambiar={setTelefono} maximo={40} />
      </Fila>
      <Fila>
        <CampoTexto id="c-email" rotulo="Email" valor={email} alCambiar={setEmail} maximo={120} />
        <CampoTexto id="c-dir" rotulo="Direccion" valor={direccion} alCambiar={setDireccion} maximo={200} />
      </Fila>
      <CampoOpciones rotulo="Tipo" valor={tipo} opciones={TIPOS_CLIENTE_UI} alCambiar={setTipo} />
      <CampoSelector
        id="c-lista"
        rotulo="Lista de precios"
        valor={listaPrecioId}
        vacio="General (por defecto)"
        opciones={listas.map((l) => ({ valor: l.id, etiqueta: l.nombre }))}
        alCambiar={(v) => setListaPrecioId(v === '' ? '' : Number(v))}
        ayuda="Define el precio que se sugiere al venderle."
      />
    </ModalFormulario>
  );
}

/* ------------------------------- Proveedores ------------------------------- */

export function FormularioProveedor({
  proveedor,
  alCerrar,
  alGuardar,
}: {
  readonly proveedor: ProveedorVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [nombre, setNombre] = useState(proveedor?.nombre ?? '');
  const [cuit, setCuit] = useState(proveedor?.cuit ?? '');
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? '');
  const [email, setEmail] = useState(proveedor?.email ?? '');
  const [direccion, setDireccion] = useState(proveedor?.direccion ?? '');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    const entrada: EntradaProveedor = {
      nombre,
      cuit: cuit.trim() || null,
      telefono: telefono.trim() || null,
      email: email.trim() || null,
      direccion: direccion.trim() || null,
    };
    const operacion =
      proveedor === null ? crearProveedor(entrada) : actualizarProveedor(proveedor.id, entrada);
    operacion
      .then((guardado) =>
        alGuardar(`${guardado.nombre} ${proveedor === null ? 'dado de alta' : 'actualizado'}.`),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={proveedor === null ? 'Nuevo proveedor' : `Editar ${proveedor.nombre}`}
      error={error}
      guardando={guardando}
      puedeGuardar={nombre.trim().length >= 2}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoTexto id="p-nombre" rotulo="Nombre" valor={nombre} alCambiar={setNombre} requerido maximo={120} />
      <Fila>
        <CampoTexto id="p-cuit" rotulo="CUIT" valor={cuit} alCambiar={setCuit} marcador="30-71555444-2" maximo={20} />
        <CampoTexto id="p-tel" rotulo="Telefono" valor={telefono} alCambiar={setTelefono} maximo={40} />
      </Fila>
      <Fila>
        <CampoTexto id="p-email" rotulo="Email" valor={email} alCambiar={setEmail} maximo={120} />
        <CampoTexto id="p-dir" rotulo="Direccion" valor={direccion} alCambiar={setDireccion} maximo={200} />
      </Fila>
    </ModalFormulario>
  );
}

/* -------------------------------- Articulos -------------------------------- */

export function FormularioArticulo({
  articulo,
  tipoSugerido,
  unidades,
  alCerrar,
  alGuardar,
}: {
  readonly articulo: ArticuloConStock | null;
  /** Tipo con el que arranca un alta segun la pantalla desde la que se abre. */
  readonly tipoSugerido?: TipoArticulo;
  readonly unidades: readonly { readonly id: number; readonly nombre: string }[];
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [codigo, setCodigo] = useState(articulo?.codigo ?? '');
  const [nombre, setNombre] = useState(articulo?.nombre ?? '');
  const [tipo, setTipo] = useState<TipoArticulo>(articulo?.tipo ?? tipoSugerido ?? 'producto_terminado');
  const [unidadBaseId, setUnidadBaseId] = useState<number | ''>(
    articulo?.unidadBaseId ?? unidades[0]?.id ?? '',
  );
  const [stockMin, setStockMin] = useState<number | ''>(articulo?.stockMin ?? '');
  const [unidadesPorCaja, setUnidadesPorCaja] = useState<number | ''>(articulo?.unidadesPorCaja ?? 12);
  const [costoActual, setCostoActual] = useState(articulo?.costoActual ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (): void => {
    if (unidadBaseId === '') {
      setError('Elegi la unidad de medida base.');
      return;
    }
    setGuardando(true);
    setError(null);
    const entrada: EntradaArticulo = {
      codigo,
      nombre,
      tipo,
      unidadBaseId,
      stockMin: stockMin === '' ? null : stockMin,
      unidadesPorCaja: tipo === 'producto_terminado' && unidadesPorCaja !== '' ? unidadesPorCaja : null,
      costoActual: costoActual > 0 ? costoActual : null,
    };
    const operacion =
      articulo === null ? crearArticulo(entrada) : actualizarArticulo(articulo.id, entrada);
    operacion
      .then(() => alGuardar(`${nombre} ${articulo === null ? 'dado de alta' : 'actualizado'}.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={articulo === null ? 'Nuevo articulo' : `Editar ${articulo.nombre}`}
      error={error}
      guardando={guardando}
      puedeGuardar={nombre.trim().length >= 2 && codigo.trim().length >= 2}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <Fila>
        <CampoTexto
          id="a-codigo"
          rotulo="Codigo"
          valor={codigo}
          alCambiar={setCodigo}
          requerido
          maximo={40}
          marcador="PT-ALF-CHO"
          ayuda="Se guarda en mayusculas y no se puede repetir."
        />
        <CampoTexto id="a-nombre" rotulo="Nombre" valor={nombre} alCambiar={setNombre} requerido maximo={120} />
      </Fila>

      <CampoOpciones
        rotulo="Tipo"
        valor={tipo}
        opciones={TIPOS_ARTICULO_UI}
        alCambiar={setTipo}
        ayuda={
          articulo === null
            ? 'Los productos terminados se venden; los otros dos se consumen en produccion.'
            : 'Si el articulo ya tiene movimientos, el tipo no se puede cambiar.'
        }
      />

      <Fila>
        <CampoSelector
          id="a-unidad"
          rotulo="Unidad base"
          valor={unidadBaseId}
          opciones={unidades.map((u) => ({ valor: u.id, etiqueta: u.nombre }))}
          alCambiar={(v) => setUnidadBaseId(v === '' ? '' : Number(v))}
          ayuda="En esta unidad vive el stock."
        />
        <CampoNumero
          id="a-stockmin"
          rotulo="Stock minimo"
          valor={stockMin}
          alCambiar={setStockMin}
          ayuda="Debajo de este valor se marca en rojo."
        />
      </Fila>

      <Fila>
        {tipo === 'producto_terminado' && (
          <CampoNumero
            id="a-upc"
            rotulo="Unidades por caja"
            valor={unidadesPorCaja}
            alCambiar={setUnidadesPorCaja}
            minimo={1}
            paso="1"
            ayuda="Los clientes piden cajas cerradas."
          />
        )}
        <CampoMoneda
          id="a-costo"
          rotulo="Costo por unidad"
          centavos={costoActual}
          alCambiar={setCostoActual}
          ayuda="Se actualiza solo con cada compra."
        />
      </Fila>
    </ModalFormulario>
  );
}
