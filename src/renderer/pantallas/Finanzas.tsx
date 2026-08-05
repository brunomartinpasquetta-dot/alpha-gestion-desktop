/**
 * Pantallas de finanzas: caja y cuentas corrientes.
 *
 * El saldo de cuenta corriente sale del ledger `cuentas_corrientes`, unico para
 * clientes y proveedores: saldo = debe - haber. Un saldo positivo de cliente
 * significa que nos debe; uno negativo de proveedor, que le debemos.
 */

import { useState } from 'react';

import type { CajaMovimientoVista, CajaVista, ResumenCuentaCorriente } from '../../compartido/contratos';
import { Pastilla } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarRecurso } from '../ganchos/usarRecurso';
import { obtenerCajas, obtenerCuentasCorrientes, obtenerMovimientosCaja } from '../servicios/cliente';
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
    celda: (c) => <span className="text-peligro-700">{formatearMoneda(c.totalEgresos)}</span>,
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
        <span className={c.diferencia < 0 ? 'text-peligro-700' : 'text-menta-700'}>
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
        tono={c.estado === 'abierta' ? 'marca' : 'neutro'}
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
      <span className={m.tipo === 'ingreso' ? 'text-menta-700' : 'text-peligro-700'}>
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

  return (
    <div className="space-y-4">
      <Vista
        estado={estado}
        que="las cajas"
        tituloVacio="Sin cajas"
        detalleVacio="Todavia no se abrio ninguna caja. Carga los datos de demostracion para ver una caja cerrada con su arqueo y una caja abierta."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {(filas) => (
          <>
            <p className="text-xs text-masa-600">Selecciona una caja para ver sus movimientos.</p>
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
          <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-600">
            Movimientos de la caja #{cajaSeleccionada}
          </h2>
          <MovimientosDeCaja cajaId={cajaSeleccionada} />
        </section>
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
        tono={c.entidadTipo === 'cliente' ? 'marca' : 'neutro'}
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
      <span className={c.saldo < 0 ? 'text-peligro-700' : 'text-menta-700'}>
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

  return (
    <Vista
      estado={estado}
      que="las cuentas corrientes"
      tituloVacio="Sin movimientos de cuenta corriente"
      detalleVacio="Nadie tiene saldo pendiente. Carga los datos de demostracion para ver saldos de clientes y proveedores."
      comandoVacio={COMANDO_SEED_DEMO}
    >
      {(filas) => (
        <>
          <p className="mb-2 text-xs text-masa-600">
            Saldo = debe − haber. Positivo significa que la entidad nos debe; negativo, que le
            debemos.
          </p>
          <Tabla
            columnas={COLUMNAS_CC}
            filas={filas}
            claveDeFila={(c) => `${c.entidadTipo}-${c.entidadId}`}
          />
        </>
      )}
    </Vista>
  );
}
