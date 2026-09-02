/**
 * Ficha de una cuenta corriente, portada del modulo de StockFlow.
 *
 * Arriba el saldo y el boton de cobrar; despues los COMPROBANTES CON SALDO
 * —que es lo que el cliente pregunta por telefono: "cual me quedo debiendo"— y
 * abajo el libro de movimientos con saldo corrido.
 *
 * La cobranza imputa FIFO (del comprobante mas viejo al mas nuevo) y muestra el
 * reparto ANTES de confirmar: que el operador vea que factura se cierra es lo
 * que evita el "pero yo pague la del 3" tres semanas despues.
 */

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import type {
  DetalleCuentaCorrienteVista,
  MedioCobroPago,
  SimulacionImputacion,
  TipoEntidadCc,
} from '../../compartido/contratos';
import { ETIQUETA_MEDIO_COBRO } from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion } from '../componentes/comunes';
import { CampoFecha, CampoTexto, ModalFormulario } from '../componentes/Formulario';
import {
  obtenerDetalleCuentaCorriente,
  registrarCobroPago,
  simularImputacion,
} from '../servicios/cliente';
import { aCentavos, formatearFecha, formatearMoneda } from '../utiles/formato';

const MEDIOS: readonly MedioCobroPago[] = ['efectivo', 'transferencia', 'cheque'];

export function FichaCuentaCorriente({
  entidadTipo,
  entidadId,
  alVolver,
}: {
  readonly entidadTipo: TipoEntidadCc;
  readonly entidadId: number;
  readonly alVolver: () => void;
}): JSX.Element {
  const [detalle, setDetalle] = useState<DetalleCuentaCorrienteVista | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const esCobro = entidadTipo === 'cliente';

  const recargar = (): void => {
    obtenerDetalleCuentaCorriente(entidadTipo, entidadId)
      .then((d) => {
        setDetalle(d);
        setError(null);
      })
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)));
  };

  useEffect(recargar, [entidadTipo, entidadId]);

  if (error !== null) return <EstadoError mensaje={error} alReintentar={recargar} />;
  if (detalle === null) return <EstadoCargando que="la cuenta corriente" />;

  const deudaAbierta = detalle.comprobantes.reduce((suma, c) => suma + c.saldo, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={alVolver}
            className="flex h-9 items-center gap-1 rounded-ficha border border-masa-300 px-3 text-sm text-masa-800 hover:bg-masa-100"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Volver
          </button>
          <div>
            <h2 className="text-lg font-semibold text-masa-900">{detalle.entidadNombre}</h2>
            <p className="text-xs uppercase tracking-wide text-masa-700">
              {esCobro ? 'Cliente' : 'Proveedor'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-ficha border border-masa-300 bg-white px-4 py-2 text-right">
            <p className="text-micro uppercase tracking-wide text-masa-700">
              {detalle.saldo >= 0 ? (esCobro ? 'Nos debe' : 'Le debemos') : 'Saldo a favor'}
            </p>
            <p className="font-mono text-lg font-semibold text-masa-900">
              {formatearMoneda(Math.abs(detalle.saldo))}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCobrando(true)}
            className="h-10 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase tracking-wide text-white"
          >
            {esCobro ? 'Registrar cobranza' : 'Registrar pago'}
          </button>
        </div>
      </div>

      <Seccion titulo="Comprobantes con saldo">
        {detalle.comprobantes.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            No queda ningun comprobante sin cancelar.
          </p>
        ) : (
          <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                  <th className="px-3 py-2 font-semibold">Fecha</th>
                  <th className="px-3 py-2 font-semibold">Comprobante</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                  <th className="px-3 py-2 text-right font-semibold">Cancelado</th>
                  <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {detalle.comprobantes.map((comprobante) => (
                  <tr
                    key={`${comprobante.documentoTipo}-${comprobante.documentoId}`}
                    className="border-b border-masa-100 last:border-0"
                  >
                    <td className="px-3 py-2 text-masa-700">{formatearFecha(comprobante.fecha)}</td>
                    <td className="px-3 py-2 text-masa-900">
                      {comprobante.documentoTipo} #{comprobante.documentoId}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-700">
                      {formatearMoneda(comprobante.total)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-700">
                      {comprobante.imputado === 0 ? '—' : formatearMoneda(comprobante.imputado)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-masa-900">
                      {formatearMoneda(comprobante.saldo)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-masa-50">
                  <td className="px-3 py-2 font-semibold text-masa-800" colSpan={4}>
                    Total sin cancelar
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-masa-900">
                    {formatearMoneda(deudaAbierta)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {detalle.saldoAFavor > 0 && (
          <p className="mt-2 rounded-ficha border border-menta-300 bg-menta-50 px-3 py-2 text-sm text-menta-800">
            Hay {formatearMoneda(detalle.saldoAFavor)} cobrados sin imputar a ningun comprobante
            (saldo a favor).
          </p>
        )}
      </Seccion>

      <Seccion titulo="Movimientos">
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                <th className="px-3 py-2 font-semibold">Fecha</th>
                <th className="px-3 py-2 font-semibold">Detalle</th>
                <th className="px-3 py-2 text-right font-semibold">Debe</th>
                <th className="px-3 py-2 text-right font-semibold">Haber</th>
                <th className="px-3 py-2 text-right font-semibold">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {detalle.movimientos.map((movimiento) => (
                <tr key={movimiento.id} className="border-b border-masa-100 last:border-0">
                  <td className="px-3 py-2 text-masa-700">{formatearFecha(movimiento.fecha)}</td>
                  <td className="px-3 py-2 text-masa-900">
                    {movimiento.notas ??
                      `${movimiento.documentoTipo}${
                        movimiento.documentoId === null ? '' : ` #${movimiento.documentoId}`
                      }`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-800">
                    {movimiento.tipoMovimiento === 'debe' ? formatearMoneda(movimiento.monto) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-menta-800">
                    {movimiento.tipoMovimiento === 'haber' ? formatearMoneda(movimiento.monto) : ''}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-900">
                    {formatearMoneda(Math.abs(movimiento.saldoAcumulado))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Seccion>

      {cobrando && (
        <FormularioCobranza
          detalle={detalle}
          alCerrar={() => setCobrando(false)}
          alGuardar={() => {
            setCobrando(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Cobranza a la cuenta: un importe que se reparte entre medios y se imputa
 * FIFO. Es el dialogo de StockFlow, con dos cosas propias: el cheque pide sus
 * datos (para entrar a la cartera) y la imputacion se ve antes de confirmar.
 */
function FormularioCobranza({
  detalle,
  alCerrar,
  alGuardar,
}: {
  readonly detalle: DetalleCuentaCorrienteVista;
  readonly alCerrar: () => void;
  readonly alGuardar: () => void;
}): JSX.Element {
  const esCobro = detalle.entidadTipo === 'cliente';
  const deuda = Math.max(detalle.saldo, 0);
  const [montoTexto, setMontoTexto] = useState(String(deuda / 100));
  const [porMedio, setPorMedio] = useState<Record<MedioCobroPago, string>>({
    efectivo: '',
    transferencia: '',
    cheque: '',
  });
  const [chequeNumero, setChequeNumero] = useState('');
  const [chequeBanco, setChequeBanco] = useState('');
  const [chequeFecha, setChequeFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [notas, setNotas] = useState('');
  const [simulacion, setSimulacion] = useState<SimulacionImputacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const monto = aCentavos(Number(montoTexto.replace(',', '.')) || 0);
  const asignado = MEDIOS.reduce(
    (suma, medio) => suma + aCentavos(Number((porMedio[medio] || '').replace(',', '.')) || 0),
    0,
  );
  const restante = monto - asignado;
  const hayCheque = aCentavos(Number((porMedio.cheque || '').replace(',', '.')) || 0) > 0;

  // La imputacion se pide al servidor y no se calcula aca: el reparto que se
  // muestra tiene que ser EL MISMO que despues se asienta.
  useEffect(() => {
    if (monto <= 0) {
      setSimulacion(null);
      return;
    }
    let vigente = true;
    simularImputacion(detalle.entidadTipo, detalle.entidadId, monto)
      .then((s) => {
        if (vigente) setSimulacion(s);
      })
      .catch(() => {
        if (vigente) setSimulacion(null);
      });
    return () => {
      vigente = false;
    };
  }, [monto, detalle.entidadTipo, detalle.entidadId]);

  const todoEnEfectivo = (): void => {
    setPorMedio({ efectivo: String(monto / 100), transferencia: '', cheque: '' });
  };

  const confirmar = (): void => {
    if (guardando) return;
    const tramos = MEDIOS.map((medio) => ({
      medio,
      importe: aCentavos(Number((porMedio[medio] || '').replace(',', '.')) || 0),
      cheque:
        medio === 'cheque'
          ? { numero: chequeNumero.trim(), fechaPago: chequeFecha, banco: chequeBanco.trim() || null }
          : null,
    })).filter((tramo) => tramo.importe > 0);

    if (tramos.length === 0) {
      setError('Indica por que medio entra la plata.');
      return;
    }
    if (restante !== 0) {
      setError(
        restante > 0
          ? `Falta asignar ${formatearMoneda(restante)}.`
          : `Asignaste ${formatearMoneda(-restante)} de mas.`,
      );
      return;
    }
    setGuardando(true);
    setError(null);
    registrarCobroPago({
      entidadTipo: detalle.entidadTipo,
      entidadId: detalle.entidadId,
      monto,
      medio: tramos[0]!.medio,
      tramos,
      notas: notas.trim() || null,
    })
      .then(alGuardar)
      .catch((causa: unknown) => {
        setError(causa instanceof Error ? causa.message : String(causa));
        setGuardando(false);
      });
  };

  return (
    <ModalFormulario
      titulo={esCobro ? 'Registrar cobranza a la cuenta' : 'Registrar pago a la cuenta'}
      descripcion="El importe se aplica a los comprobantes abiertos, del mas antiguo al mas reciente."
      error={error}
      guardando={guardando}
      ancho="max-w-2xl"
      puedeGuardar={monto > 0 && restante === 0 && (!hayCheque || chequeNumero.trim() !== '')}
      etiquetaGuardar={esCobro ? 'Confirmar cobranza' : 'Confirmar pago'}
      alCerrar={alCerrar}
      alGuardar={confirmar}
      pieIzquierdo={
        <span className={`text-sm ${restante === 0 ? 'text-menta-800' : 'text-peligro-700'}`}>
          {restante === 0
            ? 'Composicion completa'
            : restante > 0
              ? `Restante a asignar: ${formatearMoneda(restante)}`
              : `Asignaste ${formatearMoneda(-restante)} de mas`}
        </span>
      }
    >
      <p className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2 text-sm text-masa-800">
        {esCobro ? 'Nos debe' : 'Le debemos'}{' '}
        <strong className="font-mono">{formatearMoneda(deuda)}</strong>
      </p>

      <div>
        <label
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700"
          htmlFor="cobranza-monto"
        >
          {esCobro ? 'Monto a cobrar' : 'Monto a pagar'}
        </label>
        <input
          id="cobranza-monto"
          className="h-11 w-full rounded-ficha border border-masa-300 bg-white px-3 text-lg font-mono"
          value={montoTexto}
          onChange={(e) => setMontoTexto(e.target.value)}
        />
      </div>

      {/* Reparto por medio */}
      <div className="rounded-ficha border border-masa-200 bg-masa-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-masa-700">
            Composicion del pago
          </h3>
          <button
            type="button"
            className="text-sm text-dulce-700 underline"
            onClick={todoEnEfectivo}
          >
            Todo en efectivo
          </button>
        </div>
        <div className="space-y-2">
          {MEDIOS.map((medio) => (
            <div key={medio} className="flex items-center justify-between gap-3">
              <label className="text-sm text-masa-800" htmlFor={`cobranza-${medio}`}>
                {ETIQUETA_MEDIO_COBRO[medio]}
              </label>
              <input
                id={`cobranza-${medio}`}
                className="h-9 w-40 rounded-ficha border border-masa-300 bg-white px-3 text-right font-mono text-sm"
                placeholder="0,00"
                value={porMedio[medio]}
                onChange={(e) => setPorMedio((prev) => ({ ...prev, [medio]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {hayCheque && (
          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-masa-200 pt-3 sm:grid-cols-3">
            <CampoTexto
              id="cobranza-cheque-numero"
              rotulo="Numero de cheque"
              valor={chequeNumero}
              alCambiar={setChequeNumero}
              maximo={40}
            />
            <CampoTexto
              id="cobranza-cheque-banco"
              rotulo="Banco"
              valor={chequeBanco}
              alCambiar={setChequeBanco}
              maximo={80}
            />
            <CampoFecha
              id="cobranza-cheque-fecha"
              rotulo={esCobro ? 'Fecha de cobro' : 'Fecha de pago'}
              valor={chequeFecha}
              alCambiar={setChequeFecha}
            />
          </div>
        )}
      </div>

      {/* A que comprobantes va */}
      {simulacion !== null && (
        <div className="rounded-ficha border border-masa-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-masa-700">
            Se va a aplicar a
          </h3>
          {simulacion.imputaciones.length === 0 ? (
            <p className="text-sm text-masa-700">
              No hay comprobantes abiertos: queda todo como saldo a favor.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {simulacion.imputaciones.map((imputacion) => {
                const cierra = imputacion.importe >= imputacion.total;
                return (
                  <li
                    key={`${imputacion.documentoTipo}-${imputacion.documentoId}`}
                    className="flex items-center justify-between"
                  >
                    <span className="text-masa-800">
                      {imputacion.documentoTipo} #{imputacion.documentoId} ·{' '}
                      {formatearFecha(imputacion.fecha)}
                      <Pastilla texto={cierra ? 'Se cancela' : 'Parcial'} tono={cierra ? 'positivo' : 'alerta'} />
                    </span>
                    <span className="font-mono tabular-nums text-masa-900">
                      {formatearMoneda(imputacion.importe)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {simulacion.sobrante > 0 && (
            <p className="mt-2 text-sm text-menta-800">
              Sobran {formatearMoneda(simulacion.sobrante)}: quedan a favor.
            </p>
          )}
        </div>
      )}

      <CampoTexto id="cobranza-notas" rotulo="Notas" valor={notas} alCambiar={setNotas} maximo={300} />
    </ModalFormulario>
  );
}
