/**
 * Firma CMS/PKCS#7 del TRA que exige ARCA para autenticar.
 *
 * Se hace con node-forge (JavaScript puro, viaja empaquetado en la app) y NO
 * llamando al `openssl` del sistema. El motivo es concreto: macOS trae openssl,
 * Windows NO — solo aparece si la maquina tiene Git u otra herramienta que lo
 * instale. Depender de eso significaba que en la PC del cliente la facturacion
 * podia no funcionar por una razon que no tiene nada que ver con el sistema.
 *
 * El resultado es identico al de `openssl cms -sign -nodetach -outform DER`
 * seguido de base64: firma adjunta (el TRA viaja dentro del sobre), DER, SHA-256.
 */

import { readFileSync } from 'node:fs';
import forge from 'node-forge';

export interface MaterialFirma {
  /** Certificado X.509 del tramite de ARCA, en PEM. */
  certificadoPem: string;
  /** Clave privada que corresponde a ese certificado, en PEM. */
  clavePem: string;
}

export function leerMaterialFirma(rutaCertificado: string, rutaClave: string): MaterialFirma {
  return {
    certificadoPem: readFileSync(rutaCertificado, 'utf8'),
    clavePem: readFileSync(rutaClave, 'utf8'),
  };
}

/**
 * Devuelve el TRA firmado en CMS, codificado en base64, listo para LoginCms.
 *
 * Los `authenticatedAttributes` no son opcionales: sin contentType,
 * messageDigest y signingTime, ARCA rechaza el sobre por invalido.
 */
export function firmarTraCms(tra: string, material: MaterialFirma): string {
  let certificado: forge.pki.Certificate;
  let clave: forge.pki.rsa.PrivateKey;

  try {
    certificado = forge.pki.certificateFromPem(material.certificadoPem);
  } catch (error) {
    throw new Error(
      `El certificado no se pudo leer: ¿es el archivo .crt/.pem del tramite de ARCA? Detalle: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    clave = forge.pki.privateKeyFromPem(material.clavePem) as forge.pki.rsa.PrivateKey;
  } catch (error) {
    throw new Error(
      `La clave privada no se pudo leer: ¿es el archivo .key con el que se genero el certificado? ` +
        `Si esta protegida con contraseña, hay que quitarsela. Detalle: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }

  // Que la clave sea la del certificado: es el error mas comun al configurar, y
  // ARCA lo devuelve como un rechazo generico imposible de diagnosticar.
  const publicaDelCert = certificado.publicKey as forge.pki.rsa.PublicKey;
  if (publicaDelCert.n.toString(16) !== clave.n.toString(16)) {
    throw new Error(
      'El certificado y la clave privada no se corresponden: son de tramites distintos. ' +
        'Volve a cargar el par que descargaste junto de ARCA.',
    );
  }

  const sobre = forge.pkcs7.createSignedData();
  sobre.content = forge.util.createBuffer(tra, 'utf8');
  sobre.addCertificate(certificado);
  sobre.addSigner({
    key: clave,
    certificate: certificado,
    digestAlgorithm: forge.pki.oids['sha256'] as string,
    authenticatedAttributes: [
      { type: forge.pki.oids['contentType'] as string, value: forge.pki.oids['data'] as string },
      { type: forge.pki.oids['messageDigest'] as string },
      { type: forge.pki.oids['signingTime'] as string, value: new Date().toISOString() },
    ],
  });

  // detached: false => el TRA va DENTRO del sobre, que es lo que espera ARCA.
  sobre.sign({ detached: false });

  const der = forge.asn1.toDer(sobre.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

/** Fecha de vencimiento del certificado, para avisar antes de que caduque. */
export function vencimientoCertificado(certificadoPem: string): Date | null {
  try {
    return forge.pki.certificateFromPem(certificadoPem).validity.notAfter;
  } catch {
    return null;
  }
}
