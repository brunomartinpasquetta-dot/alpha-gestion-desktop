/**
 * Servicio de cuentas corrientes: reglas de negocio del ledger de terceros.
 *
 * Un unico ledger sirve a clientes y proveedores porque la mecanica contable es
 * la misma: cada asiento es un `debe` o un `haber` con monto SIEMPRE positivo, y
 * el saldo es `SUM(debe) - SUM(haber)`. El signo nunca viaja en el monto; lo da
 * `tipoMovimiento`. Asi un monto negativo es siempre un error de datos y no una
 * ambiguedad de interpretacion.
 *
 * Lectura del saldo: positivo = la entidad nos debe (cliente) o nosotros
 * registramos deuda a favor (proveedor, segun el documento). Negativo = saldo a
 * favor de la entidad.
 */

import type { CuentaCorriente, NuevaCuentaCorriente } from '../db/schema';
import {
  TIPOS_DOCUMENTO_CC,
  TIPOS_ENTIDAD_CC,
  TIPOS_MOVIMIENTO_CC,
  type TipoDocumentoCc,
  type TipoEntidadCc,
  type TipoMovimientoCc,
} from '../db/schema';
import { ErrorNoEncontrado, ErrorValidacion } from '../dominio/errores';
import type { SaldoCuentaCorriente } from '../dominio/tipos';
import * as ccRepositorio from '../repositorios/cuentas-corrientes.repositorio';
import { esCentavosValido } from '../utiles/numeros';

export interface EntradaMovimientoCc {
  entidadTipo: TipoEntidadCc;
  entidadId: number;
  tipoMovimiento: TipoMovimientoCc;
  /** Centavos, siempre positivo. El signo lo da tipoMovimiento. */
  monto: number;
  documentoTipo: TipoDocumentoCc;
  documentoId?: number | null;
  fecha?: string;
  notas?: string | null;
}

/** Valida el tipo de entidad, que ademas decide contra que tabla se chequea la existencia. */
function validarEntidadTipo(entidadTipo: TipoEntidadCc): void {
  if (!TIPOS_ENTIDAD_CC.includes(entidadTipo)) {
    throw new ErrorValidacion(
      `Tipo de entidad de cuenta corriente invalido: "${String(entidadTipo)}". Validos: ${TIPOS_ENTIDAD_CC.join(', ')}.`,
      { entidadTipo },
    );
  }
}

function validarEntidadId(entidadId: number): void {
  if (!Number.isInteger(entidadId) || entidadId <= 0) {
    throw new ErrorValidacion('El identificador de la entidad debe ser un entero positivo.', {
      entidadId,
    });
  }
}

/**
 * La tabla es polimorfica y no tiene FK fisica, asi que la existencia de la
 * entidad se verifica acá o no se verifica en ningun lado.
 */
function asegurarEntidad(entidadTipo: TipoEntidadCc, entidadId: number): void {
  validarEntidadTipo(entidadTipo);
  validarEntidadId(entidadId);
  if (!ccRepositorio.existeEntidad(entidadTipo, entidadId)) {
    throw new ErrorNoEncontrado(entidadTipo, entidadId);
  }
}

/** Asienta un movimiento en la cuenta corriente de un cliente o proveedor. */
function registrarMovimiento(entrada: EntradaMovimientoCc): CuentaCorriente {
  const { entidadTipo, entidadId, tipoMovimiento, monto, documentoTipo } = entrada;

  asegurarEntidad(entidadTipo, entidadId);

  if (!TIPOS_MOVIMIENTO_CC.includes(tipoMovimiento)) {
    throw new ErrorValidacion(
      `Tipo de movimiento de cuenta corriente invalido: "${String(tipoMovimiento)}". Validos: ${TIPOS_MOVIMIENTO_CC.join(', ')}.`,
      { tipoMovimiento },
    );
  }
  if (!TIPOS_DOCUMENTO_CC.includes(documentoTipo)) {
    throw new ErrorValidacion(
      `Tipo de documento de cuenta corriente invalido: "${String(documentoTipo)}". Validos: ${TIPOS_DOCUMENTO_CC.join(', ')}.`,
      { documentoTipo },
    );
  }
  // Dinero en centavos enteros: un monto con decimales seria plata en punto flotante.
  if (!esCentavosValido(monto)) {
    throw new ErrorValidacion(
      'El monto debe ser un entero de centavos mayor o igual a cero; el signo lo determina el tipo de movimiento.',
      { monto },
    );
  }
  const documentoId = entrada.documentoId ?? null;
  if (documentoId !== null && !Number.isInteger(documentoId)) {
    throw new ErrorValidacion('El identificador del documento debe ser un entero o null.', {
      documentoId,
    });
  }

  const valores: NuevaCuentaCorriente = {
    entidadTipo,
    entidadId,
    tipoMovimiento,
    monto,
    documentoTipo,
    documentoId,
    // `undefined` deja que SQLite aplique el default (timestamp actual).
    fecha: entrada.fecha,
    notas: entrada.notas ?? null,
  };

  return ccRepositorio.insertar(valores);
}

/**
 * Saldo de la entidad, agregado en una sola consulta SQL.
 *
 * Una entidad existente sin movimientos tiene saldo cero: es informacion valida,
 * no un error. Por eso se exige que la entidad exista pero no que tenga ledger.
 */
function saldoEntidad(entidadTipo: TipoEntidadCc, entidadId: number): SaldoCuentaCorriente {
  asegurarEntidad(entidadTipo, entidadId);
  const { debe, haber } = ccRepositorio.agregarSaldo(entidadTipo, entidadId);
  return { entidadTipo, entidadId, debe, haber, saldo: debe - haber };
}

export const ccServicio = {
  registrarMovimiento,
  saldoEntidad,
};
