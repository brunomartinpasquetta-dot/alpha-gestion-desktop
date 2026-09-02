/**
 * Formularios de las operaciones que mueven plata y stock: compra, caja,
 * cobros y pagos, y planificacion de produccion.
 *
 * Todos comparten el mismo compromiso: el formulario no calcula reglas de
 * negocio, solo arma bien la entrada. Quien decide si la operacion es valida
 * —si hay caja abierta, si alcanza el saldo, si el proveedor esta activo— es el
 * servidor, y su mensaje se muestra tal cual.
 */

import { useEffect, useMemo, useState } from 'react';

import {
  ETIQUETA_MEDIO_COBRO,
  type ArticuloConStock,
  type ClienteVista,
  type EntradaItemCompra,
  type EntradaNuevoPedido,
  type FormaPago,
  type ListaPrecioVista,
  type PedidoVista,
  type PresentacionVista,
  type VendedorVista,
  type MedioCobroPago,
  type ProveedorVista,
  type RecetaVista,
  type TipoEntidadCc,
  type TipoMovimientoCaja,
  type UnidadMedidaVista,
} from '../../compartido/contratos';
import {
  CampoFecha,
  CampoMoneda,
  CampoNumero,
  CampoOpciones,
  CampoSelector,
  CampoTexto,
  Fila,
  ModalFormulario,
} from '../componentes/Formulario';
import {
  abrirCaja,
  actualizarPedido,
  cerrarCaja,
  crearCompra,
  crearPedido,
  crearOrdenProduccion,
  obtenerArticulos,
  obtenerClientes,
  obtenerListasPrecio,
  obtenerPresentaciones,
  obtenerProveedores,
  obtenerVendedores,
  obtenerRecetas,
  obtenerUnidades,
  registrarCobroPago,
  registrarMovimientoCaja,
  type ResultadoCrearPedido,
} from '../servicios/cliente';
import { formatearCajas, formatearCantidad, formatearMoneda, pluralizar } from '../utiles/formato';

function mensajeDeError(causa: unknown): string {
  return causa instanceof Error ? causa.message : String(causa);
}

/* --------------------------------- Compra ---------------------------------- */

interface LineaCompra {
  articuloId: number | '';
  cantidadCompra: number | '';
  factorConversion: number | '';
  costoUnitario: number;
}

const LINEA_VACIA: LineaCompra = {
  articuloId: '',
  cantidadCompra: 1,
  factorConversion: 1,
  costoUnitario: 0,
};

export function FormularioCompra({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string, advertencias: string[]) => void;
}): JSX.Element {
  const [proveedores, setProveedores] = useState<ProveedorVista[]>([]);
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [unidades, setUnidades] = useState<UnidadMedidaVista[]>([]);
  const [proveedorId, setProveedorId] = useState<number | ''>('');
  const [formaPago, setFormaPago] = useState<FormaPago>('cuenta_corriente');
  const [lineas, setLineas] = useState<LineaCompra[]>([{ ...LINEA_VACIA }]);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerProveedores(), obtenerArticulos(), obtenerUnidades()])
      .then(([p, a, u]) => {
        setProveedores(p.filter((x) => x.activo));
        setArticulos(a.filter((x) => x.activo));
        setUnidades(u);
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  const editarLinea = (indice: number, cambio: Partial<LineaCompra>): void =>
    setLineas((previas) => previas.map((l, i) => (i === indice ? { ...l, ...cambio } : l)));

  const total = useMemo(
    () =>
      lineas.reduce((suma, l) => {
        const base = Number(l.cantidadCompra || 0) * Number(l.factorConversion || 0);
        return suma + Math.round(l.costoUnitario * base);
      }, 0),
    [lineas],
  );

  const completas = lineas.filter(
    (l) => l.articuloId !== '' && Number(l.cantidadCompra) > 0 && Number(l.factorConversion) > 0,
  );

  const guardar = (): void => {
    if (proveedorId === '' || completas.length === 0) return;
    setGuardando(true);
    setError(null);
    const items: EntradaItemCompra[] = completas.map((l) => {
      const articulo = articulos.find((a) => a.id === l.articuloId);
      return {
        articuloId: Number(l.articuloId),
        cantidadCompra: Number(l.cantidadCompra),
        // La unidad de compra es informativa: el factor es lo que convierte a base.
        unidadCompraId: articulo?.unidadBaseId ?? unidades[0]?.id ?? 1,
        factorConversion: Number(l.factorConversion),
        costoUnitario: l.costoUnitario,
      };
    });
    crearCompra({ proveedorId, formaPago, notas: notas.trim() || null, items })
      .then((r) =>
        alGuardar(
          `Compra #${r.compra.id} registrada por ${formatearMoneda(r.compra.total)}.`,
          r.advertencias,
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Nueva compra"
      descripcion="Ingresa mercaderia al stock y genera la deuda o el pago."
      ancho="max-w-3xl"
      error={error}
      guardando={guardando}
      puedeGuardar={proveedorId !== '' && completas.length > 0}
      etiquetaGuardar="Registrar compra"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        <span className="font-mono text-lg font-bold tabular-nums text-masa-900">
          Total: {formatearMoneda(total)}
        </span>
      }
    >
      <Fila>
        <CampoSelector
          id="co-prov"
          rotulo="Proveedor"
          valor={proveedorId}
          vacio="Elegi el proveedor"
          opciones={proveedores.map((p) => ({ valor: p.id, etiqueta: p.nombre }))}
          alCambiar={(v) => setProveedorId(v === '' ? '' : Number(v))}
        />
        <CampoOpciones
          rotulo="Forma de pago"
          valor={formaPago}
          opciones={[
            { valor: 'cuenta_corriente', etiqueta: 'Cuenta corriente' },
            { valor: 'contado', etiqueta: 'Contado' },
          ]}
          alCambiar={setFormaPago}
          ayuda={
            formaPago === 'contado'
              ? 'Sale de la caja abierta.'
              : 'Queda como deuda con el proveedor.'
          }
        />
      </Fila>

      <div>
        <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
          Articulos
        </p>
        <div className="space-y-2">
          {lineas.map((linea, indice) => {
            const articulo = articulos.find((a) => a.id === linea.articuloId);
            const base = Number(linea.cantidadCompra || 0) * Number(linea.factorConversion || 0);
            return (
              <div key={indice} className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                  <div className="sm:col-span-5">
                    <CampoSelector
                      id={`co-art-${indice}`}
                      rotulo="Articulo"
                      valor={linea.articuloId}
                      vacio="Elegi el articulo"
                      opciones={articulos.map((a) => ({
                        valor: a.id,
                        etiqueta: `${a.codigo} · ${a.nombre}`,
                      }))}
                      alCambiar={(v) => editarLinea(indice, { articuloId: v === '' ? '' : Number(v) })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <CampoNumero
                      id={`co-cant-${indice}`}
                      rotulo="Cantidad"
                      valor={linea.cantidadCompra}
                      alCambiar={(v) => editarLinea(indice, { cantidadCompra: v })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <CampoNumero
                      id={`co-fac-${indice}`}
                      rotulo="Factor"
                      valor={linea.factorConversion}
                      alCambiar={(v) => editarLinea(indice, { factorConversion: v })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <CampoMoneda
                      id={`co-costo-${indice}`}
                      rotulo={`Costo / ${articulo?.unidadAbreviatura ?? 'u'}`}
                      centavos={linea.costoUnitario}
                      alCambiar={(v) => editarLinea(indice, { costoUnitario: v })}
                    />
                  </div>
                </div>
                <div className="mt-1 flex items-center justify-between text-xs text-masa-700">
                  <span>
                    {base > 0 && articulo !== undefined
                      ? `Entran ${base} ${articulo.unidadAbreviatura} · subtotal ${formatearMoneda(Math.round(linea.costoUnitario * base))}`
                      : 'El factor convierte la cantidad comprada a la unidad de stock (bolsa de 25 kg = 25000 g).'}
                  </span>
                  {lineas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLineas((p) => p.filter((_, i) => i !== indice))}
                      className="rounded-pastilla border border-peligro-300 px-2 py-0.5 font-medium text-peligro-600 hover:bg-peligro-50"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setLineas((p) => [...p, { ...LINEA_VACIA }])}
          className="mt-2 rounded-ficha border border-masa-300 px-3 py-1.5 text-sm font-medium text-masa-800 hover:bg-masa-100"
        >
          + Agregar articulo
        </button>
      </div>

      <CampoTexto id="co-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/* ---------------------------------- Caja ----------------------------------- */

export function FormularioAperturaCaja({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [monto, setMonto] = useState(0);
  const [usuario, setUsuario] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    abrirCaja(monto, usuario.trim() || null)
      .then((caja) => alGuardar(`Caja #${caja.id} abierta con ${formatearMoneda(caja.montoApertura)}.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Abrir caja"
      descripcion="El monto inicial es el efectivo con el que arranca el dia."
      error={error}
      guardando={guardando}
      etiquetaGuardar="Abrir caja"
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoMoneda id="ca-monto" rotulo="Monto de apertura" centavos={monto} alCambiar={setMonto} />
      <CampoTexto id="ca-user" rotulo="Responsable" valor={usuario} alCambiar={setUsuario} maximo={80} />
    </ModalFormulario>
  );
}

export function FormularioCierreCaja({
  cajaId,
  saldoTeorico,
  alCerrar,
  alGuardar,
}: {
  readonly cajaId: number;
  readonly saldoTeorico: number;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [contado, setContado] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const diferencia = contado - saldoTeorico;

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    cerrarCaja(cajaId, { montoCierreReal: contado })
      .then((caja) =>
        alGuardar(
          caja.diferencia === 0
            ? `Caja #${caja.id} cerrada sin diferencias.`
            : `Caja #${caja.id} cerrada con una diferencia de ${formatearMoneda(caja.diferencia ?? 0)}.`,
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={`Cerrar caja #${cajaId}`}
      descripcion="Conta el efectivo y cargalo: la diferencia con el teorico queda registrada."
      error={error}
      guardando={guardando}
      etiquetaGuardar="Cerrar caja"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        <span className="text-sm text-masa-800">
          Teorico: <strong className="font-mono">{formatearMoneda(saldoTeorico)}</strong>
        </span>
      }
    >
      <CampoMoneda
        id="cc-contado"
        rotulo="Efectivo contado"
        centavos={contado}
        alCambiar={setContado}
        ayuda="Lo que hay fisicamente en la caja."
      />
      {contado > 0 && (
        <p
          className={[
            'rounded-ficha border px-3 py-2 text-sm',
            diferencia === 0
              ? 'border-menta-200 bg-menta-50 text-menta-700'
              : diferencia > 0
                ? 'border-info-200 bg-info-50 text-info-700'
                : 'border-peligro-200 bg-peligro-50 text-peligro-600',
          ].join(' ')}
        >
          {diferencia === 0
            ? 'El arqueo cierra exacto.'
            : diferencia > 0
              ? `Sobran ${formatearMoneda(diferencia)}: puede haber una venta sin cargar.`
              : `Faltan ${formatearMoneda(Math.abs(diferencia))}: revisa vueltos y retiros.`}
        </p>
      )}
    </ModalFormulario>
  );
}

export function FormularioMovimientoCaja({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [tipo, setTipo] = useState<TipoMovimientoCaja>('egreso');
  const [concepto, setConcepto] = useState('');
  const [monto, setMonto] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (): void => {
    setGuardando(true);
    setError(null);
    registrarMovimientoCaja({ tipo, concepto, monto })
      .then((r) =>
        alGuardar(
          `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${formatearMoneda(monto)} registrado en caja.` +
            (r.advertencias.length > 0 ? ` ${r.advertencias.join(' ')}` : ''),
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Movimiento de caja"
      descripcion="Para lo que entra o sale sin ser una venta ni una compra."
      error={error}
      guardando={guardando}
      puedeGuardar={concepto.trim().length >= 3 && monto > 0}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoOpciones
        rotulo="Tipo"
        valor={tipo}
        opciones={[
          { valor: 'egreso', etiqueta: 'Egreso (sale plata)' },
          { valor: 'ingreso', etiqueta: 'Ingreso (entra plata)' },
        ]}
        alCambiar={setTipo}
      />
      <CampoTexto
        id="mc-concepto"
        rotulo="Concepto"
        valor={concepto}
        alCambiar={setConcepto}
        requerido
        maximo={160}
        marcador="Flete, retiro del dueño, aporte..."
      />
      <CampoMoneda id="mc-monto" rotulo="Importe" centavos={monto} alCambiar={setMonto} />
    </ModalFormulario>
  );
}

/* ------------------------------ Cobros y pagos ----------------------------- */

export function FormularioCobroPago({
  entidadTipo,
  alCerrar,
  alGuardar,
}: {
  readonly entidadTipo: TipoEntidadCc;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string, advertencias: string[]) => void;
}): JSX.Element {
  const esCobro = entidadTipo === 'cliente';
  const [entidades, setEntidades] = useState<{ id: number; nombre: string; saldoCc: number }[]>([]);
  const [entidadId, setEntidadId] = useState<number | ''>('');
  const [monto, setMonto] = useState(0);
  const [medio, setMedio] = useState<MedioCobroPago>('efectivo');
  // Datos del cheque: sin ellos el cobro bajaba la deuda y el cheque no
  // entraba a la cartera, asi que la plata desaparecia del sistema.
  const hoy = new Date().toISOString().slice(0, 10);
  const [chequeNumero, setChequeNumero] = useState('');
  const [chequeBanco, setChequeBanco] = useState('');
  const [chequeFechaPago, setChequeFechaPago] = useState(hoy);
  const [chequeFormato, setChequeFormato] = useState<'fisico' | 'echeq'>('fisico');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    const consulta = esCobro ? obtenerClientes() : obtenerProveedores();
    consulta
      .then((lista: (ClienteVista | ProveedorVista)[]) =>
        setEntidades(
          lista
            .filter((e) => e.activo)
            .map((e) => ({ id: e.id, nombre: e.nombre, saldoCc: e.saldoCc })),
        ),
      )
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, [esCobro]);

  const elegida = entidades.find((e) => e.id === entidadId);
  // En clientes el saldo positivo es deuda a favor nuestro; en proveedores, al reves.
  const deuda = elegida === undefined ? 0 : esCobro ? elegida.saldoCc : -elegida.saldoCc;

  const guardar = (): void => {
    if (entidadId === '') return;
    setGuardando(true);
    setError(null);
    registrarCobroPago({
      entidadTipo,
      entidadId,
      monto,
      medio,
      cheque:
        medio === 'cheque'
          ? {
              numero: chequeNumero.trim(),
              fechaPago: chequeFechaPago,
              banco: chequeBanco.trim() || null,
              formato: chequeFormato,
            }
          : null,
      notas: notas.trim() || null,
    })
      .then((r) =>
        alGuardar(
          `${esCobro ? 'Cobro' : 'Pago'} de ${formatearMoneda(r.monto)} a ${r.entidadNombre} registrado.`,
          r.advertencias,
        ),
      )
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={esCobro ? 'Registrar cobro' : 'Registrar pago'}
      descripcion={
        esCobro
          ? 'Baja la deuda del cliente y, si es en efectivo, entra a la caja.'
          : 'Baja lo que le debemos al proveedor y, si es en efectivo, sale de la caja.'
      }
      error={error}
      guardando={guardando}
      puedeGuardar={
        entidadId !== '' && monto > 0 && (medio !== 'cheque' || chequeNumero.trim() !== '')
      }
      etiquetaGuardar={esCobro ? 'Registrar cobro' : 'Registrar pago'}
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        elegida !== undefined ? (
          <span className="text-sm text-masa-800">
            Deuda actual: <strong className="font-mono">{formatearMoneda(Math.max(deuda, 0))}</strong>
          </span>
        ) : undefined
      }
    >
      <CampoSelector
        id="cp-entidad"
        rotulo={esCobro ? 'Cliente' : 'Proveedor'}
        valor={entidadId}
        vacio={esCobro ? 'Elegi el cliente' : 'Elegi el proveedor'}
        opciones={entidades.map((e) => ({
          valor: e.id,
          etiqueta: `${e.nombre}${e.saldoCc !== 0 ? ` (${formatearMoneda(Math.abs(e.saldoCc))})` : ''}`,
        }))}
        alCambiar={(v) => setEntidadId(v === '' ? '' : Number(v))}
      />
      <Fila>
        <CampoMoneda id="cp-monto" rotulo="Importe" centavos={monto} alCambiar={setMonto} />
        <CampoSelector
          id="cp-medio"
          rotulo="Medio"
          valor={medio}
          opciones={(['efectivo', 'cheque', 'transferencia'] as const).map((m) => ({
            valor: m,
            etiqueta: ETIQUETA_MEDIO_COBRO[m],
          }))}
          alCambiar={(v) => setMedio((v === '' ? 'efectivo' : v) as MedioCobroPago)}
          ayuda={
            medio === 'efectivo'
              ? 'Impacta la caja abierta.'
              : medio === 'cheque'
                ? 'No toca la caja: entra a la cartera de cheques.'
                : 'No toca la caja.'
          }
        />
      </Fila>
      {medio === 'cheque' && (
        <>
          <Fila>
            <CampoTexto
              id="cp-cheque-numero"
              rotulo="Numero de cheque"
              valor={chequeNumero}
              alCambiar={setChequeNumero}
              maximo={40}
            />
            <CampoTexto
              id="cp-cheque-banco"
              rotulo="Banco"
              valor={chequeBanco}
              alCambiar={setChequeBanco}
              maximo={80}
            />
          </Fila>
          <Fila>
            <CampoFecha
              id="cp-cheque-fecha"
              rotulo={esCobro ? 'Fecha de cobro' : 'Fecha de pago'}
              valor={chequeFechaPago}
              alCambiar={setChequeFechaPago}
            />
            <CampoSelector
              id="cp-cheque-formato"
              rotulo="Formato"
              valor={chequeFormato}
              opciones={[
                { valor: 'fisico', etiqueta: 'Fisico' },
                { valor: 'echeq', etiqueta: 'ECHEQ' },
              ]}
              alCambiar={(v) => setChequeFormato(v === 'echeq' ? 'echeq' : 'fisico')}
            />
          </Fila>
        </>
      )}
      {monto > deuda && deuda >= 0 && monto > 0 && (
        <p className="rounded-ficha border border-alerta-200 bg-alerta-50 px-3 py-2 text-sm text-alerta-700">
          El importe supera la deuda: va a quedar un saldo a favor.
        </p>
      )}
      <CampoTexto id="cp-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={300} />
    </ModalFormulario>
  );
}

/* ---------------------------- Orden de produccion --------------------------- */

export function FormularioNuevaOrden({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string) => void;
}): JSX.Element {
  const [recetas, setRecetas] = useState<RecetaVista[]>([]);
  const [articulos, setArticulos] = useState<ArticuloConStock[]>([]);
  const [recetaId, setRecetaId] = useState<number | ''>('');
  const [cantidad, setCantidad] = useState<number | ''>('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerRecetas(), obtenerArticulos()])
      .then(([r, a]) => {
        setRecetas(r.filter((x) => x.activa));
        setArticulos(a);
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  const receta = recetas.find((r) => r.id === recetaId);
  const producto = articulos.find((a) => a.id === receta?.articuloProducidoId);

  /**
   * Los alfajores se cuentan en DOCENAS, no de a uno: es como se produce, como
   * se embala y como los pide el cliente. Para lo que no va en caja —el dulce
   * de leche, por ejemplo— se carga en su unidad, que es como se mide la olla.
   */
  const porDocenas = producto?.unidadesPorCaja === 12;
  const unidadesPorLote = porDocenas ? 12 : 1;
  const rotulo = porDocenas
    ? 'Cantidad a producir (docenas)'
    : `Cantidad a producir${receta !== undefined ? ` (${receta.rindeUnidadAbreviatura})` : ''}`;

  // Lo que se manda al servidor va SIEMPRE en la unidad base del producto.
  const cantidadBase = cantidad === '' ? 0 : Number(cantidad) * unidadesPorLote;

  const guardar = (): void => {
    if (recetaId === '' || cantidadBase <= 0) return;
    setGuardando(true);
    setError(null);
    crearOrdenProduccion({ recetaId, cantidad: cantidadBase, notas: notas.trim() || null })
      .then((r) => alGuardar(`Orden #${r.id} creada. Ejecutala para que salga el numero de lote.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Nueva orden de produccion"
      descripcion="Cuanto se va a elaborar. Los insumos se descuentan al finalizar la tanda."
      error={error}
      guardando={guardando}
      puedeGuardar={recetaId !== '' && cantidadBase > 0}
      etiquetaGuardar="Crear orden"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        receta !== undefined && cantidadBase > 0 ? (
          <span className="text-sm text-masa-800">
            <strong className="font-mono">
              {formatearCantidad(cantidadBase)} {receta.rindeUnidadAbreviatura}
            </strong>{' '}
            de {receta.articuloProducidoNombre}
            {porDocenas && (
              <> · {formatearCantidad(Number(cantidad))} {Number(cantidad) === 1 ? 'docena' : 'docenas'}</>
            )}
          </span>
        ) : undefined
      }
    >
      <CampoSelector
        id="op-receta"
        rotulo="Que se va a elaborar"
        valor={recetaId}
        vacio="Elegi la receta"
        opciones={recetas.map((r) => ({
          valor: r.id,
          etiqueta: `${r.articuloProducidoNombre} (una tanda rinde ${r.rindeCantidad} ${r.rindeUnidadAbreviatura})`,
        }))}
        alCambiar={(v) => setRecetaId(v === '' ? '' : Number(v))}
      />

      <CampoNumero
        id="op-cantidad"
        rotulo={rotulo}
        valor={cantidad}
        alCambiar={setCantidad}
        minimo={0}
        paso={porDocenas ? '1' : 'any'}
        ayuda={
          receta === undefined
            ? undefined
            : porDocenas
              ? `Se cargan docenas: 1 docena = 12 unidades. La receta rinde ${formatearCantidad(receta.rindeCantidad / 12)} ${receta.rindeCantidad === 12 ? 'docena' : 'docenas'} por tanda.`
              : `Una tanda completa da ${formatearCantidad(receta.rindeCantidad)} ${receta.rindeUnidadAbreviatura}.`
        }
      />

      {receta !== undefined && cantidadBase > 0 && (
        <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-masa-700">
            Insumos que va a consumir
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-masa-900">
            {receta.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="truncate">{item.insumoNombre}</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {formatearCantidad((item.cantidad * cantidadBase) / receta.rindeCantidad)}{' '}
                  {item.unidadAbreviatura}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <CampoTexto id="op-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/* --------------------------------- Pedidos --------------------------------- */

/**
 * Como se carga cada producto: los alfajores van por DOCENA (unidadesPorCaja
 * 12), otros por caja cerrada de N, y lo que no se encajona en su unidad.
 * El rotulo va bien visible arriba del incrementador porque un contador solo,
 * sin decir QUE cuenta, ya hizo cargar docenas creyendo cargar unidades.
 */
function unidadDeCarga(producto: ArticuloConStock): { rotulo: string; upc: number | null } {
  if (producto.unidadesPorCaja === 12) return { rotulo: 'docenas', upc: 12 };
  if (producto.unidadesPorCaja !== null) {
    return { rotulo: `cajas de ${producto.unidadesPorCaja} u`, upc: producto.unidadesPorCaja };
  }
  return { rotulo: producto.unidadAbreviatura, upc: null };
}

/** Una cantidad en la unidad en que se carga: "3 docenas", "2 cajas + 4 u", "5 kg". */
function enUnidadDeCarga(unidades: number, producto: ArticuloConStock): string {
  if (producto.unidadesPorCaja === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${resto} u`;
    const base = pluralizar(docenas, 'docena', 'docenas');
    return resto === 0 ? base : `${base} + ${resto} u`;
  }
  if (producto.unidadesPorCaja !== null) return formatearCajas(unidades, producto.unidadesPorCaja);
  return `${formatearCantidad(unidades)} ${producto.unidadAbreviatura}`;
}

/**
 * Traduce la respuesta del alta al mensaje del aviso. Es la respuesta directa
 * a "hice un pedido y no se si lo reservo de stock o hay que producir": el
 * mensaje cuenta lo que el servidor HIZO, no lo que el formulario esperaba.
 */
function mensajeDeAlta(r: ResultadoCrearPedido): { mensaje: string; tono: 'ok' | 'alerta' } {
  const id = r.datos.id;
  const { cobertura, ordenes } = r;
  // Reintento idempotente: el servidor no repite cobertura ni ordenes.
  if (cobertura === undefined || ordenes === undefined) {
    return { mensaje: `Pedido #${id} cargado.`, tono: 'ok' };
  }
  const reservado = cobertura.reservado.reduce((suma, x) => suma + x.cantidad, 0);
  const aElaborar = ordenes.creadas.reduce((suma, o) => suma + o.cantidad, 0);

  let mensaje: string;
  if (cobertura.quedoListo) {
    mensaje = `Pedido #${id} cargado: reservado completo de stock. LISTO para entregar.`;
  } else if (reservado > 0 && aElaborar > 0) {
    mensaje = `Pedido #${id} cargado: ${formatearCantidad(reservado)} u reservadas de stock, ${formatearCantidad(aElaborar)} u enviadas a elaboracion.`;
  } else if (aElaborar > 0) {
    mensaje = `Pedido #${id} cargado: enviado a elaboracion.`;
  } else if (reservado > 0) {
    // Cubrio una parte pero lo que falta no abrio orden (producto sin receta).
    mensaje = `Pedido #${id} cargado: ${formatearCantidad(reservado)} u reservadas de stock.`;
  } else {
    mensaje = `Pedido #${id} cargado.`;
  }

  // Lo que convierte el aviso en alerta: ordenes que nacieron sin insumos y
  // partes que no se pueden elaborar porque el producto no tiene receta.
  const avisos: string[] = [];
  const enEspera = ordenes.creadas.filter((o) => o.esperaInsumos);
  if (enEspera.length > 0) {
    const faltantes = enEspera
      .map((o) => o.insumosFaltantes)
      .filter((f): f is string => f !== null && f !== '')
      .join('; ');
    avisos.push(
      `ATENCION: la elaboracion queda EN ESPERA DE INSUMOS${faltantes === '' ? '' : ` (${faltantes})`}.`,
    );
  }
  if (ordenes.sinReceta.length > 0) {
    avisos.push(`Sin receta para ${ordenes.sinReceta.join(', ')}: esa parte no abrio orden.`);
  }
  if (avisos.length === 0) return { mensaje, tono: 'ok' };
  return { mensaje: `${mensaje} ${avisos.join(' ')}`, tono: 'alerta' };
}

/**
 * Alta y edicion de pedidos desde el mostrador. Es el mismo formulario que usa
 * la PWA del celular pero sin la cola offline: aca hay conexion garantizada.
 * Las cantidades se cargan en la unidad en que se venden (docenas o cajas) y
 * el resumen de abajo anticipa que se reserva de stock y que se elabora.
 */
function FormularioPedidoClasico({
  pedido,
  alCerrar,
  alGuardar,
}: {
  readonly pedido: PedidoVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string, tono: 'ok' | 'alerta') => void;
}): JSX.Element {
  const [productos, setProductos] = useState<ArticuloConStock[]>([]);
  const [clientes, setClientes] = useState<ClienteVista[]>([]);
  const [clienteId, setClienteId] = useState<number | ''>(pedido?.clienteId ?? '');
  const [notas, setNotas] = useState(pedido?.notas ?? '');
  const [seleccion, setSeleccion] = useState<Record<number, number>>({});
  // Cantidades exactas con las que se abrio el pedido, y el valor en cajas que
  // se le mostro al operador: juntos permiten saber que renglon no toco.
  const [cantidadesOriginales, setCantidadesOriginales] = useState<Record<number, number>>({});
  const [seleccionInicial, setSeleccionInicial] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerArticulos(), obtenerClientes()])
      .then(([a, c]) => {
        const activos = a.filter((x) => x.tipo === 'producto_terminado' && x.activo);
        setProductos(activos);
        setClientes(c.filter((x) => x.activo));
        // Al editar, las cantidades guardadas (en unidades) vuelven a docenas o cajas.
        if (pedido !== null) {
          const inicial: Record<number, number> = {};
          const exactas: Record<number, number> = {};
          for (const item of pedido.items) {
            const upc = activos.find((x) => x.id === item.articuloId)?.unidadesPorCaja ?? null;
            inicial[item.articuloId] = upc === null ? item.cantidad : Math.round(item.cantidad / upc);
            // La cantidad ORIGINAL en unidades, tal como se pidio.
            exactas[item.articuloId] = item.cantidad;
          }
          setSeleccion(inicial);
          setCantidadesOriginales(exactas);
          setSeleccionInicial(inicial);
        }
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, [pedido]);

  /*
   * Lo que viaja al servidor va SIEMPRE en unidades base.
   *
   * El renglon que el operador NO toco conserva su cantidad exacta. Antes se
   * reconstruia siempre como cajas x unidadesPorCaja, y como al abrir el
   * formulario las unidades se habian redondeado a cajas, editar cualquier cosa
   * —aunque fuera solo el cliente— reescribia las cantidades pedidas: 30 u con
   * cajas de 12 volvian como 24, y 12 u con cajas de 36 se redondeaban a 0 y el
   * renglon DESAPARECIA del pedido.
   */
  const items = Object.entries(seleccion)
    .map(([id, cargado]) => {
      const articuloId = Number(id);
      const upc = productos.find((p) => p.id === articuloId)?.unidadesPorCaja ?? null;
      const original = cantidadesOriginales[articuloId];
      const sinTocar = seleccionInicial[articuloId] === cargado;
      if (original !== undefined && sinTocar) {
        return { articuloId, cantidad: original };
      }
      return { articuloId, cantidad: upc === null ? cargado : cargado * upc };
    })
    .filter((i) => i.cantidad > 0);

  // Resumen en vivo: con el `disponible` que ya manda el servidor se anticipa
  // que parte se cubre con stock y que parte abre una orden, ANTES de cargar.
  const resumen = items.flatMap((item) => {
    const producto = productos.find((p) => p.id === item.articuloId);
    if (producto === undefined) return [];
    const disponible = Math.max(producto.disponible, 0);
    const reserva = Math.min(item.cantidad, disponible);
    return [{ producto, reserva, elabora: item.cantidad - reserva }];
  });
  const todoDeStock = resumen.length > 0 && resumen.every((l) => l.elabora === 0);
  const nadaDeStock = resumen.length > 0 && resumen.every((l) => l.reserva === 0);

  const guardar = (): void => {
    if (items.length === 0) return;
    // La confirmacion es solo del alta, que es lo que reserva stock y abre
    // ordenes. La edicion no dispara nada de eso: confirmar seria ruido.
    if (pedido === null) {
      const detalleReserva =
        resumen
          .filter((l) => l.reserva > 0)
          .map((l) => `${enUnidadDeCarga(l.reserva, l.producto)} de ${l.producto.nombre}`)
          .join(', ') || 'nada';
      const detalleElaborar =
        resumen
          .filter((l) => l.elabora > 0)
          .map((l) => `${enUnidadDeCarga(l.elabora, l.producto)} de ${l.producto.nombre}`)
          .join(', ') || 'nada';
      const confirmado = window.confirm(
        `Confirmas el pedido?\n\n• Se reservan de stock: ${detalleReserva}\n• Se manda a elaborar: ${detalleElaborar}\n\nAceptar = cargar`,
      );
      if (!confirmado) return;
    }
    setGuardando(true);
    setError(null);
    const entrada: EntradaNuevoPedido = {
      clienteId: clienteId === '' ? null : clienteId,
      origen: 'mostrador',
      // La fecha estimada de entrega se saco del formulario: no se usaba y
      // solo sumaba ruido. El servidor la acepta en null.
      fechaEntregaEstimada: null,
      notas: notas.trim() || null,
      items,
    };
    if (pedido === null) {
      crearPedido(entrada)
        .then((r) => {
          const resultado = mensajeDeAlta(r);
          alGuardar(resultado.mensaje, resultado.tono);
        })
        .catch((causa: unknown) => {
          setError(mensajeDeError(causa));
          setGuardando(false);
        });
    } else {
      actualizarPedido(pedido.id, entrada)
        .then(() => alGuardar(`Pedido #${pedido.id} actualizado.`, 'ok'))
        .catch((causa: unknown) => {
          setError(mensajeDeError(causa));
          setGuardando(false);
        });
    }
  };

  return (
    <ModalFormulario
      titulo={pedido === null ? 'Nuevo pedido' : `Editar pedido #${pedido.id}`}
      descripcion="Elegi cuanto lleva de cada producto. Abajo se ve que sale de stock y que se elabora."
      ancho="max-w-2xl"
      error={error}
      guardando={guardando}
      puedeGuardar={items.length > 0}
      etiquetaGuardar={pedido === null ? 'Cargar pedido' : 'Guardar cambios'}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <CampoSelector
        id="pe-cliente"
        rotulo="Cliente"
        valor={clienteId}
        vacio="Mostrador / sin cliente"
        opciones={clientes.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
        alCambiar={(v) => setClienteId(v === '' ? '' : Number(v))}
      />

      <div>
        <p className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700">
          Productos
        </p>
        <div className="overflow-hidden rounded-ficha border border-masa-200">
          {productos.map((producto, indice) => {
            const carga = unidadDeCarga(producto);
            const cantidadCargada = seleccion[producto.id] ?? 0;
            const unidades = carga.upc === null ? cantidadCargada : cantidadCargada * carga.upc;
            const disponible = Math.max(producto.disponible, 0);
            return (
              <div
                key={producto.id}
                className={['flex items-center gap-4 px-3 py-2.5', indice > 0 ? 'border-t border-masa-100' : ''].join(' ')}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-masa-900">{producto.nombre}</p>
                  {disponible > 0 ? (
                    <p className="text-xs font-medium text-menta-700">
                      {producto.unidadesPorCaja === null
                        ? `Hay ${enUnidadDeCarga(disponible, producto)} en stock`
                        : `Hay ${enUnidadDeCarga(disponible, producto)} listas en stock`}
                    </p>
                  ) : (
                    <p className="text-xs text-masa-700">Sin stock listo: se elabora al cargarlo</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-center">
                  <span className="mb-0.5 text-xs font-bold uppercase tracking-wide text-masa-800">
                    {carga.rotulo}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Sacar ${producto.nombre}`}
                      onClick={() => setSeleccion((s) => ({ ...s, [producto.id]: Math.max(cantidadCargada - 1, 0) }))}
                      disabled={cantidadCargada === 0}
                      className="h-9 w-9 rounded-none border border-masa-300 bg-masa-50 font-bold text-masa-900 disabled:opacity-30"
                    >
                      −
                    </button>
                    <span className="w-10 text-center font-mono text-base font-bold tabular-nums text-masa-900">
                      {cantidadCargada}
                    </span>
                    <button
                      type="button"
                      aria-label={`Agregar ${producto.nombre}`}
                      onClick={() => setSeleccion((s) => ({ ...s, [producto.id]: cantidadCargada + 1 }))}
                      className="h-9 w-9 rounded-none border border-dulce-400 bg-dulce-500 font-bold text-white"
                    >
                      +
                    </button>
                  </div>
                  {/* Altura fija para que la fila no salte cuando aparece la equivalencia. */}
                  <span className="mt-0.5 h-4 text-xs font-medium text-masa-800">
                    {carga.upc !== null && cantidadCargada > 0 ? `= ${unidades} unidades` : ''}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {resumen.length > 0 && (
        <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-masa-700">
            Envio a elaboracion
          </p>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-micro uppercase tracking-wide text-masa-700">
                <th scope="col" className="pb-0.5 text-left font-semibold">Producto</th>
                <th scope="col" className="pb-0.5 text-right font-semibold">Se reserva de stock</th>
                <th scope="col" className="pb-0.5 text-right font-semibold">Se manda a elaborar</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((l) => (
                <tr key={l.producto.id} className="border-t border-masa-200">
                  <td className="py-1 text-masa-900">{l.producto.nombre}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-masa-900">
                    {l.reserva > 0 ? enUnidadDeCarga(l.reserva, l.producto) : '—'}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums text-masa-900">
                    {l.elabora > 0 ? enUnidadDeCarga(l.elabora, l.producto) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={['mt-1.5 text-xs font-medium', todoDeStock ? 'text-menta-700' : 'text-alerta-700'].join(' ')}>
            {todoDeStock
              ? 'Hay stock para todo: se reserva completo y queda listo para entregar.'
              : nadaDeStock
                ? 'No hay stock listo: todo se manda a elaborar.'
                : 'Hay stock para una parte: se reserva eso y el resto se manda a elaborar.'}
          </p>
        </div>
      )}

      <CampoTexto id="pe-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/* --------------------- Talonario de pedidos (Anyulin) ---------------------- */

/**
 * El talonario replica la planilla real del cliente: primero se elige el
 * PRODUCTO (alfajores, almendras, cubanitos, caja Anyulin), despues la
 * PRESENTACION, y ahi se completan las cantidades POR VARIEDAD: blanco, negro,
 * frutilla blanco y frutilla negro. Cada "Agregar" suma renglones al pedido.
 * Los renglones son la verdad comercial (lo que se imprime y se factura); el
 * servidor los explota a unidades para el stock y la produccion.
 */

const VARIEDADES_ALFAJOR = [
  { codigo: 'ALF-B', etiqueta: 'BLANCO' },
  { codigo: 'ALF-N', etiqueta: 'NEGRO' },
  { codigo: 'ALF-FB', etiqueta: 'FRUTILLA BLANCO' },
  { codigo: 'ALF-FN', etiqueta: 'FRUTILLA NEGRO' },
] as const;

const TIPOS_ALFAJOR = [
  { prefijo: 'CAJA', etiqueta: 'Caja x36', unidades: 36 },
  { prefijo: 'DOC', etiqueta: 'Docena', unidades: 12 },
  { prefijo: 'BOL', etiqueta: 'Bolsa x6', unidades: 6 },
  { prefijo: 'UNI', etiqueta: 'Unidad suelta', unidades: 1 },
] as const;

const VARIEDADES_ALMENDRA = [
  { codigo: 'ALM-CL', etiqueta: 'CHOC C/LECHE' },
  { codigo: 'ALM-B', etiqueta: 'CHOC BLANCO' },
  { codigo: 'ALM-SA', etiqueta: 'CHOC SEMIAMARGO' },
] as const;

const VARIEDADES_CUBANITO = [
  { codigo: 'CUB-DDL', etiqueta: 'DULCE DE LECHE' },
  { codigo: 'CUB-FRU', etiqueta: 'FRUTILLA' },
  { codigo: 'CUB-MANI', etiqueta: 'MANI' },
  { codigo: 'CUB-AVE', etiqueta: 'AVELLANA' },
  { codigo: 'CUB-BAN', etiqueta: 'BANANITA' },
] as const;

/** Cajas de cubanitos: los sabores se eligen adentro, el precio es de la caja. */
const TIPOS_CUBANITO = [
  { sel: 'CUB10', codigoPres: 'CAJA-CUB-10', etiqueta: 'Caja x10', unidades: 10 },
  { sel: 'CUB16', codigoPres: 'CAJA-CUB-16', etiqueta: 'Caja x16', unidades: 16 },
] as const;

const PRODUCTOS_TALONARIO = [
  { valor: 'ALFAJORES', etiqueta: 'ALFAJORES' },
  { valor: 'ALMENDRAS', etiqueta: 'ALMENDRAS' },
  { valor: 'CUBANITOS', etiqueta: 'CUBANITOS' },
  { valor: 'ANYULIN', etiqueta: 'CAJA ANYULIN' },
] as const;

type ProductoTalonario = (typeof PRODUCTOS_TALONARIO)[number]['valor'];

/** Un renglon ya cargado en el talonario, con lo minimo para mostrar y enviar. */
interface RenglonTalonario {
  clave: string;
  presentacionId: number | null;
  descripcion: string | null;
  etiqueta: string;
  cantidad: number;
  unidadesPorUnidad: number;
  componentes: { articuloId: number; unidades: number }[];
}

function renglonDeCatalogo(pres: PresentacionVista, cantidad: number): RenglonTalonario {
  return {
    clave: `P${pres.id}`,
    presentacionId: pres.id,
    descripcion: null,
    etiqueta: pres.nombre,
    cantidad,
    unidadesPorUnidad: pres.unidadesTotales,
    componentes: pres.componentes.map((c) => ({ articuloId: c.articuloId, unidades: c.unidades })),
  };
}

function FormularioPedidoTalonario({
  pedido,
  presentaciones,
  alCerrar,
  alGuardar,
}: {
  readonly pedido: PedidoVista | null;
  readonly presentaciones: PresentacionVista[];
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string, tono: 'ok' | 'alerta') => void;
}): JSX.Element {
  const porCodigo = useMemo(
    () => new Map(presentaciones.map((p) => [p.codigo, p])),
    [presentaciones],
  );
  const porId = useMemo(() => new Map(presentaciones.map((p) => [p.id, p])), [presentaciones]);

  const [productos, setProductos] = useState<ArticuloConStock[]>([]);
  const [clientes, setClientes] = useState<ClienteVista[]>([]);
  const [clienteId, setClienteId] = useState<number | ''>(pedido?.clienteId ?? '');
  const [vendedores, setVendedores] = useState<VendedorVista[]>([]);
  const [listas, setListas] = useState<ListaPrecioVista[]>([]);
  const [vendedorId, setVendedorId] = useState<number | ''>(pedido?.vendedorId ?? '');
  const [listaPrecioId, setListaPrecioId] = useState<number | ''>(pedido?.listaPrecioId ?? '');
  const [notas, setNotas] = useState(pedido?.notas ?? '');
  const [renglones, setRenglones] = useState<RenglonTalonario[]>(() =>
    (pedido?.renglones ?? []).map((r, indice) => {
      if (r.presentacionId !== null && r.componentes.length === 0) {
        const pres = porId.get(r.presentacionId);
        if (pres !== undefined) return renglonDeCatalogo(pres, r.cantidad);
        return {
          clave: `P${r.presentacionId}`,
          presentacionId: r.presentacionId,
          descripcion: null,
          etiqueta: r.presentacionNombre ?? r.presentacionCodigo ?? `Presentacion #${r.presentacionId}`,
          cantidad: r.cantidad,
          unidadesPorUnidad: 0,
          componentes: [],
        };
      }
      if (r.presentacionId !== null) {
        // Caja de catalogo con contenido elegido (cubanitos con sus sabores).
        return {
          clave: `M${indice}`,
          presentacionId: r.presentacionId,
          descripcion: r.descripcion,
          etiqueta: r.descripcion ?? r.presentacionNombre ?? `Presentacion #${r.presentacionId}`,
          cantidad: r.cantidad,
          unidadesPorUnidad: r.componentes.reduce((suma, c) => suma + c.unidades, 0),
          componentes: r.componentes.map((c) => ({ articuloId: c.articuloId, unidades: c.unidades })),
        };
      }
      return {
        clave: `M${indice}`,
        presentacionId: null,
        descripcion: r.descripcion,
        etiqueta: r.descripcion ?? 'Armada a medida',
        cantidad: r.cantidad,
        unidadesPorUnidad: r.componentes.reduce((suma, c) => suma + c.unidades, 0),
        componentes: r.componentes.map((c) => ({ articuloId: c.articuloId, unidades: c.unidades })),
      };
    }),
  );
  const [producto, setProducto] = useState<ProductoTalonario>('ALFAJORES');
  const [presentacionSel, setPresentacionSel] = useState<string>('CAJA');
  const [cantidades, setCantidades] = useState<Record<string, number | ''>>({});
  const [cantidadCajas, setCantidadCajas] = useState<number | ''>(1);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    Promise.all([obtenerArticulos(), obtenerClientes(), obtenerVendedores(), obtenerListasPrecio()])
      .then(([a, c, v, l]) => {
        setProductos(a.filter((x) => x.tipo === 'producto_terminado' && x.activo));
        setClientes(c.filter((x) => x.activo));
        setVendedores(v.filter((x) => x.activo));
        setListas(l.filter((x) => x.activa));
      })
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  // Al elegir cliente se proponen SU lista y SU vendedor habituales; ambos se
  // pueden pisar a mano (el desplegable queda editable).
  const elegirCliente = (id: number | ''): void => {
    setClienteId(id);
    if (id === '') return;
    const cliente = clientes.find((c) => c.id === id);
    if (cliente === undefined) return;
    if (cliente.listaPrecioId !== null) setListaPrecioId(cliente.listaPrecioId);
    if (cliente.vendedorId !== null) setVendedorId(cliente.vendedorId);
  };

  // El articulo de cada variedad sale de las composiciones del catalogo Y del
  // maestro de articulos: los sabores de cubanito no figuran en ninguna
  // composicion fija (la caja arranca toda de dulce de leche).
  const articuloPorCodigo = useMemo(() => {
    const mapa = new Map<string, { articuloId: number; nombre: string }>();
    for (const pres of presentaciones) {
      for (const c of pres.componentes) {
        if (!mapa.has(c.articuloCodigo)) {
          mapa.set(c.articuloCodigo, { articuloId: c.articuloId, nombre: c.articuloNombre });
        }
      }
    }
    for (const articulo of productos) {
      if (!mapa.has(articulo.codigo)) {
        mapa.set(articulo.codigo, { articuloId: articulo.id, nombre: articulo.nombre });
      }
    }
    return mapa;
  }, [presentaciones, productos]);


  // Opciones de presentacion segun el producto elegido.
  const opcionesPresentacion = useMemo(() => {
    if (producto === 'ALFAJORES') {
      return TIPOS_ALFAJOR.filter((tipo) => porCodigo.has(`${tipo.prefijo}-ALF-B`)).map((tipo) => ({
        valor: tipo.prefijo as string,
        etiqueta: tipo.etiqueta,
      }));
    }
    if (producto === 'CUBANITOS') {
      return TIPOS_CUBANITO.filter((tipo) => porCodigo.has(tipo.codigoPres)).map((tipo) => ({
        valor: tipo.sel as string,
        etiqueta: tipo.etiqueta,
      }));
    }
    if (producto === 'ALMENDRAS') {
      return [{ valor: 'VAR', etiqueta: 'Bolsa 200 g' }];
    }
    // Caja Anyulin: las presentaciones con envase propio.
    return presentaciones
      .filter((p) => p.activo && p.componentes.some((c) => c.articuloCodigo === 'ENV-ANY'))
      .map((p) => ({ valor: `P${p.id}`, etiqueta: p.nombre }));
  }, [producto, porCodigo, presentaciones]);

  const cambiarProducto = (nuevo: ProductoTalonario): void => {
    setProducto(nuevo);
    setCantidades({});
    setCantidadCajas(1);
    if (nuevo === 'ALFAJORES') setPresentacionSel('CAJA');
    else if (nuevo === 'CUBANITOS') setPresentacionSel('CUB10');
    else if (nuevo === 'ALMENDRAS') setPresentacionSel('VAR');
    else setPresentacionSel('');
  };

  // Que variedades se completan y que significa el numero en cada modo.
  const variedades =
    producto === 'ALMENDRAS'
      ? VARIEDADES_ALMENDRA
      : producto === 'CUBANITOS'
        ? VARIEDADES_CUBANITO
        : VARIEDADES_ALFAJOR;
  const tipoAlfajor =
    producto === 'ALFAJORES'
      ? TIPOS_ALFAJOR.find((t) => t.prefijo === presentacionSel)
      : undefined;
  const tipoCubanito =
    producto === 'CUBANITOS'
      ? TIPOS_CUBANITO.find((t) => t.sel === presentacionSel)
      : undefined;
  // Caja cerrada (caja/docena/bolsa de alfajores, caja de cubanitos): las
  // variedades LLENAN la caja (la suma tiene que dar lo que lleva el envase)
  // y aparte se dice CUANTAS cajas asi van.
  const envaseCerrado =
    tipoAlfajor !== undefined && tipoAlfajor.unidades > 1
      ? { unidades: tipoAlfajor.unidades, etiqueta: tipoAlfajor.etiqueta }
      : tipoCubanito !== undefined
        ? { unidades: tipoCubanito.unidades, etiqueta: tipoCubanito.etiqueta }
        : undefined;
  const esCajaCerrada = envaseCerrado !== undefined;
  const esUnidadSuelta = tipoAlfajor !== undefined && tipoAlfajor.unidades === 1;
  const esPorUnidades = esUnidadSuelta || producto === 'ALMENDRAS';
  const esCatalogoDirecto = presentacionSel.startsWith('P');

  const numero = (clave: string): number => {
    const valor = cantidades[clave];
    return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? valor : 0;
  };
  const sumaVariedades = variedades.reduce((suma, v) => suma + numero(v.codigo), 0);
  const cantidadDirecta = numero('CANT');
  const cajas = typeof cantidadCajas === 'number' && cantidadCajas > 0 ? cantidadCajas : 0;

  const esAlmendras = producto === 'ALMENDRAS';
  const puedeAgregar = esCajaCerrada
    ? sumaVariedades === (envaseCerrado?.unidades ?? 0) && cajas > 0
    : esCatalogoDirecto
      ? cantidadDirecta > 0
      : variedades.some((v) => numero(v.codigo) > 0) && (!esAlmendras || cajas > 0);

  // Si el contenido cargado coincide con una presentacion del catalogo (36 de
  // blanco = la caja de blanco; 12+12+12 = la surtida), el renglon sale con
  // nombre y precio de catalogo. Si no, viaja armado a medida con su receta.
  const buscarEnCatalogo = (
    componentes: { articuloId: number; unidades: number }[],
  ): PresentacionVista | undefined =>
    presentaciones.find(
      (p) =>
        p.activo &&
        p.componentes.length === componentes.length &&
        componentes.every((c) =>
          p.componentes.some((pc) => pc.articuloId === c.articuloId && pc.unidades === c.unidades),
        ),
    );

  const agregar = (): void => {
    const nuevos: RenglonTalonario[] = [];
    if (esCajaCerrada && envaseCerrado !== undefined) {
      const partes = variedades.filter((v) => numero(v.codigo) > 0);
      const componentes = partes.flatMap((v) => {
        const articulo = articuloPorCodigo.get(v.codigo);
        return articulo === undefined
          ? []
          : [{ articuloId: articulo.articuloId, unidades: numero(v.codigo) }];
      });
      if (componentes.length !== partes.length) {
        setError('Falta una variedad en el catalogo: recarga el catalogo Anyulin.');
        return;
      }
      const enCatalogo = buscarEnCatalogo(componentes);
      const detalle = partes.map((v) => `${numero(v.codigo)} ${v.etiqueta}`).join(' + ');
      const presCaja =
        tipoCubanito !== undefined ? porCodigo.get(tipoCubanito.codigoPres) : undefined;
      if (enCatalogo !== undefined) {
        nuevos.push(renglonDeCatalogo(enCatalogo, cajas));
      } else if (presCaja !== undefined) {
        // Caja de cubanitos con sabores elegidos: el precio y el nombre son de
        // la caja; la composicion viaja propia.
        const rotulo = `${presCaja.nombre}: ${detalle}`;
        nuevos.push({
          clave: `M${Date.now()}`,
          presentacionId: presCaja.id,
          descripcion: rotulo,
          etiqueta: rotulo,
          cantidad: cajas,
          unidadesPorUnidad: envaseCerrado.unidades,
          componentes,
        });
      } else {
        const rotulo = `${envaseCerrado.etiqueta} surtida: ${detalle}`;
        nuevos.push({
          clave: `M${Date.now()}`,
          presentacionId: null,
          descripcion: rotulo,
          etiqueta: rotulo,
          cantidad: cajas,
          unidadesPorUnidad: envaseCerrado.unidades,
          componentes,
        });
      }
    } else if (esCatalogoDirecto) {
      const pres = porId.get(Number(presentacionSel.slice(1)));
      if (pres !== undefined && cantidadDirecta > 0) nuevos.push(renglonDeCatalogo(pres, cantidadDirecta));
    } else {
      // Unidades sueltas (alfajores por unidad) y bolsas de almendras. En
      // almendras el campo naranja multiplica: 1 C/LECHE x 3 bolsas = 3.
      const factor = esAlmendras ? cajas : 1;
      for (const v of variedades) {
        const cantidad = numero(v.codigo) * factor;
        if (cantidad === 0) continue;
        const pres = porCodigo.get(esUnidadSuelta ? `UNI-${v.codigo}` : v.codigo);
        if (pres !== undefined) nuevos.push(renglonDeCatalogo(pres, cantidad));
      }
    }
    if (nuevos.length === 0) return;
    // Mismo renglon de catalogo dos veces: se suma, no se duplica.
    setRenglones((actuales) => {
      let resultado = [...actuales];
      for (const nuevo of nuevos) {
        const esCatalogoPuro = nuevo.presentacionId !== null && nuevo.descripcion === null;
        const yaEsta =
          esCatalogoPuro &&
          resultado.some(
            (r) => r.presentacionId === nuevo.presentacionId && r.descripcion === null,
          );
        resultado = yaEsta
          ? resultado.map((r) =>
              r.presentacionId === nuevo.presentacionId && r.descripcion === null
                ? { ...r, cantidad: r.cantidad + nuevo.cantidad }
                : r,
            )
          : [...resultado, nuevo];
      }
      return resultado;
    });
    setCantidades({});
    setCantidadCajas(1);
    setError(null);
  };

  const quitar = (clave: string): void =>
    setRenglones((actuales) => actuales.filter((r) => r.clave !== clave));

  const codigoPorArticulo = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const [codigo, dato] of articuloPorCodigo) mapa.set(dato.articuloId, codigo);
    return mapa;
  }, [articuloPorCodigo]);

  // Un renglon con caja armable (alfajores: caja/docena/bolsa; cubanitos:
  // caja x10/x16) se puede REABRIR en el armador para tocar su composicion:
  // vuelve a los campos, se ajusta y se agrega de nuevo.
  const productoDeRenglon = (r: RenglonTalonario): 'ALFAJORES' | 'CUBANITOS' | null => {
    if (r.componentes.length === 0) return null;
    const codigos = r.componentes.map((c) => codigoPorArticulo.get(c.articuloId) ?? '');
    if (codigos.every((c) => c.startsWith('ALF-'))) return 'ALFAJORES';
    if (codigos.every((c) => c.startsWith('CUB-'))) return 'CUBANITOS';
    return null;
  };

  const editableEnArmador = (r: RenglonTalonario): boolean => {
    const cual = productoDeRenglon(r);
    if (cual === 'ALFAJORES') {
      return TIPOS_ALFAJOR.some((x) => x.unidades === r.unidadesPorUnidad && x.unidades > 1);
    }
    if (cual === 'CUBANITOS') {
      return TIPOS_CUBANITO.some((x) => x.unidades === r.unidadesPorUnidad);
    }
    return false;
  };

  const editarRenglon = (r: RenglonTalonario): void => {
    const cual = productoDeRenglon(r);
    const sel =
      cual === 'ALFAJORES'
        ? TIPOS_ALFAJOR.find((x) => x.unidades === r.unidadesPorUnidad)?.prefijo
        : cual === 'CUBANITOS'
          ? TIPOS_CUBANITO.find((x) => x.unidades === r.unidadesPorUnidad)?.sel
          : undefined;
    if (cual === null || sel === undefined) return;
    const valores: Record<string, number | ''> = {};
    for (const c of r.componentes) {
      const codigo = codigoPorArticulo.get(c.articuloId);
      if (codigo !== undefined) valores[codigo] = c.unidades;
    }
    setProducto(cual);
    setPresentacionSel(sel);
    setCantidades(valores);
    setCantidadCajas(r.cantidad);
    quitar(r.clave);
  };

  const cambiarCantidad = (clave: string, cantidad: number): void =>
    setRenglones((actuales) =>
      actuales.map((r) => (r.clave === clave ? { ...r, cantidad } : r)),
    );

  // Explosion en vivo: unidades por articulo, para anticipar reserva/elaboracion.
  const explosion = useMemo(() => {
    const mapa = new Map<number, number>();
    for (const renglon of renglones) {
      if (renglon.cantidad <= 0) continue;
      for (const c of renglon.componentes) {
        mapa.set(c.articuloId, (mapa.get(c.articuloId) ?? 0) + c.unidades * renglon.cantidad);
      }
    }
    return mapa;
  }, [renglones]);

  const resumen = [...explosion.entries()].flatMap(([articuloId, cantidad]) => {
    const articulo = productos.find((p) => p.id === articuloId);
    if (articulo === undefined) return [];
    const disponible = Math.max(articulo.disponible, 0);
    const reserva = Math.min(cantidad, disponible);
    return [{ producto: articulo, reserva, elabora: cantidad - reserva }];
  });
  const todoDeStock = resumen.length > 0 && resumen.every((l) => l.elabora === 0);
  const nadaDeStock = resumen.length > 0 && resumen.every((l) => l.reserva === 0);
  const renglonesValidos = renglones.length > 0 && renglones.every((r) => r.cantidad > 0);

  const guardar = (): void => {
    if (!renglonesValidos) return;
    if (pedido === null) {
      const detalleReserva =
        resumen
          .filter((l) => l.reserva > 0)
          .map((l) => `${enUnidadDeCarga(l.reserva, l.producto)} de ${l.producto.nombre}`)
          .join(', ') || 'nada';
      const detalleElaborar =
        resumen
          .filter((l) => l.elabora > 0)
          .map((l) => `${enUnidadDeCarga(l.elabora, l.producto)} de ${l.producto.nombre}`)
          .join(', ') || 'nada';
      const confirmado = window.confirm(
        `Confirmas el pedido?\n\n• Se reservan de stock: ${detalleReserva}\n• Se manda a elaborar: ${detalleElaborar}\n\nAceptar = cargar`,
      );
      if (!confirmado) return;
    }
    setGuardando(true);
    setError(null);
    const entrada: EntradaNuevoPedido = {
      clienteId: clienteId === '' ? null : clienteId,
      vendedorId: vendedorId === '' ? null : vendedorId,
      listaPrecioId: listaPrecioId === '' ? null : listaPrecioId,
      origen: 'mostrador',
      fechaEntregaEstimada: null,
      notas: notas.trim() || null,
      items: [],
      renglones: renglones.map((r) => {
        if (r.presentacionId !== null && r.descripcion === null) {
          return { presentacionId: r.presentacionId, cantidad: r.cantidad };
        }
        if (r.presentacionId !== null) {
          return {
            presentacionId: r.presentacionId,
            cantidad: r.cantidad,
            descripcion: r.descripcion,
            componentes: r.componentes,
          };
        }
        return { cantidad: r.cantidad, descripcion: r.descripcion, componentes: r.componentes };
      }),
    };
    if (pedido === null) {
      crearPedido(entrada)
        .then((r) => {
          const resultado = mensajeDeAlta(r);
          alGuardar(resultado.mensaje, resultado.tono);
        })
        .catch((causa: unknown) => {
          setError(mensajeDeError(causa));
          setGuardando(false);
        });
    } else {
      actualizarPedido(pedido.id, entrada)
        .then(() => alGuardar(`Pedido #${pedido.id} actualizado.`, 'ok'))
        .catch((causa: unknown) => {
          setError(mensajeDeError(causa));
          setGuardando(false);
        });
    }
  };

  const claseCampo =
    'h-10 w-24 rounded-none border border-masa-300 bg-white px-2 text-center font-mono text-base font-bold tabular-nums text-masa-900';

  return (
    <ModalFormulario
      titulo={pedido === null ? 'Nuevo pedido' : `Editar pedido #${pedido.id}`}
      descripcion="Elegi producto y presentacion, completa las unidades que lleva la caja y cuantas cajas van. Abajo queda el detalle del pedido."
      ancho="max-w-3xl"
      error={error}
      guardando={guardando}
      puedeGuardar={renglonesValidos}
      etiquetaGuardar={pedido === null ? 'Cargar pedido' : 'Guardar cambios'}
      alCerrar={alCerrar}
      alGuardar={guardar}
    >
      <Fila>
        <CampoSelector
          id="pe-cliente"
          rotulo="Cliente"
          valor={clienteId}
          vacio="Mostrador / sin cliente"
          opciones={clientes.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
          alCambiar={(v) => elegirCliente(v === '' ? '' : Number(v))}
        />
        <CampoSelector
          id="pe-lista"
          rotulo="Lista de precios"
          valor={listaPrecioId}
          vacio="La lista del cliente"
          opciones={listas.map((l) => ({ valor: l.id, etiqueta: l.nombre }))}
          alCambiar={(v) => setListaPrecioId(v === '' ? '' : Number(v))}
        />
      </Fila>

      <CampoSelector
        id="pe-vendedor"
        rotulo="Vendedor"
        valor={vendedorId}
        vacio="Venta directa / sin vendedor"
        opciones={vendedores.map((v) => ({ valor: v.id, etiqueta: v.nombre }))}
        alCambiar={(v) => setVendedorId(v === '' ? '' : Number(v))}
      />

      {/* ------------------------ Carga de renglones ------------------------ */}
      <div className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
        <Fila>
          <CampoSelector
            id="pe-producto"
            rotulo="Producto"
            valor={producto}
            opciones={PRODUCTOS_TALONARIO.map((p) => ({ valor: p.valor, etiqueta: p.etiqueta }))}
            alCambiar={(v) => cambiarProducto(v as ProductoTalonario)}
          />
          <CampoSelector
            id="pe-presentacion"
            rotulo="Presentacion"
            valor={presentacionSel}
            opciones={opcionesPresentacion}
            alCambiar={(v) => {
              setPresentacionSel(String(v));
              setCantidades({});
              setCantidadCajas(1);
            }}
          />
        </Fila>

        {(esCajaCerrada || esPorUnidades) && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-masa-700">
              {esCajaCerrada
                ? `Unidades de cada variedad que lleva la caja (suman ${envaseCerrado?.unidades ?? 0})`
                : producto === 'ALMENDRAS'
                  ? 'Cantidad de bolsas de cada variedad'
                  : 'Cantidad de unidades de cada variedad'}
            </p>
            <div className="flex flex-wrap gap-3">
              {variedades.map((v) => (
                <label key={v.codigo} className="flex flex-col gap-0.5">
                  <span className="text-micro font-bold uppercase tracking-wide text-masa-800">
                    {v.etiqueta}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cantidades[v.codigo] ?? ''}
                    onChange={(e) =>
                      setCantidades((s) => ({
                        ...s,
                        [v.codigo]: e.target.value === '' ? '' : Number(e.target.value),
                      }))
                    }
                    className={claseCampo}
                  />
                </label>
              ))}
              {(esCajaCerrada || esAlmendras) && (
                <label className="flex flex-col gap-0.5">
                  <span className="text-micro font-bold uppercase tracking-wide text-dulce-700">
                    {esAlmendras ? 'Cantidad de bolsas' : 'Cantidad de cajas'}
                  </span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={cantidadCajas}
                    onChange={(e) =>
                      setCantidadCajas(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className={claseCampo}
                  />
                </label>
              )}
            </div>
            {esAlmendras && (
              <p className="mt-1.5 text-xs text-masa-700">
                Marca las variedades y deci cuantas bolsas van: 1 en C/LECHE y cantidad 3 = 3 bolsas de c/leche.
              </p>
            )}
            {esCajaCerrada && sumaVariedades !== (envaseCerrado?.unidades ?? 0) && (
              <p className="mt-1.5 text-xs font-medium text-alerta-700">
                {sumaVariedades === 0
                  ? 'Completa las unidades de cada variedad.'
                  : `Van ${sumaVariedades} de ${envaseCerrado?.unidades ?? 0} unidades: ajusta para que la caja cierre.`}
              </p>
            )}
          </div>
        )}

        {esCatalogoDirecto && (
          <div className="mt-3 flex items-end gap-3">
            <label className="flex flex-col gap-0.5">
              <span className="text-micro font-bold uppercase tracking-wide text-masa-800">
                Cantidad
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={cantidades['CANT'] ?? ''}
                onChange={(e) =>
                  setCantidades((s) => ({
                    ...s,
                    CANT: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
                className={claseCampo}
              />
            </label>
            <p className="pb-2 text-xs text-masa-700">
              {porId.get(Number(presentacionSel.slice(1)))?.componentes
                .map((c) => `${c.unidades} ${c.articuloNombre}`)
                .join(' + ') ?? ''}
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={agregar}
          disabled={!puedeAgregar}
          className="mt-3 h-10 rounded-none border border-dulce-400 bg-dulce-500 px-5 text-sm font-bold uppercase tracking-wide text-white disabled:opacity-30"
        >
          Agregar al pedido
        </button>
      </div>

      {/* ------------------------- Detalle del pedido ----------------------- */}
      {renglones.length > 0 && (
        <div className="overflow-hidden rounded-ficha border border-masa-200">
          {renglones.map((r, indice) => (
            <div
              key={r.clave}
              className={[
                'flex items-center gap-3 px-3 py-2',
                indice > 0 ? 'border-t border-masa-100' : '',
              ].join(' ')}
            >
              <input
                type="number"
                min={1}
                step={1}
                value={r.cantidad}
                onChange={(e) => cambiarCantidad(r.clave, Number(e.target.value))}
                aria-label={`Cantidad de ${r.etiqueta}`}
                className="h-9 w-16 shrink-0 rounded-none border border-masa-300 bg-white px-1 text-center font-mono text-base font-bold tabular-nums text-masa-900"
              />
              <span className="shrink-0 text-sm font-bold text-masa-700">×</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-masa-900">
                {r.etiqueta}
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-masa-700">
                {r.unidadesPorUnidad > 0 && r.cantidad > 0
                  ? /bolsa 200/i.test(r.etiqueta)
                    ? `= ${formatearCantidad(r.cantidad)} ${r.cantidad === 1 ? 'bolsa' : 'bolsas'}`
                    : `= ${formatearCantidad(r.unidadesPorUnidad * r.cantidad)} u`
                  : ''}
              </span>
              {editableEnArmador(r) && (
                <button
                  type="button"
                  onClick={() => editarRenglon(r)}
                  className="h-8 shrink-0 rounded-none border border-masa-300 bg-white px-3 text-xs font-bold uppercase text-masa-800"
                >
                  Editar
                </button>
              )}
              <button
                type="button"
                onClick={() => quitar(r.clave)}
                className="h-8 shrink-0 rounded-none border border-peligro-300 bg-white px-3 text-xs font-bold uppercase text-peligro-700"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}

      {resumen.length > 0 && (
        <div className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2">
          <p className="text-micro font-semibold uppercase tracking-wide text-masa-700">
            Envio a elaboracion
          </p>
          <table className="mt-1 w-full text-sm">
            <thead>
              <tr className="text-micro uppercase tracking-wide text-masa-700">
                <th scope="col" className="pb-0.5 text-left font-semibold">Producto</th>
                <th scope="col" className="pb-0.5 text-right font-semibold">Se reserva de stock</th>
                <th scope="col" className="pb-0.5 text-right font-semibold">Se manda a elaborar</th>
              </tr>
            </thead>
            <tbody>
              {resumen.map((l) => (
                <tr key={l.producto.id} className="border-t border-masa-200">
                  <td className="py-1 text-masa-900">{l.producto.nombre}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-masa-900">
                    {l.reserva > 0 ? enUnidadDeCarga(l.reserva, l.producto) : '—'}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums text-masa-900">
                    {l.elabora > 0 ? enUnidadDeCarga(l.elabora, l.producto) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={['mt-1.5 text-xs font-medium', todoDeStock ? 'text-menta-700' : 'text-alerta-700'].join(' ')}>
            {todoDeStock
              ? 'Hay stock para todo: se reserva completo y queda listo para entregar.'
              : nadaDeStock
                ? 'No hay stock listo: todo se manda a elaborar.'
                : 'Hay stock para una parte: se reserva eso y el resto se manda a elaborar.'}
          </p>
        </div>
      )}

      <CampoTexto id="pe-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}

/**
 * Alta y edicion de pedidos. Si hay catalogo de presentaciones cargado se usa
 * el talonario (la forma real de pedir del cliente); si no, o al editar un
 * pedido viejo cargado por articulo, se cae al formulario clasico.
 */
export function FormularioPedido({
  pedido,
  alCerrar,
  alGuardar,
}: {
  readonly pedido: PedidoVista | null;
  readonly alCerrar: () => void;
  readonly alGuardar: (mensaje: string, tono: 'ok' | 'alerta') => void;
}): JSX.Element | null {
  const [presentaciones, setPresentaciones] = useState<PresentacionVista[] | null>(null);
  useEffect(() => {
    obtenerPresentaciones()
      .then(setPresentaciones)
      .catch(() => setPresentaciones([]));
  }, []);
  if (presentaciones === null) return null;
  const usaTalonario =
    presentaciones.length > 0 &&
    (pedido === null || pedido.renglones.length > 0 || pedido.items.length === 0);
  return usaTalonario ? (
    <FormularioPedidoTalonario
      pedido={pedido}
      presentaciones={presentaciones}
      alCerrar={alCerrar}
      alGuardar={alGuardar}
    />
  ) : (
    <FormularioPedidoClasico pedido={pedido} alCerrar={alCerrar} alGuardar={alGuardar} />
  );
}
