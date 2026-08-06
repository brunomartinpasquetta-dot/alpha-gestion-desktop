/**
 * Transporte HTTP hacia ARCA.
 *
 * No se usa `fetch` a proposito: los servidores de ARCA todavia negocian
 * Diffie-Hellman con claves de 1024 bits, y el OpenSSL que trae Node las
 * rechaza de plano ("dh key too small"). Con `fetch` no hay forma de aflojar
 * ese nivel de seguridad sin sumar una dependencia; con `node:https` alcanza
 * con bajar el SECLEVEL para ESTAS conexiones y solo para estas.
 *
 * Verificado el 2026-08-06: sin `@SECLEVEL=1`, servicios1.afip.gov.ar (WSFE de
 * produccion) falla el handshake y la facturacion real no funcionaria.
 */

import { request as pedirHttps } from 'node:https';

/** Cuanto se espera a ARCA antes de cortar. Sus picos rondan el minuto. */
const MS_TIMEOUT = 60_000;

export interface RespuestaSoap {
  estado: number;
  cuerpo: string;
}

export function postearSoap(url: string, accionSoap: string, xml: string): Promise<RespuestaSoap> {
  return new Promise((resolver, rechazar) => {
    const pedido = pedirHttps(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: accionSoap,
          'Content-Length': Buffer.byteLength(xml),
        },
        // Ver comentario de cabecera: ARCA negocia DH de 1024 bits.
        ciphers: 'DEFAULT:@SECLEVEL=1',
        timeout: MS_TIMEOUT,
      },
      (respuesta) => {
        let cuerpo = '';
        respuesta.setEncoding('utf8');
        respuesta.on('data', (parte: string) => {
          cuerpo += parte;
        });
        respuesta.on('end', () => resolver({ estado: respuesta.statusCode ?? 0, cuerpo }));
      },
    );

    pedido.on('timeout', () => {
      pedido.destroy(new Error(`ARCA no respondio en ${MS_TIMEOUT / 1000} segundos.`));
    });
    pedido.on('error', (error) =>
      rechazar(new Error(`No se pudo conectar con ARCA (${url}): ${error.message}`)),
    );
    pedido.end(xml);
  });
}
