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
  type FormaPago,
  type MedioCobroPago,
  type ProveedorVista,
  type RecetaVista,
  type TipoEntidadCc,
  type TipoMovimientoCaja,
  type UnidadMedidaVista,
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
  abrirCaja,
  cerrarCaja,
  crearCompra,
  crearOrdenProduccion,
  obtenerArticulos,
  obtenerClientes,
  obtenerProveedores,
  obtenerRecetas,
  obtenerUnidades,
  registrarCobroPago,
  registrarMovimientoCaja,
} from '../servicios/cliente';
import { formatearMoneda } from '../utiles/formato';

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
      .then(() =>
        alGuardar(
          `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} de ${formatearMoneda(monto)} registrado en caja.`,
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
    registrarCobroPago({ entidadTipo, entidadId, monto, medio, notas: notas.trim() || null })
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
      puedeGuardar={entidadId !== '' && monto > 0}
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
          ayuda={medio === 'efectivo' ? 'Impacta la caja abierta.' : 'No toca la caja.'}
        />
      </Fila>
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
  const [recetaId, setRecetaId] = useState<number | ''>('');
  const [factorEscala, setFactorEscala] = useState<number | ''>(1);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerRecetas()
      .then((r) => setRecetas(r.filter((x) => x.activa)))
      .catch((causa: unknown) => setError(mensajeDeError(causa)));
  }, []);

  const receta = recetas.find((r) => r.id === recetaId);
  const cantidad =
    receta === undefined ? 0 : receta.rindeCantidad * Number(factorEscala || 0);

  const guardar = (): void => {
    if (recetaId === '' || Number(factorEscala) <= 0) return;
    setGuardando(true);
    setError(null);
    crearOrdenProduccion({ recetaId, factorEscala: Number(factorEscala), notas: notas.trim() || null })
      .then((r) => alGuardar(`Orden #${r.id} planificada. Ejecutala para que salga el numero de lote.`))
      .catch((causa: unknown) => {
        setError(mensajeDeError(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo="Planificar produccion"
      descripcion="La cantidad sale del rinde de la receta por el factor de escala."
      error={error}
      guardando={guardando}
      puedeGuardar={recetaId !== '' && Number(factorEscala) > 0}
      etiquetaGuardar="Planificar orden"
      alCerrar={alCerrar}
      alGuardar={guardar}
      pieIzquierdo={
        receta !== undefined ? (
          <span className="text-sm text-masa-800">
            Se van a producir{' '}
            <strong className="font-mono">
              {cantidad} {receta.rindeUnidadAbreviatura}
            </strong>{' '}
            de {receta.articuloProducidoNombre}
          </span>
        ) : undefined
      }
    >
      <CampoSelector
        id="op-receta"
        rotulo="Receta"
        valor={recetaId}
        vacio="Elegi la receta"
        opciones={recetas.map((r) => ({
          valor: r.id,
          etiqueta: `${r.articuloProducidoNombre} (rinde ${r.rindeCantidad} ${r.rindeUnidadAbreviatura})`,
        }))}
        alCambiar={(v) => setRecetaId(v === '' ? '' : Number(v))}
      />
      <CampoNumero
        id="op-factor"
        rotulo="Factor de escala"
        valor={factorEscala}
        alCambiar={setFactorEscala}
        minimo={0.01}
        paso="0.5"
        ayuda="1 = una tanda, 0.5 = media tanda, 2 = tanda doble."
      />
      <CampoTexto id="op-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={500} />
    </ModalFormulario>
  );
}
