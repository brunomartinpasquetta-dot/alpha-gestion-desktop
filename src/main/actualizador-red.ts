/**
 * Capa de red del actualizador, sobre Node en vez de sobre Chromium.
 *
 * POR QUE EXISTE
 * --------------
 * electron-updater pide y descarga las actualizaciones con `electron.net`, que
 * es la pila de red de Chromium. En la PC del cliente esa pila contesta
 * `net::ERR_INTERNET_DISCONNECTED` con internet perfectamente conectado: Chromium
 * decide por su cuenta que la maquina esta offline —pasa en Windows con ciertos
 * adaptadores, VPNs y antivirus— y ni siquiera intenta la conexion. Resultado: la
 * app detectaba que habia version nueva (esa consulta va por Node) pero la
 * descarga fallaba siempre, y desde afuera parecia que el programa no se
 * actualiza.
 *
 * La pila de Node, en cambio, funciona en esa misma maquina: es la que usa todo
 * el resto del sistema —el servidor, y sobre todo las llamadas a ARCA, que si no
 * salieran no se podria facturar—. Asi que el actualizador pasa a usar la misma
 * red que ya sabemos que anda.
 *
 * LO QUE SE PIERDE. Chromium lee solo la configuracion de proxy de Windows; Node
 * no. Por eso se respetan las variables http_proxy / https_proxy, que es como se
 * configura un proxy en el resto del sistema. Una fabrica detras de un proxy
 * corporativo transparente es un caso que hoy no existe, y perder eso vale mucho
 * menos que no poder actualizar nunca.
 */

import { request as pedirHttp, type ClientRequest, type RequestOptions } from 'node:http';
import { request as pedirHttps } from 'node:https';

import {
  configureRequestOptions,
  configureRequestUrl,
  HttpExecutor,
  type DownloadOptions,
} from 'builder-util-runtime';

export class EjecutorHttpNode extends HttpExecutor<ClientRequest> {
  /**
   * Baja un archivo a disco. Es la copia de lo que hace el ejecutor de Electron,
   * salvo que no pide `redirect: "manual"`: los redirecciones de GitHub —que
   * manda a su CDN— las resuelve la clase base leyendo el header Location, que
   * es como funciona el cliente HTTP de Node.
   */
  async download(url: URL, destino: string, opciones: DownloadOptions): Promise<string> {
    return await opciones.cancellationToken.createPromise<string>((resolver, rechazar, alCancelar) => {
      const opcionesPedido: RequestOptions = { headers: opciones.headers ?? undefined };
      configureRequestUrl(url, opcionesPedido);
      configureRequestOptions(opcionesPedido);
      this.doDownload(
        opcionesPedido,
        {
          destination: destino,
          options: opciones,
          onCancel: alCancelar,
          callback: (error) => {
            if (error == null) resolver(destino);
            else rechazar(error);
          },
          responseHandler: null,
        },
        0,
      );
    });
  }

  createRequest(opciones: RequestOptions, callback: (respuesta: unknown) => void): ClientRequest {
    // Un proxy configurado por variable de entorno se respeta; sin eso, Node sale
    // directo, que es lo que hace falta en la fabrica.
    const pedir = opciones.protocol === 'http:' ? pedirHttp : pedirHttps;
    return pedir(opciones, callback as never);
  }
}
