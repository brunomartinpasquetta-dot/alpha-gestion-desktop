/**
 * Servicio fiscal: configuracion ARCA y emision de comprobantes con CAE.
 *
 * REGLA DE ORO (heredada de StockFlow): el CAE se pide ANTES de persistir nada.
 * Si ARCA rechaza, la venta no existe y no se consumio numeracion. Solo los
 * comprobantes APROBADOS tocan la base.
 */

import path from 'node:path';
import { eq } from 'drizzle-orm';

import type {
  ConfiguracionFiscalVista,
  EntradaConfiguracionFiscal,
  ResultadoPruebaArca,
  TipoComprobante,
} from '../../compartido/contratos';
import { obtenerDb, obtenerRutaDb } from '../db/conexion';
import { configuracionFiscal, type ConfiguracionFiscal } from '../db/schema';
import { ErrorArcaDominio, ErrorReglaNegocio } from '../dominio/errores';
import { ClienteWsaa } from '../fiscal/wsaa';
import { armarUrlQr, ClienteWsfe, ENDPOINTS_ARCA, ErrorArca, type ResultadoCae } from '../fiscal/wsfe';

const ID_UNICA = 'unica';

/** Codigos ARCA de tipo de comprobante. */
export const CODIGOS_COMPROBANTE = { factura_a: 1, factura_b: 6 } as const;

/** Alicuota 21% en la tabla de ARCA. */
const ALICUOTA_21 = 5;

/** Carpeta de cache del TA, al lado de la base (userData/arca en produccion). */
function carpetaCacheArca(): string {
  return path.join(path.dirname(obtenerRutaDb()), 'arca');
}

function aVista(fila: ConfiguracionFiscal): ConfiguracionFiscalVista {
  return {
    entorno: fila.entorno,
    cuit: fila.cuit,
    razonSocial: fila.razonSocial,
    direccion: fila.direccion,
    condicionIva: fila.condicionIva,
    iibb: fila.iibb,
    rutaCertificado: fila.rutaCertificado,
    rutaClave: fila.rutaClave,
    puntoVenta: fila.puntoVenta,
    habilitada: fila.habilitada,
  };
}

/** Fila singleton, creandola con valores por defecto la primera vez. */
function obtenerFila(): ConfiguracionFiscal {
  const db = obtenerDb();
  const existente = db.select().from(configuracionFiscal).where(eq(configuracionFiscal.id, ID_UNICA)).get();
  if (existente) return existente;
  return db.insert(configuracionFiscal).values({ id: ID_UNICA }).returning().all()[0]!;
}

export interface DatosComprobanteAprobado {
  codigoArca: number;
  letra: 'A' | 'B';
  puntoVenta: number;
  numero: number;
  fecha: string;
  docTipo: number;
  docNumero: string;
  receptorNombre: string;
  neto: number;
  iva: number;
  total: number;
  cae: string;
  caeVencimiento: string | null;
  observaciones: string | null;
  urlQr: string;
}

export const fiscalServicio = {
  obtenerConfig(): ConfiguracionFiscalVista {
    return aVista(obtenerFila());
  },

  guardarConfig(entrada: EntradaConfiguracionFiscal): ConfiguracionFiscalVista {
    obtenerFila();
    const habilitada =
      entrada.habilitada &&
      entrada.cuit.replace(/\D/g, '').length === 11 &&
      Boolean(entrada.rutaCertificado?.trim()) &&
      Boolean(entrada.rutaClave?.trim());
    const db = obtenerDb();
    db.update(configuracionFiscal)
      .set({
        entorno: entrada.entorno,
        cuit: entrada.cuit.replace(/\D/g, ''),
        razonSocial: entrada.razonSocial?.trim() || null,
        direccion: entrada.direccion?.trim() || null,
        condicionIva: entrada.condicionIva,
        iibb: entrada.iibb?.trim() || null,
        rutaCertificado: entrada.rutaCertificado?.trim() || null,
        rutaClave: entrada.rutaClave?.trim() || null,
        puntoVenta: entrada.puntoVenta,
        habilitada,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(configuracionFiscal.id, ID_UNICA))
      .run();
    return aVista(obtenerFila());
  },

  /**
   * Prueba la conexion en dos niveles: FEDummy (sin certificado, mide que los
   * servidores de ARCA respondan) y, si hay certificado cargado, autenticacion
   * WSAA + consulta del ultimo comprobante autorizado.
   */
  async probarConexion(): Promise<ResultadoPruebaArca> {
    const config = obtenerFila();
    const urls = ENDPOINTS_ARCA[config.entorno];
    const resultado: ResultadoPruebaArca = {
      entorno: config.entorno,
      servidores: null,
      autenticacion: null,
      ultimoNumero: null,
      errores: [],
    };

    try {
      const dummy = await ClienteWsfe.dummy(urls.wsfe);
      resultado.servidores = `app=${dummy.app} db=${dummy.db} auth=${dummy.auth}`;
    } catch (error) {
      resultado.errores.push(
        `Servidores ARCA: ${error instanceof Error ? error.message : String(error)}`,
      );
      return resultado;
    }

    if (!config.rutaCertificado || !config.rutaClave || config.cuit.length !== 11) {
      resultado.errores.push(
        'Falta cargar CUIT, certificado y clave privada para probar la autenticacion.',
      );
      return resultado;
    }

    try {
      const wsaa = new ClienteWsaa({
        rutaCertificado: config.rutaCertificado,
        rutaClave: config.rutaClave,
        urlWsaa: urls.wsaa,
        carpetaCache: carpetaCacheArca(),
        cuit: config.cuit,
      });
      const ta = await wsaa.obtenerTicket();
      resultado.autenticacion = `Ticket valido hasta ${new Date(ta.venceEn).toLocaleString('es-AR')}`;
      const wsfe = ClienteWsfe.desdeTicket(urls.wsfe, ta, config.cuit);
      resultado.ultimoNumero = await wsfe.ultimoAutorizado(
        config.puntoVenta,
        CODIGOS_COMPROBANTE.factura_b,
      );
    } catch (error) {
      resultado.errores.push(error instanceof Error ? error.message : String(error));
    }

    return resultado;
  },

  /**
   * Pide el CAE a ARCA para una venta que TODAVIA no se persistio. El llamador
   * (ventas.servicio) inserta el comprobante devuelto dentro de su transaccion.
   * Los importes entran en CENTAVOS; a ARCA viajan en pesos con 2 decimales.
   */
  async emitirComprobante(datos: {
    tipo: Exclude<TipoComprobante, 'remito'>;
    totalCentavos: number;
    receptor: { nombre: string; cuit: string | null };
  }): Promise<DatosComprobanteAprobado> {
    const config = obtenerFila();
    if (!config.habilitada || !config.rutaCertificado || !config.rutaClave) {
      throw new ErrorReglaNegocio(
        'La facturacion electronica no esta configurada: carga el certificado ARCA en Gestion > Facturacion.',
      );
    }

    const codigoArca = CODIGOS_COMPROBANTE[datos.tipo];
    const letra = datos.tipo === 'factura_a' ? 'A' : 'B';
    const cuitReceptor = datos.receptor.cuit?.replace(/\D/g, '') ?? '';

    if (datos.tipo === 'factura_a' && cuitReceptor.length !== 11) {
      throw new ErrorReglaNegocio(
        'Una Factura A exige un cliente con CUIT valido (11 digitos). Completa el CUIT del cliente o emiti Factura B.',
      );
    }
    // Factura B: con CUIT se informa; sin CUIT va como consumidor final (99/0).
    const docTipo = cuitReceptor.length === 11 ? 80 : 99;
    const docNumero = cuitReceptor.length === 11 ? cuitReceptor : '0';

    // Precios de venta son FINALES (IVA incluido): neto = total / 1.21.
    const netoCentavos = Math.round(datos.totalCentavos / 1.21);
    const ivaCentavos = datos.totalCentavos - netoCentavos;
    const neto = netoCentavos / 100;
    const iva = ivaCentavos / 100;
    const total = datos.totalCentavos / 100;

    const urls = ENDPOINTS_ARCA[config.entorno];
    const wsaa = new ClienteWsaa({
      rutaCertificado: config.rutaCertificado,
      rutaClave: config.rutaClave,
      urlWsaa: urls.wsaa,
      carpetaCache: carpetaCacheArca(),
      cuit: config.cuit,
    });
    // Todo lo que venga de ARCA se traduce a un error de dominio: el operador
    // tiene que leer el motivo real, no un "error interno" del servidor.
    const ahora = new Date();
    let aprobado: ResultadoCae;
    try {
      const ta = await wsaa.obtenerTicket();
      const wsfe = ClienteWsfe.desdeTicket(urls.wsfe, ta, config.cuit);
      aprobado = await wsfe.solicitarCae({
        puntoVenta: config.puntoVenta,
        codigoComprobante: codigoArca,
        fecha: ahora,
        docTipo,
        docNumero,
        neto,
        iva,
        total,
        detallesIva: [{ id: ALICUOTA_21, base: neto, importe: iva }],
      });
    } catch (error) {
      const detalle = error instanceof Error ? error.message : String(error);
      throw new ErrorArcaDominio(
        `No se pudo emitir la ${datos.tipo === 'factura_a' ? 'Factura A' : 'Factura B'}: ${detalle}`,
        error instanceof ErrorArca ? error.detalles : undefined,
      );
    }

    const fechaArca = `${ahora.getFullYear()}${String(ahora.getMonth() + 1).padStart(2, '0')}${String(ahora.getDate()).padStart(2, '0')}`;
    const urlQr = armarUrlQr({
      cuit: config.cuit,
      puntoVenta: config.puntoVenta,
      codigoComprobante: codigoArca,
      numero: aprobado.numero,
      importe: total,
      docTipo,
      docNumero,
      cae: aprobado.cae,
      fecha: fechaArca,
    });

    return {
      codigoArca,
      letra,
      puntoVenta: config.puntoVenta,
      numero: aprobado.numero,
      fecha: ahora.toISOString(),
      docTipo,
      docNumero,
      receptorNombre: datos.receptor.nombre,
      neto: netoCentavos,
      iva: ivaCentavos,
      total: datos.totalCentavos,
      cae: aprobado.cae,
      caeVencimiento: aprobado.caeVencimiento || null,
      observaciones: aprobado.observaciones.length > 0 ? aprobado.observaciones.join(' | ') : null,
      urlQr,
    };
  },
};
