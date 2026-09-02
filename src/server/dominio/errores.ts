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
  | 'ERROR_DATOS'
  | 'ERROR_ARCA';

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

/**
 * Fallo tecnico al acceder a la base (500).
 *
 * El detalle del driver NO viaja al cliente. Decia envolverlo "para no filtrar
 * SQL crudo", pero pasaba `causa.message` como detalles, que es exactamente el
 * mensaje de SQLite: nombres de tablas y columnas, constraints, a veces la ruta
 * del archivo. Eso se serializaba en la respuesta y salia tambien por el tunel,
 * o sea a internet. Ahora queda en `causaTecnica`, que el manejador de errores
 * escribe en el log del servidor y nunca manda en el cuerpo.
 */
export class ErrorDatos extends ErrorDominio {
  readonly causaTecnica: string | undefined;

  constructor(mensaje: string, causa?: unknown) {
    super('ERROR_DATOS', mensaje);
    this.causaTecnica =
      causa instanceof Error ? causa.message : causa === undefined ? undefined : String(causa);
  }
}

/**
 * ARCA rechazo la operacion o no esta disponible (502). Va aparte de las reglas
 * de negocio porque el motivo es de un tercero: el mensaje viene de ARCA y hay
 * que mostrarlo TAL CUAL al operador, que es quien puede resolverlo (certificado
 * vencido, punto de venta sin habilitar, CUIT mal cargado).
 */
export class ErrorArcaDominio extends ErrorDominio {
  constructor(mensaje: string, detalles?: unknown) {
    super('ERROR_ARCA', mensaje, detalles);
  }
}

/** Mapeo unico dominio -> HTTP, usado por el manejador de errores de Fastify. */
export const ESTADO_HTTP_POR_CODIGO: Readonly<Record<CodigoErrorDominio, number>> = {
  ENTIDAD_NO_ENCONTRADA: 404,
  VALIDACION: 400,
  REGLA_NEGOCIO: 422,
  CONFLICTO: 409,
  ERROR_DATOS: 500,
  ERROR_ARCA: 502,
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
