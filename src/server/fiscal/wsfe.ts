/**
 * WSFEv1 — facturacion electronica de ARCA (portado del motor de StockFlow).
 *
 * Operaciones: FEDummy (estado de servidores, sin auth), FECompUltimoAutorizado
 * (ultimo numero por punto de venta y tipo), FECAESolicitar (emision con CAE).
 *
 * CRITICO sobre errores: ARCA distingue `Errors` (rechazo: NO se emitio) de
 * `Observaciones` (SE emitio, el CAE es valido, pero hay avisos). Tratarlas
 * igual pierde comprobantes ya autorizados.
 */

import { postearSoap } from './transporte';
import { extraerTag, type TicketAcceso } from './wsaa';

export interface DetalleIva {
  /** Alicuota ARCA: 3 = 0%, 4 = 10.5%, 5 = 21%, 6 = 27%. */
  id: number;
  /** Base imponible y monto, en PESOS con 2 decimales (lo que ARCA espera). */
  base: number;
  importe: number;
}

export interface PedidoCae {
  puntoVenta: number;
  codigoComprobante: number;
  numero?: number;
  fecha: Date;
  docTipo: number;
  docNumero: string;
  neto: number;
  iva: number;
  total: number;
  /** Codigo de la tabla FEParamGetCondicionIvaReceptor (RG 5616). */
  condicionIvaReceptor: number;
  detallesIva: DetalleIva[];
}

export interface ResultadoCae {
  cae: string;
  caeVencimiento: string;
  numero: number;
  /** El comprobante ES valido, pero el usuario tiene que ver estos avisos. */
  observaciones: string[];
}

export class ErrorArca extends Error {
  constructor(
    mensaje: string,
    readonly codigo: string,
    readonly detalles: string[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorArca';
  }
}

const f2 = (n: number): string => n.toFixed(2);

function fechaArca(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** ARCA repite tags (`<Err>`, `<Obs>`): extrae todas las coincidencias. */
function extraerTodos(xml: string, tag: string): string[] {
  const salida: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) salida.push(m[1].trim());
  }
  return salida;
}

function parsearErrores(xml: string): string[] {
  return extraerTodos(xml, 'Err').map((e) => {
    const codigo = extraerTag(e, 'Code') ?? '';
    const mensaje = extraerTag(e, 'Msg') ?? e;
    return codigo ? `${codigo}: ${mensaje}` : mensaje;
  });
}

function parsearObservaciones(xml: string): string[] {
  return extraerTodos(xml, 'Obs').map((o) => {
    const codigo = extraerTag(o, 'Code') ?? '';
    const mensaje = extraerTag(o, 'Msg') ?? o;
    return codigo ? `${codigo}: ${mensaje}` : mensaje;
  });
}

export class ClienteWsfe {
  constructor(
    private readonly url: string,
    private readonly auth: { token: string; sign: string; cuit: string },
  ) {}

  static desdeTicket(url: string, ta: TicketAcceso, cuit: string): ClienteWsfe {
    return new ClienteWsfe(url, { token: ta.token, sign: ta.sign, cuit: cuit.replace(/\D/g, '') });
  }

  private xmlAuth(): string {
    return [
      '<ar:Auth>',
      `<ar:Token>${this.auth.token}</ar:Token>`,
      `<ar:Sign>${this.auth.sign}</ar:Sign>`,
      `<ar:Cuit>${this.auth.cuit}</ar:Cuit>`,
      '</ar:Auth>',
    ].join('');
  }

  private async llamar(accion: string, cuerpo: string): Promise<string> {
    const soap = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">',
      '<soapenv:Header/>',
      '<soapenv:Body>',
      cuerpo,
      '</soapenv:Body>',
      '</soapenv:Envelope>',
    ].join('');

    const { cuerpo: texto } = await postearSoap(
      this.url,
      `http://ar.gov.afip.dif.FEV1/${accion}`,
      soap,
    );
    const falla = extraerTag(texto, 'faultstring');
    if (falla) throw new ErrorArca(falla, 'SOAP_FAULT');

    // ARCA a veces devuelve una pagina HTML de error (cae su base Oracle) con
    // HTTP 200. Sin este control, el parser no encuentra los tags y devuelve
    // datos vacios como si todo hubiera salido bien.
    if (!texto.includes(`${accion}Result`) && !texto.includes('Envelope')) {
      const titulo = extraerTag(texto, 'title')
        ?.replace(/<br\s*\/?>/gi, ' | ')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&');
      throw new ErrorArca(
        `Los servidores de ARCA no estan respondiendo correctamente${titulo ? `: ${titulo}` : ''}. Es una falla del lado de ARCA: reintenta en unos minutos.`,
        'ARCA_NO_DISPONIBLE',
      );
    }
    return texto;
  }

  /** Estado de los servidores de ARCA. No requiere autenticacion. */
  static async dummy(url: string): Promise<{ app: string; db: string; auth: string }> {
    const cliente = new ClienteWsfe(url, { token: '', sign: '', cuit: '' });
    const xml = await cliente.llamar('FEDummy', '<ar:FEDummy/>');
    return {
      app: extraerTag(xml, 'AppServer') ?? '?',
      db: extraerTag(xml, 'DbServer') ?? '?',
      auth: extraerTag(xml, 'AuthServer') ?? '?',
    };
  }

  /** Ultimo numero autorizado por punto de venta y tipo. Se consulta antes de emitir. */
  async ultimoAutorizado(puntoVenta: number, codigoComprobante: number): Promise<number> {
    const xml = await this.llamar(
      'FECompUltimoAutorizado',
      [
        '<ar:FECompUltimoAutorizado>',
        this.xmlAuth(),
        `<ar:PtoVta>${puntoVenta}</ar:PtoVta>`,
        `<ar:CbteTipo>${codigoComprobante}</ar:CbteTipo>`,
        '</ar:FECompUltimoAutorizado>',
      ].join(''),
    );
    const errores = parsearErrores(xml);
    if (errores.length > 0) throw new ErrorArca(errores.join(' | '), 'ARCA_ERROR', errores);
    return Number(extraerTag(xml, 'CbteNro') ?? '0');
  }

  /** Solicita el CAE. Lanza si ARCA RECHAZA; las observaciones no son rechazo. */
  async solicitarCae(pedido: PedidoCae): Promise<ResultadoCae> {
    const numero =
      pedido.numero ?? (await this.ultimoAutorizado(pedido.puntoVenta, pedido.codigoComprobante)) + 1;

    // ARCA rechaza el detalle de IVA con neto gravado 0: en ese caso no se manda.
    const xmlIva =
      pedido.iva > 0 || pedido.detallesIva.length > 0
        ? [
            '<ar:Iva>',
            ...pedido.detallesIva.map((v) =>
              [
                '<ar:AlicIva>',
                `<ar:Id>${v.id}</ar:Id>`,
                `<ar:BaseImp>${f2(v.base)}</ar:BaseImp>`,
                `<ar:Importe>${f2(v.importe)}</ar:Importe>`,
                '</ar:AlicIva>',
              ].join(''),
            ),
            '</ar:Iva>',
          ].join('')
        : '';

    const cuerpo = [
      '<ar:FECAESolicitar>',
      this.xmlAuth(),
      '<ar:FeCAEReq>',
      '<ar:FeCabReq>',
      '<ar:CantReg>1</ar:CantReg>',
      `<ar:PtoVta>${pedido.puntoVenta}</ar:PtoVta>`,
      `<ar:CbteTipo>${pedido.codigoComprobante}</ar:CbteTipo>`,
      '</ar:FeCabReq>',
      '<ar:FeDetReq>',
      '<ar:FECAEDetRequest>',
      '<ar:Concepto>1</ar:Concepto>',
      `<ar:DocTipo>${pedido.docTipo}</ar:DocTipo>`,
      `<ar:DocNro>${pedido.docNumero.replace(/\D/g, '') || '0'}</ar:DocNro>`,
      `<ar:CbteDesde>${numero}</ar:CbteDesde>`,
      `<ar:CbteHasta>${numero}</ar:CbteHasta>`,
      `<ar:CbteFch>${fechaArca(pedido.fecha)}</ar:CbteFch>`,
      `<ar:ImpTotal>${f2(pedido.total)}</ar:ImpTotal>`,
      '<ar:ImpTotConc>0.00</ar:ImpTotConc>',
      `<ar:ImpNeto>${f2(pedido.neto)}</ar:ImpNeto>`,
      '<ar:ImpOpEx>0.00</ar:ImpOpEx>',
      '<ar:ImpTrib>0.00</ar:ImpTrib>',
      `<ar:ImpIVA>${f2(pedido.iva)}</ar:ImpIVA>`,
      '<ar:MonId>PES</ar:MonId>',
      '<ar:MonCotiz>1</ar:MonCotiz>',
      // El orden de los elementos lo fija el XSD de ARCA: este campo va despues
      // de MonCotiz y antes de Iva, o el comprobante se rechaza por esquema.
      `<ar:CondicionIVAReceptorId>${pedido.condicionIvaReceptor}</ar:CondicionIVAReceptorId>`,
      xmlIva,
      '</ar:FECAEDetRequest>',
      '</ar:FeDetReq>',
      '</ar:FeCAEReq>',
      '</ar:FECAESolicitar>',
    ].join('');

    const xml = await this.llamar('FECAESolicitar', cuerpo);

    const errores = parsearErrores(xml);
    if (errores.length > 0) {
      throw new ErrorArca(`ARCA rechazo el comprobante: ${errores.join(' | ')}`, 'ARCA_RECHAZO', errores);
    }

    const resultado = extraerTag(xml, 'Resultado');
    const cae = extraerTag(xml, 'CAE');
    const vencimiento = extraerTag(xml, 'CAEFchVto');
    const observaciones = parsearObservaciones(xml);

    if (resultado === 'R' || !cae) {
      throw new ErrorArca(
        observaciones.length > 0
          ? `ARCA rechazo el comprobante: ${observaciones.join(' | ')}`
          : 'ARCA rechazo el comprobante sin detallar el motivo',
        'ARCA_RECHAZO',
        observaciones,
      );
    }

    return { cae, caeVencimiento: vencimiento ?? '', numero, observaciones };
  }
}

export const ENDPOINTS_ARCA = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
} as const;

/** URL del QR obligatorio del comprobante (RG 4892). */
export function armarUrlQr(datos: {
  cuit: string;
  puntoVenta: number;
  codigoComprobante: number;
  numero: number;
  /** Total en PESOS. */
  importe: number;
  docTipo: number;
  docNumero: string;
  cae: string;
  /** AAAAMMDD. */
  fecha: string;
}): string {
  const carga = {
    ver: 1,
    fecha: `${datos.fecha.slice(0, 4)}-${datos.fecha.slice(4, 6)}-${datos.fecha.slice(6, 8)}`,
    cuit: Number(datos.cuit.replace(/\D/g, '')),
    ptoVta: datos.puntoVenta,
    tipoCmp: datos.codigoComprobante,
    nroCmp: datos.numero,
    importe: datos.importe,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: datos.docTipo,
    nroDocRec: Number(datos.docNumero.replace(/\D/g, '')) || 0,
    tipoCodAut: 'E',
    codAut: Number(datos.cae),
  };
  const b64 = Buffer.from(JSON.stringify(carga), 'utf8').toString('base64');
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
}
