/**
 * Errores de dominio. Son agnosticos de Fastify y de Drizzle: la capa HTTP los
 * traduce a codigos de estado, la capa de datos los produce. Asi el dominio no
 * conoce el transporte.
 */

export type CodigoErrorDominio =
  | 'ENTIDAD_NO_ENCONTRADA'
  | 'VALIDACION'
  | 'REGLA_NEGOCIO'
  | 'CONFLICTO'
  | 'ERROR_DATOS';

export class ErrorDominio extends Error {
  readonly codigo: CodigoErrorDominio;
  readonly detalles: unknown;

  constructor(codigo: CodigoErrorDominio, mensaje: string, detalles?: unknown) {
    super(mensaje);
    this.name = new.target.name;
    this.codigo = codigo;
    this.detalles = detalles;
    Error.captureStackTrace?.(this, new.target);
  }
}

/** La entidad pedida no existe (404). */
export class ErrorNoEncontrado extends ErrorDominio {
  constructor(entidad: string, identificador: string | number) {
    super('ENTIDAD_NO_ENCONTRADA', `No se encontro ${entidad} con identificador ${identificador}.`, {
      entidad,
      identificador,
    });
  }
}

/** Input invalido segun el dominio, mas alla del esquema (400). */
export class ErrorValidacion extends ErrorDominio {
  constructor(mensaje: string, detalles?: unknown) {
    super('VALIDACION', mensaje, detalles);
  }
}

/** Una regla de negocio impide la operacion (422). */
export class ErrorReglaNegocio extends ErrorDominio {
  constructor(mensaje: string, detalles?: unknown) {
    super('REGLA_NEGOCIO', mensaje, detalles);
  }
}

/** Conflicto de estado, por ejemplo un codigo duplicado (409). */
export class ErrorConflicto extends ErrorDominio {
  constructor(mensaje: string, detalles?: unknown) {
    super('CONFLICTO', mensaje, detalles);
  }
}

/** Fallo tecnico al acceder a la base (500), envuelto para no filtrar SQL crudo. */
export class ErrorDatos extends ErrorDominio {
  constructor(mensaje: string, causa?: unknown) {
    super('ERROR_DATOS', mensaje, causa instanceof Error ? causa.message : causa);
  }
}

/** Mapeo unico dominio -> HTTP, usado por el manejador de errores de Fastify. */
export const ESTADO_HTTP_POR_CODIGO: Readonly<Record<CodigoErrorDominio, number>> = {
  ENTIDAD_NO_ENCONTRADA: 404,
  VALIDACION: 400,
  REGLA_NEGOCIO: 422,
  CONFLICTO: 409,
  ERROR_DATOS: 500,
};

export function esErrorDominio(error: unknown): error is ErrorDominio {
  return error instanceof ErrorDominio;
}

/**
 * Envuelve una operacion sincrona contra la base para que nunca escape un error
 * crudo de SQLite hacia arriba. Devuelve el valor o lanza un ErrorDatos.
 */
export function ejecutarSeguro<T>(descripcion: string, operacion: () => T): T {
  try {
    return operacion();
  } catch (error) {
    if (esErrorDominio(error)) throw error;
    throw new ErrorDatos(`Fallo la operacion de datos: ${descripcion}.`, error);
  }
}
