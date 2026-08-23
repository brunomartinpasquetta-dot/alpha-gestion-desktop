/**
 * Caja General: la caja fuerte del negocio.
 *
 * Copiado del modulo de StockFlow, con dos correcciones propias:
 *  - Dinero en CENTAVOS enteros (StockFlow guarda decimales como texto y
 *    compara con tolerancias de medio centavo; aca las comparaciones son
 *    exactas y no hay redondeo que acumule).
 *  - Los CHEQUES se muestran como tercer bloque, leidos de la cartera. En
 *    StockFlow un cheque cae en "electronico" y se mezcla con lo cobrado de
 *    verdad; un cheque en cartera todavia NO es plata, y verlo aparte es lo
 *    que evita creer que hay saldo que no existe.
 *
 * Reglas que se mantienen del original:
 *  - Libro APPEND-ONLY: no se edita ni se borra un movimiento.
 *  - Cada fila guarda el saldo DESPUES (total, efectivo, electronico), asi el
 *    resumen de un periodo sale por diferencia y no sumando etiquetas.
 *  - El total se lleva aparte de las dos columnas: si el desglose se
 *    desincroniza, el numero que el duenio mira todos los dias no se ensucia.
 */

import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';

import { obtenerDb } from '../db/conexion';
import {
  cajaGeneral,
  cajaGeneralMovimientos,
  type CategoriaCajaGeneral,
  type TipoMovimientoCajaGeneral,
} from '../db/schema';
import { ejecutarSeguro, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { chequesServicio } from './cheques.servicio';

const ID_SINGLETON = 1;

export interface SaldosCajaGeneral {
  total: number;
  efectivo: number;
  electronico: number;
  /** Cartera de cheques: NO es plata disponible, se informa al lado. */
  chequesEnCartera: number;
  cantidadCheques: number;
}

export interface MovimientoCajaGeneralVista {
  id: number;
  fecha: string;
  tipo: TipoMovimientoCajaGeneral;
  monto: number;
  concepto: string;
  categoria: CategoriaCajaGeneral | null;
  esEfectivo: boolean;
  saldoTotalDespues: number;
  saldoEfectivoDespues: number;
  saldoElectronicoDespues: number;
  documentoTipo: string | null;
  documentoId: number | null;
  usuario: string | null;
}

export interface EntradaMovimientoCajaGeneral {
  tipo: TipoMovimientoCajaGeneral;
  monto: number;
  concepto: string;
  categoria?: CategoriaCajaGeneral | null;
  esEfectivo?: boolean;
  documentoTipo?: string | null;
  documentoId?: number | null;
  usuario?: string | null;
}

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

function filaSingleton(tx: Tx): { saldoTotal: number; saldoEfectivo: number; saldoElectronico: number } {
  const fila = tx.select().from(cajaGeneral).where(eq(cajaGeneral.id, ID_SINGLETON)).get();
  if (fila) return fila;
  tx.insert(cajaGeneral)
    .values({ id: ID_SINGLETON, saldoTotal: 0, saldoEfectivo: 0, saldoElectronico: 0 })
    .run();
  return { saldoTotal: 0, saldoEfectivo: 0, saldoElectronico: 0 };
}

/**
 * UNICO camino por el que se mueve la caja general. Todo lo que la toque
 * (alta manual, deposito de cierre, compra pagada desde la caja fuerte) tiene
 * que pasar por aca: en StockFlow la compra escribia por su cuenta y quedo un
 * agujero (la anulacion no revertia el egreso).
 */
export function aplicarMovimientoCajaGeneral(
  tx: Tx,
  entrada: EntradaMovimientoCajaGeneral,
): MovimientoCajaGeneralVista {
  const monto = Math.round(entrada.monto);
  if (!Number.isFinite(monto) || monto <= 0) {
    throw new ErrorValidacion('El monto tiene que ser mayor a cero.');
  }
  const concepto = entrada.concepto.trim();
  if (concepto === '') throw new ErrorValidacion('El concepto es obligatorio.');

  const previo = filaSingleton(tx);
  const esEfectivo = entrada.esEfectivo ?? true;
  const suma = entrada.tipo !== 'egreso';
  const signo = suma ? 1 : -1;

  const saldoEfectivoDespues = previo.saldoEfectivo + (esEfectivo ? signo * monto : 0);
  const saldoElectronicoDespues = previo.saldoElectronico + (esEfectivo ? 0 : signo * monto);
  const saldoTotalDespues = previo.saldoTotal + signo * monto;

  const fila = tx
    .insert(cajaGeneralMovimientos)
    .values({
      tipo: entrada.tipo,
      monto,
      concepto,
      categoria: entrada.categoria ?? null,
      esEfectivo,
      saldoTotalDespues,
      saldoEfectivoDespues,
      saldoElectronicoDespues,
      documentoTipo: entrada.documentoTipo ?? null,
      documentoId: entrada.documentoId ?? null,
      usuario: entrada.usuario?.trim() || null,
    })
    .returning()
    .all()[0]!;

  tx.update(cajaGeneral)
    .set({
      saldoTotal: saldoTotalDespues,
      saldoEfectivo: saldoEfectivoDespues,
      saldoElectronico: saldoElectronicoDespues,
      actualizadoEn: new Date().toISOString(),
    })
    .where(eq(cajaGeneral.id, ID_SINGLETON))
    .run();

  return fila as MovimientoCajaGeneralVista;
}

export const cajaGeneralServicio = {
  saldos(): SaldosCajaGeneral {
    return ejecutarSeguro('leer los saldos de la caja general', () => {
      const fila = obtenerDb().select().from(cajaGeneral).where(eq(cajaGeneral.id, ID_SINGLETON)).get();
      const cartera = chequesServicio.resumenCartera();
      return {
        total: fila?.saldoTotal ?? 0,
        efectivo: fila?.saldoEfectivo ?? 0,
        electronico: fila?.saldoElectronico ?? 0,
        chequesEnCartera: cartera.importeEnCartera,
        cantidadCheques: cartera.enCartera,
      };
    });
  },

  listarMovimientos(filtro: {
    desde?: string;
    hasta?: string;
    tipo?: TipoMovimientoCajaGeneral;
    medio?: 'efectivo' | 'electronico';
    limite?: number;
  } = {}): MovimientoCajaGeneralVista[] {
    return ejecutarSeguro('listar los movimientos de la caja general', () => {
      const condiciones = [];
      if (filtro.desde !== undefined && filtro.desde !== '') {
        condiciones.push(gte(cajaGeneralMovimientos.fecha, `${filtro.desde}T00:00:00.000Z`));
      }
      if (filtro.hasta !== undefined && filtro.hasta !== '') {
        condiciones.push(lte(cajaGeneralMovimientos.fecha, `${filtro.hasta}T23:59:59.999Z`));
      }
      if (filtro.tipo !== undefined) condiciones.push(eq(cajaGeneralMovimientos.tipo, filtro.tipo));
      if (filtro.medio !== undefined) {
        condiciones.push(eq(cajaGeneralMovimientos.esEfectivo, filtro.medio === 'efectivo'));
      }
      const consulta = obtenerDb().select().from(cajaGeneralMovimientos).$dynamic();
      const conFiltro =
        condiciones.length === 0
          ? consulta
          : consulta.where(condiciones.length === 1 ? condiciones[0] : and(...condiciones));
      return conFiltro
        .orderBy(desc(cajaGeneralMovimientos.fecha), desc(cajaGeneralMovimientos.id))
        .limit(Math.min(filtro.limite ?? 500, 2000))
        .all() as MovimientoCajaGeneralVista[];
    });
  },

  /** Alta manual (ingreso o egreso). El egreso puede dejar saldo negativo: se avisa, no se bloquea. */
  registrar(entrada: EntradaMovimientoCajaGeneral): MovimientoCajaGeneralVista {
    const resultado = ejecutarSeguro('registrar un movimiento de la caja general', () =>
      obtenerDb().transaction((tx) => aplicarMovimientoCajaGeneral(tx, entrada)),
    );
    emitir('caja:cambio');
    return resultado;
  },

  /**
   * Reconstruye los tres saldos desde el libro. Es la red de seguridad para el
   * dia que un desglose quede torcido: el libro es la verdad.
   */
  recalcular(): SaldosCajaGeneral {
    ejecutarSeguro('recalcular la caja general', () =>
      obtenerDb().transaction((tx) => {
        const totales = tx
          .select({
            total: sql<number>`COALESCE(SUM(CASE WHEN ${cajaGeneralMovimientos.tipo} = 'egreso' THEN -${cajaGeneralMovimientos.monto} ELSE ${cajaGeneralMovimientos.monto} END), 0)`.mapWith(Number),
            efectivo: sql<number>`COALESCE(SUM(CASE WHEN ${cajaGeneralMovimientos.esEfectivo} = 1 THEN (CASE WHEN ${cajaGeneralMovimientos.tipo} = 'egreso' THEN -${cajaGeneralMovimientos.monto} ELSE ${cajaGeneralMovimientos.monto} END) ELSE 0 END), 0)`.mapWith(Number),
          })
          .from(cajaGeneralMovimientos)
          .get() ?? { total: 0, efectivo: 0 };
        filaSingleton(tx);
        tx.update(cajaGeneral)
          .set({
            saldoTotal: totales.total,
            saldoEfectivo: totales.efectivo,
            saldoElectronico: totales.total - totales.efectivo,
            actualizadoEn: new Date().toISOString(),
          })
          .where(eq(cajaGeneral.id, ID_SINGLETON))
          .run();
        return true;
      }),
    );
    emitir('caja:cambio');
    return cajaGeneralServicio.saldos();
  },
};
