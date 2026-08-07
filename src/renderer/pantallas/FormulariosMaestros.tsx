/**
 * Formularios de alta y edicion de los maestros: clientes, proveedores y
 * articulos. Los tres siguen el mismo patron: reciben la entidad a editar (o
 * `null` para un alta), y avisan al padre cuando la operacion salio bien.
 */

import { useEffect, useState } from 'react';

import { ALICUOTAS_IVA_UI } from '../../compartido/contratos';
import type {
  ArticuloConStock,
  FamiliaVista,
  ClienteVista,
  EntradaArticulo,
  EntradaCliente,
  EntradaProveedor,
  EntradaUsuario,
  ListaPrecioVista,
  ProveedorVista,
  RolUsuario,
  TipoArticulo,
  TipoCliente,
  UsuarioVista,
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
  actualizarUsuario,
  crearCliente,
  crearFamilia,
  crearProveedor,
  crearUsuario,
  obtenerFamilias,
  obtenerListasPrecio,
  obtenerProveedores,
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
  const [stockIdeal, setStockIdeal] = useState<number | ''>(articulo?.stockIdeal ?? '');
  const [codigoBarras, setCodigoBarras] = useState(articulo?.codigoBarras ?? '');
  const [marca, setMarca] = useState(articulo?.marca ?? '');
  const [familiaId, setFamiliaId] = useState<number | ''>(articulo?.familiaId ?? '');
  const [proveedorHabitualId, setProveedorHabitualId] = useState<number | ''>(
    articulo?.proveedorHabitualId ?? '',
  );
  const [alicuotaIva, setAlicuotaIva] = useState<number>(articulo?.alicuotaIva ?? 21);
  const [porPeso, setPorPeso] = useState(articulo?.porPeso ?? false);
  const [notas, setNotas] = useState(articulo?.notas ?? '');
  const [unidadesPorCaja, setUnidadesPorCaja] = useState<number | ''>(articulo?.unidadesPorCaja ?? 12);
  const [costoActual, setCostoActual] = useState(articulo?.costoActual ?? 0);

  const [familias, setFamilias] = useState<FamiliaVista[]>([]);
  const [proveedores, setProveedores] = useState<ProveedorVista[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    void obtenerFamilias().then(setFamilias).catch(() => setFamilias([]));
    void obtenerProveedores()
      .then((lista) => setProveedores(lista.filter((p) => p.activo)))
      .catch(() => setProveedores([]));
  }, []);

  /** Crea la familia sin salir del formulario: cortar el flujo para volver a otra pantalla es lo que hace que nadie las use. */
  const agregarFamilia = (): void => {
    const nombreFamilia = window.prompt('Nombre de la nueva familia (rubro):');
    if (nombreFamilia === null || nombreFamilia.trim() === '') return;
    crearFamilia(nombreFamilia.trim())
      .then((f) => obtenerFamilias().then((lista) => {
        setFamilias(lista);
        setFamiliaId(f.id);
      }))
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  };

  const unidad = unidades.find((u) => u.id === unidadBaseId);

  const guardar = (): void => {
    if (unidadBaseId === '') {
      setError('Elegi la unidad de medida base.');
      return;
    }
    if (stockMin !== '' && stockIdeal !== '' && Number(stockIdeal) < Number(stockMin)) {
      setError('El stock ideal no puede ser menor que el minimo: es hasta donde se repone.');
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
      stockIdeal: stockIdeal === '' ? null : stockIdeal,
      codigoBarras: codigoBarras.trim() || null,
      marca: marca.trim() || null,
      familiaId: familiaId === '' ? null : familiaId,
      proveedorHabitualId: proveedorHabitualId === '' ? null : proveedorHabitualId,
      alicuotaIva,
      porPeso,
      notas: notas.trim() || null,
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
      ancho="max-w-2xl"
      error={error}
      guardando={guardando}
      puedeGuardar={nombre.trim().length >= 2 && codigo.trim().length >= 2}
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        articulo !== null ? (
          <span className="text-sm text-masa-800">
            Stock actual: <strong className="font-mono">{articulo.stock} {articulo.unidadAbreviatura}</strong>
          </span>
        ) : undefined
      }
    >
      {/* ---------------------------- Identificacion --------------------------- */}
      <Fila>
        <CampoTexto
          id="a-codigo"
          rotulo="Codigo interno"
          valor={codigo}
          alCambiar={setCodigo}
          requerido
          maximo={40}
          marcador="MP-HAR-001"
          ayuda="En mayusculas, no se repite."
        />
        <CampoTexto
          id="a-barras"
          rotulo="Codigo de barras"
          valor={codigoBarras}
          alCambiar={setCodigoBarras}
          maximo={40}
          marcador="7790000000000"
          ayuda="Para el lector. Opcional."
        />
      </Fila>

      <Fila>
        <CampoTexto id="a-nombre" rotulo="Nombre" valor={nombre} alCambiar={setNombre} requerido maximo={120} />
        <CampoTexto id="a-marca" rotulo="Marca" valor={marca} alCambiar={setMarca} maximo={80} />
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

      {/* ------------------------- Clasificacion y compra ---------------------- */}
      <Fila>
        <div>
          <CampoSelector
            id="a-familia"
            rotulo="Familia / rubro"
            valor={familiaId}
            vacio="Sin clasificar"
            opciones={familias.map((f) => ({ valor: f.id, etiqueta: f.nombre }))}
            alCambiar={(v) => setFamiliaId(v === '' ? '' : Number(v))}
          />
          <button
            type="button"
            onClick={agregarFamilia}
            className="mt-1 text-xs font-medium text-dulce-700 underline outline-none hover:text-dulce-800"
          >
            + Crear familia nueva
          </button>
        </div>
        <CampoSelector
          id="a-proveedor"
          rotulo="Proveedor habitual"
          valor={proveedorHabitualId}
          vacio="Sin proveedor fijo"
          opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.nombre }))}
          alCambiar={(v) => setProveedorHabitualId(v === '' ? '' : Number(v))}
          ayuda="A quien se le compra normalmente."
        />
      </Fila>

      {/* --------------------------- Stock y unidades -------------------------- */}
      <Fila>
        <CampoSelector
          id="a-unidad"
          rotulo="Unidad base"
          valor={unidadBaseId}
          opciones={unidades.map((u) => ({ valor: u.id, etiqueta: u.nombre }))}
          alCambiar={(v) => setUnidadBaseId(v === '' ? '' : Number(v))}
          ayuda="En esta unidad vive el stock."
        />
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
      </Fila>

      <Fila>
        <CampoNumero
          id="a-stockmin"
          rotulo={`Stock minimo${unidad !== undefined ? '' : ''}`}
          valor={stockMin}
          alCambiar={setStockMin}
          ayuda="Debajo de esto se marca en rojo."
        />
        <CampoNumero
          id="a-stockideal"
          rotulo="Stock ideal"
          valor={stockIdeal}
          alCambiar={setStockIdeal}
          ayuda="Hasta aca se repone. Define cuanto comprar."
        />
      </Fila>

      {/* ------------------------------ Precios e IVA -------------------------- */}
      <Fila>
        <CampoMoneda
          id="a-costo"
          rotulo="Costo por unidad"
          centavos={costoActual}
          alCambiar={setCostoActual}
          ayuda="Se actualiza solo con cada compra."
        />
        <CampoSelector
          id="a-iva"
          rotulo="Alicuota de IVA"
          valor={alicuotaIva}
          opciones={ALICUOTAS_IVA_UI.map((a) => ({ valor: a.valor, etiqueta: a.etiqueta }))}
          alCambiar={(v) => setAlicuotaIva(v === '' ? 21 : Number(v))}
          ayuda="Con esto se desglosa la factura."
        />
      </Fila>

      <label className="flex items-center gap-2 text-sm text-masa-900">
        <input
          type="checkbox"
          checked={porPeso}
          onChange={(e) => setPorPeso(e.target.checked)}
          className="h-4 w-4"
        />
        Se vende por peso (la balanza define la cantidad)
      </label>

      <CampoTexto id="a-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/* --------------------------------- Usuarios -------------------------------- */

export function FormularioUsuario({
  usuario,
  alCerrar,
  alGuardar,
}: {
  readonly usuario: UsuarioVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [username, setUsername] = useState(usuario?.username ?? '');
  const [password, setPassword] = useState('');
  const [rol, setRol] = useState<RolUsuario>(usuario?.rol ?? 'empleado');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const esAlta = usuario === null;

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    const entrada: EntradaUsuario = {
      username,
      rol,
      // Al editar, vacio significa "dejala como esta".
      ...(password !== '' ? { password } : {}),
    };
    const operacion = esAlta ? crearUsuario(entrada) : actualizarUsuario(usuario.id, entrada);
    operacion
      .then((g) => alGuardar(`Usuario ${g.username} ${esAlta ? 'creado' : 'actualizado'}.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={esAlta ? 'Nuevo usuario' : `Editar ${usuario.username}`}
      descripcion="El administrador puede todo; el empleado opera pero no administra usuarios."
      error={error}
      guardando={guardando}
      puedeGuardar={username.trim().length >= 3 && (!esAlta || password.length >= 4)}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoTexto
        id="u-user"
        rotulo="Nombre de usuario"
        valor={username}
        alCambiar={setUsername}
        requerido
        maximo={40}
        ayuda="Se guarda en minusculas y no se puede repetir."
      />
      <div>
        <label htmlFor="u-pass" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
          Contraseña
          {esAlta && <span className="ml-1 text-peligro-600">*</span>}
        </label>
        <input
          id="u-pass"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={80}
          autoComplete="new-password"
          className="h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400"
        />
        <p className="mt-1 text-xs text-masa-700">
          {esAlta
            ? 'Minimo 4 caracteres. Se guarda cifrada: nadie puede leerla, ni desde la base.'
            : 'Dejala vacia para no cambiarla.'}
        </p>
      </div>
      <CampoOpciones
        rotulo="Rol"
        valor={rol}
        opciones={[
          { valor: 'empleado' as RolUsuario, etiqueta: 'Empleado' },
          { valor: 'admin' as RolUsuario, etiqueta: 'Administrador' },
        ]}
        alCambiar={setRol}
      />
    </ModalFormulario>
  );
}
