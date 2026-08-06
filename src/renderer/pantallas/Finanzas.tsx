/**
 * Pantallas de finanzas: caja y cuentas corrientes.
 *
 * El saldo de cuenta corriente sale del ledger `cuentas_corrientes`, unico para
 * clientes y proveedores: saldo = debe - haber. Un saldo positivo de cliente
 * significa que nos debe; uno negativo de proveedor, que le debemos.
 */

import { useState } from 'react';
import { Plus } from 'lucide-react';

import type { CajaMovimientoVista, CajaVista, ResumenCuentaCorriente } from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Aviso, BotonPrimario } from '../componentes/Formulario';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerCajas, obtenerCuentasCorrientes, obtenerMovimientosCaja } from '../servicios/cliente';
import {
  FormularioAperturaCaja,
  FormularioCierreCaja,
  FormularioCobroPago,
  FormularioMovimientoCaja,
} from './FormulariosOperacion';
import {
  formatearFecha,
  formatearFechaHora,
  formatearMoneda,
  formatearMonedaConSigno,
  formatearTexto,
} from '../utiles/formato';

/* ----------------------------------- Caja ---------------------------------- */

const COLUMNAS_CAJAS: readonly Columna<CajaVista>[] = [
  { clave: 'id', titulo: '#', celda: (c) => c.id, numerica: true, ancho: 'w-14' },
  { clave: 'apertura', titulo: 'Apertura', celda: (c) => formatearFechaHora(c.fechaApertura), numerica: true },
  {
    clave: 'cierre',
    titulo: 'Cierre',
    celda: (c) => (c.fechaCierre === null ? '—' : formatearFechaHora(c.fechaCierre)),
    numerica: true,
  },
  { clave: 'inicial', titulo: 'Monto inicial', celda: (c) => formatearMoneda(c.montoApertura), numerica: true },
  {
    clave: 'ingresos',
    titulo: 'Ingresos',
    celda: (c) => <span className="text-menta-700">{formatearMoneda(c.totalIngresos)}</span>,
    numerica: true,
  },
  {
    clave: 'egresos',
    titulo: 'Egresos',
    celda: (c) => <span className="text-peligro-600">{formatearMoneda(c.totalEgresos)}</span>,
    numerica: true,
  },
  {
    clave: 'teorico',
    titulo: 'Cierre teorico',
    celda: (c) => (c.montoCierreTeorico === null ? '—' : formatearMoneda(c.montoCierreTeorico)),
    numerica: true,
  },
  {
    clave: 'diferencia',
    titulo: 'Diferencia',
    numerica: true,
    celda: (c) =>
      c.diferencia === null ? (
        '—'
      ) : (
        <span className={c.diferencia < 0 ? 'text-peligro-600' : 'text-menta-700'}>
          {formatearMonedaConSigno(c.diferencia)}
        </span>
      ),
  },
  {
    clave: 'estado',
    titulo: 'Estado',
    celda: (c) => (
      <Pastilla
        texto={c.estado === 'abierta' ? 'Abierta' : 'Cerrada'}
        tono={c.estado === 'abierta' ? 'info' : 'neutro'}
      />
    ),
  },
];

const COLUMNAS_MOVIMIENTOS_CAJA: readonly Columna<CajaMovimientoVista>[] = [
  { clave: 'fecha', titulo: 'Fecha', celda: (m) => formatearFechaHora(m.fecha), numerica: true },
  { clave: 'concepto', titulo: 'Concepto', celda: (m) => m.concepto },
  {
    clave: 'tipo',
    titulo: 'Tipo',
    celda: (m) => (
      <Pastilla
        texto={m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}
        tono={m.tipo === 'ingreso' ? 'positivo' : 'peligro'}
      />
    ),
  },
  {
    clave: 'monto',
    titulo: 'Monto',
    numerica: true,
    celda: (m) => (
      <span className={m.tipo === 'ingreso' ? 'text-menta-700' : 'text-peligro-600'}>
        {formatearMonedaConSigno(m.tipo === 'ingreso' ? m.monto : -m.monto)}
      </span>
    ),
  },
  { clave: 'usuario', titulo: 'Usuario', celda: (m) => formatearTexto(m.usuario) },
];

function MovimientosDeCaja({ cajaId }: { readonly cajaId: number }): JSX.Element {
  const estado = usarRecurso(() => obtenerMovimientosCaja(cajaId), [cajaId]);

  return (
    <Vista
      estado={estado}
      que="los movimientos de la caja"
      tituloVacio="Caja sin movimientos"
      detalleVacio="Esta caja se abrio pero todavia no registro ingresos ni egresos."
    >
      {(filas) => (
        <Tabla columnas={COLUMNAS_MOVIMIENTOS_CAJA} filas={filas} claveDeFila={(m) => m.id} />
      )}
    </Vista>
  );
}

export function PantallaCaja(): JSX.Element {
  const estado = usarRecurso(() => obtenerCajas(), []);
  const [cajaSeleccionada, setCajaSeleccionada] = useState<number | null>(null);
  const [modal, setModal] = useState<'abrir' | 'movimiento' | 'cerrar' | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);

  usarEventos('caja:cambio', estado.recargar);

  const abierta = estado.datos?.find((c) => c.estado === 'abierta');
  // Teorico de la caja abierta: apertura mas lo que entro, menos lo que salio.
  const teorico =
    abierta === undefined ? 0 : abierta.montoApertura + abierta.totalIngresos - abierta.totalEgresos;

  const cerrar = (mensaje: string): void => {
    setModal(null);
    estado.recargar();
    setAviso({ tono: 'ok', texto: mensaje });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          {abierta === undefined
            ? 'No hay caja abierta: las ventas de contado no van a entrar a ninguna caja.'
            : `Caja #${abierta.id} abierta · saldo teorico ${formatearMoneda(teorico)}`}
        </p>
        <div className="flex shrink-0 gap-2">
          {abierta === undefined ? (
            <BotonPrimario onClick={() => setModal('abrir')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Abrir caja
            </BotonPrimario>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setModal('movimiento')}
                className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
              >
                Movimiento
              </button>
              <BotonPrimario onClick={() => setModal('cerrar')}>Cerrar caja</BotonPrimario>
            </>
          )}
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="las cajas"
        tituloVacio="Sin cajas"
        detalleVacio="Todavia no se abrio ninguna caja. Carga los datos de demostracion para ver una caja cerrada con su arqueo y una caja abierta."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => (
          <>
            <p className="text-xs text-masa-700">Selecciona una caja para ver sus movimientos.</p>
            <Tabla
              columnas={COLUMNAS_CAJAS}
              filas={filas}
              claveDeFila={(c) => c.id}
              alSeleccionar={(c) => setCajaSeleccionada(c.id === cajaSeleccionada ? null : c.id)}
              filaSeleccionada={(c) => c.id === cajaSeleccionada}
            />
          </>
        )}
      </Vista>

      {cajaSeleccionada !== null && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">
            Movimientos de la caja #{cajaSeleccionada}
          </h2>
          <MovimientosDeCaja cajaId={cajaSeleccionada} />
        </section>
      )}

      {modal === 'abrir' && (
        <FormularioAperturaCaja alCerrar={() => setModal(null)} alGuardar={cerrar} />
      )}
      {modal === 'movimiento' && (
        <FormularioMovimientoCaja alCerrar={() => setModal(null)} alGuardar={cerrar} />
      )}
      {modal === 'cerrar' && abierta !== undefined && (
        <FormularioCierreCaja
          cajaId={abierta.id}
          saldoTeorico={teorico}
          alCerrar={() => setModal(null)}
          alGuardar={cerrar}
        />
      )}
    </div>
  );
}

/* ----------------------------- Cuentas corrientes -------------------------- */

const COLUMNAS_CC: readonly Columna<ResumenCuentaCorriente>[] = [
  {
    clave: 'tipo',
    titulo: 'Tipo',
    celda: (c) => (
      <Pastilla
        texto={c.entidadTipo === 'cliente' ? 'Cliente' : 'Proveedor'}
        tono={c.entidadTipo === 'cliente' ? 'info' : 'neutro'}
      />
    ),
  },
  { clave: 'nombre', titulo: 'Entidad', celda: (c) => c.entidadNombre },
  { clave: 'debe', titulo: 'Debe', celda: (c) => formatearMoneda(c.debe), numerica: true },
  { clave: 'haber', titulo: 'Haber', celda: (c) => formatearMoneda(c.haber), numerica: true },
  {
    clave: 'saldo',
    titulo: 'Saldo',
    numerica: true,
    celda: (c) => (
      <span className={c.saldo < 0 ? 'text-peligro-600' : 'text-menta-700'}>
        {formatearMonedaConSigno(c.saldo)}
      </span>
    ),
  },
  {
    clave: 'situacion',
    titulo: 'Situacion',
    celda: (c) =>
      c.saldo === 0 ? (
        <Pastilla texto="Al dia" tono="positivo" />
      ) : c.saldo > 0 ? (
        <Pastilla texto="Nos debe" tono="alerta" />
      ) : (
        <Pastilla texto="Le debemos" tono="peligro" />
      ),
  },
  { clave: 'movimientos', titulo: 'Movs.', celda: (c) => c.cantidadMovimientos, numerica: true },
  {
    clave: 'ultimo',
    titulo: 'Ultimo mov.',
    celda: (c) => (c.ultimoMovimiento === null ? '—' : formatearFecha(c.ultimoMovimiento)),
    numerica: true,
  },
];

export function PantallaCuentasCorrientes(): JSX.Element {
  const estado = usarRecurso(() => obtenerCuentasCorrientes(), []);
  const [modal, setModal] = useState<'cliente' | 'proveedor' | null>(null);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'alerta' | 'mal'; texto: string } | null>(null);

  usarEventos('cc:cambio', estado.recargar);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-masa-800">
          Saldo = debe − haber. Positivo: nos deben. Negativo: debemos.
        </p>
        <div className="flex shrink-0 gap-2">
          <BotonPrimario onClick={() => setModal('cliente')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Registrar cobro
          </BotonPrimario>
          <button
            type="button"
            onClick={() => setModal('proveedor')}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Registrar pago
          </button>
        </div>
      </div>

      {aviso !== null && <Aviso tono={aviso.tono} texto={aviso.texto} />}

      <Vista
        estado={estado}
        que="las cuentas corrientes"
        tituloVacio="Sin movimientos de cuenta corriente"
        detalleVacio="Nadie tiene saldo pendiente."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => (
          <Tabla
            columnas={COLUMNAS_CC}
            filas={filas}
            claveDeFila={(c) => `${c.entidadTipo}-${c.entidadId}`}
          />
        )}
      </Vista>

      {modal !== null && (
        <FormularioCobroPago
          entidadTipo={modal}
          alCerrar={() => setModal(null)}
          alGuardar={(mensaje, advertencias) => {
            setModal(null);
            estado.recargar();
            setAviso(
              advertencias.length > 0
                ? { tono: 'alerta', texto: `${mensaje} ${advertencias.join(' ')}` }
                : { tono: 'ok', texto: mensaje },
            );
          }}
        />
      )}
    </div>
  );
}
