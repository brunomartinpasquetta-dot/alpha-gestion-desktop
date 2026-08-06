/**
 * WSAA — autenticacion contra ARCA.
 *
 * Flujo: TRA (XML) -> firma CMS/PKCS#7 -> LoginCms (SOAP) -> TA con token+sign
 * validos 12 horas. El TA se CACHEA en disco: ARCA rechaza pedir uno nuevo
 * mientras el anterior siga vigente ("El CEE ya posee un TA valido"); sin cache,
 * el segundo login del dia falla.
 *
 * La firma la hace `firma.ts` con node-forge, no el openssl del sistema: ver el
 * comentario de ese modulo para el porque (resumen: Windows no trae openssl).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { firmarTraCms, leerMaterialFirma } from './firma';
import { postearSoap } from './transporte';

export interface TicketAcceso {
  token: string;
  sign: string;
  /** Vencimiento en epoch ms. */
  venceEn: number;
}

export interface OpcionesWsaa {
  rutaCertificado: string;
  rutaClave: string;
  urlWsaa: string;
  /** Carpeta de cache del TA (userData/arca). */
  carpetaCache: string;
  cuit: string;
}

export function escaparXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Extrae el contenido de un tag simple. Suficiente para las respuestas de ARCA. */
export function extraerTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  return m?.[1]?.trim() ?? null;
}

/**
 * TRA: la ventana arranca 10 minutos ANTES de ahora para tolerar relojes
 * desfasados — la hora atrasada del cliente es causa tipica de rechazo.
 */
export function armarTra(servicio: string, ahora: Date = new Date()): string {
  const unico = Math.floor(ahora.getTime() / 1000);
  const desde = new Date(ahora.getTime() - 10 * 60 * 1000);
  const hasta = new Date(ahora.getTime() + 12 * 60 * 60 * 1000);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<loginTicketRequest version="1.0">',
    '<header>',
    `<uniqueId>${unico}</uniqueId>`,
    `<generationTime>${desde.toISOString()}</generationTime>`,
    `<expirationTime>${hasta.toISOString()}</expirationTime>`,
    '</header>',
    `<service>${escaparXml(servicio)}</service>`,
    '</loginTicketRequest>',
  ].join('');
}

export function armarSoapLogin(cmsBase64: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">',
    '<soapenv:Header/>',
    '<soapenv:Body>',
    '<wsaa:loginCms>',
    `<wsaa:in0>${cmsBase64}</wsaa:in0>`,
    '</wsaa:loginCms>',
    '</soapenv:Body>',
    '</soapenv:Envelope>',
  ].join('');
}

/** El TA viene escapado dentro del SOAP: se desescapa y se parsea. */
export function parsearTicket(respuestaSoap: string): TicketAcceso {
  const interno = extraerTag(respuestaSoap, 'loginCmsReturn');
  if (!interno) {
    const falla = extraerTag(respuestaSoap, 'faultstring');
    throw new Error(falla ? `ARCA rechazo la autenticacion: ${falla}` : 'Respuesta de ARCA invalida');
  }
  const xml = interno
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
  const token = extraerTag(xml, 'token');
  const sign = extraerTag(xml, 'sign');
  const vencimiento = extraerTag(xml, 'expirationTime');
  if (!token || !sign) throw new Error('El ticket de ARCA no trae token/sign');
  return {
    token,
    sign,
    venceEn: vencimiento ? new Date(vencimiento).getTime() : Date.now() + 12 * 60 * 60 * 1000,
  };
}

export class ClienteWsaa {
  constructor(private readonly opciones: OpcionesWsaa) {}

  private get archivoCache(): string {
    const cuit = this.opciones.cuit.replace(/\D/g, '');
    return path.join(this.opciones.carpetaCache, `ta-wsfe-${cuit}.json`);
  }

  /** TA cacheado si sigue valido, con 5 minutos de margen. */
  private leerCache(): TicketAcceso | null {
    try {
      if (!existsSync(this.archivoCache)) return null;
      const crudo = JSON.parse(readFileSync(this.archivoCache, 'utf8')) as TicketAcceso;
      if (!crudo?.token || !crudo?.sign) return null;
      if (crudo.venceEn - 5 * 60 * 1000 <= Date.now()) return null;
      return crudo;
    } catch {
      return null;
    }
  }

  private escribirCache(ta: TicketAcceso): void {
    try {
      mkdirSync(this.opciones.carpetaCache, { recursive: true });
      writeFileSync(this.archivoCache, JSON.stringify(ta), 'utf8');
    } catch {
      // Sin cache seguimos: solo se pierde la optimizacion.
    }
  }

  /** Firma el TRA en CMS/PKCS#7 (DER, base64). Sincrona: no hay proceso externo. */
  firmarTra(tra: string): string {
    const material = leerMaterialFirma(this.opciones.rutaCertificado, this.opciones.rutaClave);
    return firmarTraCms(tra, material);
  }

  /** TA valido: el cacheado si sigue vigente, o uno nuevo contra ARCA. */
  async obtenerTicket(forzar = false): Promise<TicketAcceso> {
    if (!forzar) {
      const cacheado = this.leerCache();
      if (cacheado) return cacheado;
    }
    if (!existsSync(this.opciones.rutaCertificado)) {
      throw new Error(`No se encuentra el certificado en ${this.opciones.rutaCertificado}`);
    }
    if (!existsSync(this.opciones.rutaClave)) {
      throw new Error(`No se encuentra la clave privada en ${this.opciones.rutaClave}`);
    }

    const tra = armarTra('wsfe');
    const cms = this.firmarTra(tra);
    const soap = armarSoapLogin(cms);

    const { estado, cuerpo: texto } = await postearSoap(this.opciones.urlWsaa, '', soap);
    if (estado >= 400 && !texto.includes('loginCmsReturn')) {
      const falla = extraerTag(texto, 'faultstring');
      throw new Error(falla ?? `ARCA respondio ${estado} al autenticar`);
    }
    const ta = parsearTicket(texto);
    this.escribirCache(ta);
    return ta;
  }
}
