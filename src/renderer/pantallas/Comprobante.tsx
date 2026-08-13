/**
 * Vista imprimible del remito o la factura de una venta.
 *
 * Se imprime con el dialogo del navegador (window.print) sobre una hoja A4: no
 * hace falta generar un PDF ni sumar un motor de impresion, y desde el mismo
 * dialogo el usuario puede guardar en PDF si lo necesita.
 *
 * La maqueta sigue la disposicion habitual de un comprobante argentino: emisor
 * arriba a la izquierda, letra en un recuadro al centro, numero y fecha a la
 * derecha, receptor debajo, detalle, totales y —si es factura— el CAE con su QR.
 */

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

import type { ComprobanteImprimible } from '../../compartido/contratos';
import { obtenerComprobante } from '../servicios/cliente';
import { leerPreferenciasImpresion } from './Sistema';
import { formatearCantidad, formatearMoneda } from '../utiles/formato';

function formatearFechaLarga(iso: string): string {
  const fecha = new Date(iso);
  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** AAAAMMDD (como lo devuelve ARCA) -> DD/MM/AAAA. */
function formatearFechaArca(valor: string | null): string {
  if (valor === null || valor.length !== 8) return '—';
  return `${valor.slice(6, 8)}/${valor.slice(4, 6)}/${valor.slice(0, 4)}`;
}

function formatearCuit(cuit: string | null): string {
  const digitos = (cuit ?? '').replace(/\D/g, '');
  if (digitos.length !== 11) return cuit ?? '—';
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}

export function Comprobante({ ventaId }: { readonly ventaId: number }): JSX.Element {
  const prefs = leerPreferenciasImpresion();
  const [datos, setDatos] = useState<ComprobanteImprimible | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    obtenerComprobante(ventaId)
      .then(setDatos)
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)));
  }, [ventaId]);

  useEffect(() => {
    const url = datos?.fiscal?.urlQr;
    if (url == null) return;
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 220 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [datos]);

  if (error !== null) {
    return (
      <p role="alert" className="m-8 rounded-ficha border border-peligro-200 bg-peligro-50 px-4 py-3 text-peligro-600">
        No se pudo armar el comprobante: {error}
      </p>
    );
  }
  if (datos === null) {
    return <p className="m-8 text-masa-700">Preparando el comprobante...</p>;
  }

  const esFactura = datos.fiscal !== null;
  const letra = datos.fiscal?.letra ?? 'X';
  const titulo = datos.fiscal?.tipo ?? 'REMITO';
  const numero = datos.fiscal?.etiqueta ?? `R ${String(datos.ventaId).padStart(8, '0')}`;

  return (
    <div className="mx-auto max-w-[210mm] bg-white p-8 text-masa-900 print:p-0">
      {/* Barra de acciones: no se imprime. */}
      <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
        <p className="text-sm text-masa-700">
          {esFactura
            ? 'Comprobante fiscal con CAE. Se imprime tal cual se emitio ante ARCA.'
            : 'Remito interno: documento de entrega, no se informa a ARCA.'}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-ficha bg-dulce-600 px-5 py-2 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Imprimir
          </button>
          <button
            type="button"
            onClick={() => window.alfajores?.ventanas.cerrarme()}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-50"
          >
            Cerrar
          </button>
        </div>
      </div>

      {/* En papel ticket el comprobante se angosta a 80 mm al imprimir. */}
      <article className={['border border-masa-900', prefs.papel === 'ticket' ? 'print:mx-auto print:w-[80mm] print:text-xs' : ''].join(' ')}>
        {/* Cabecera: emisor | letra | numeracion */}
        <header className="grid grid-cols-[1fr_auto_1fr] border-b border-masa-900">
          <div className="p-4">
            <p className="text-lg font-bold uppercase">{datos.emisor.razonSocial}</p>
            {datos.emisor.direccion !== null && <p className="text-sm">{datos.emisor.direccion}</p>}
            <p className="mt-2 text-sm">
              <strong>CUIT:</strong> {formatearCuit(datos.emisor.cuit)}
            </p>
            <p className="text-sm">
              <strong>Cond. IVA:</strong> {datos.emisor.condicionIva}
            </p>
            {datos.emisor.iibb !== null && (
              <p className="text-sm">
                <strong>IIBB:</strong> {datos.emisor.iibb}
              </p>
            )}
          </div>

          <div className="flex w-20 flex-col items-center justify-center border-x border-masa-900">
            <span className="text-4xl font-bold leading-none">{letra}</span>
            {esFactura && (
              <span className="mt-1 text-micro">
                COD. {datos.fiscal?.letra === 'A' ? '01' : '06'}
              </span>
            )}
          </div>

          <div className="p-4 text-right">
            <p className="text-lg font-bold uppercase">{titulo}</p>
            <p className="mt-1 font-mono text-sm">{numero}</p>
            <p className="mt-2 text-sm">
              <strong>Fecha:</strong> {formatearFechaLarga(datos.fecha)}
            </p>
            <p className="text-sm">
              <strong>Condicion de venta:</strong>{' '}
              {datos.formaPago === 'contado' ? 'Contado' : 'Cuenta corriente'}
            </p>
            {datos.estado === 'anulada' && (
              <p className="mt-2 text-sm font-bold uppercase text-peligro-600">Anulada</p>
            )}
          </div>
        </header>

        {/* Receptor */}
        <section className="border-b border-masa-900 p-4">
          <p className="text-sm">
            <strong>Señor(es):</strong> {datos.receptor.nombre}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-8 text-sm">
            <span>
              <strong>CUIT:</strong> {formatearCuit(datos.receptor.cuit)}
            </span>
            <span>
              <strong>Cond. IVA:</strong> {datos.receptor.condicionIva}
            </span>
            {datos.receptor.direccion !== null && (
              <span>
                <strong>Domicilio:</strong> {datos.receptor.direccion}
              </span>
            )}
          </div>
        </section>

        {/* Detalle */}
        <table className="w-full border-b border-masa-900 text-sm">
          <thead>
            <tr className="border-b border-masa-900 text-left text-micro uppercase">
              <th scope="col" className="p-2">Codigo</th>
              <th scope="col" className="p-2">Descripcion</th>
              <th scope="col" className="p-2 text-right">Cantidad</th>
              <th scope="col" className="p-2 text-right">P. unitario</th>
              <th scope="col" className="p-2 text-right">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {datos.lineas.map((linea, indice) => (
              <tr key={indice} className="border-b border-masa-200 last:border-0">
                <td className="p-2 font-mono text-xs">{linea.codigo}</td>
                <td className="p-2">{linea.nombre}</td>
                <td className="p-2 text-right font-mono tabular-nums">
                  {formatearCantidad(linea.cantidad)} {linea.unidadAbreviatura}
                  {linea.cajas !== null && (
                    <span className="block text-micro text-masa-700">
                      ({formatearCantidad(linea.cajas)} caja{linea.cajas === 1 ? '' : 's'})
                    </span>
                  )}
                </td>
                <td className="p-2 text-right font-mono tabular-nums">
                  {formatearMoneda(linea.precioUnitario)}
                </td>
                <td className="p-2 text-right font-mono tabular-nums">
                  {formatearMoneda(linea.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales */}
        <section className="flex justify-end border-b border-masa-900 p-4">
          <table className="text-sm">
            <tbody>
              {datos.fiscal !== null && datos.fiscal.letra === 'A' && (
                <>
                  <tr>
                    <td className="pr-8 text-right">Neto gravado:</td>
                    <td className="text-right font-mono tabular-nums">
                      {formatearMoneda(datos.fiscal.neto)}
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-8 text-right">IVA 21%:</td>
                    <td className="text-right font-mono tabular-nums">
                      {formatearMoneda(datos.fiscal.iva)}
                    </td>
                  </tr>
                </>
              )}
              <tr className="text-lg font-bold">
                <td className="pr-8 text-right">TOTAL:</td>
                <td className="text-right font-mono tabular-nums">{formatearMoneda(datos.total)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Pie: CAE con QR, o leyenda del remito */}
        <footer className="p-4">
          {datos.fiscal !== null ? (
            <div className="flex items-end justify-between gap-4">
              <div>
                {qr !== null && <img src={qr} alt="Codigo QR del comprobante" className="h-28 w-28" />}
              </div>
              <div className="text-right text-sm">
                <p className="font-mono text-base font-bold">CAE N° {datos.fiscal.cae}</p>
                <p>
                  <strong>Vencimiento del CAE:</strong>{' '}
                  {formatearFechaArca(datos.fiscal.caeVencimiento)}
                </p>
                <p className="mt-2 text-micro text-masa-700">
                  Comprobante autorizado por ARCA
                </p>
              </div>
            </div>
          ) : (
            <p className="text-center text-sm text-masa-700">
              Documento no valido como factura. Remito interno de entrega de mercaderia.
            </p>
          )}

          {datos.notas !== null && (
            <p className="mt-4 border-t border-masa-200 pt-2 text-sm">
              <strong>Observaciones:</strong> {datos.notas}
            </p>
          )}
        </footer>
        {prefs.pie !== '' && (
          <p className="border-t border-masa-900 px-4 py-2 text-center text-sm">{prefs.pie}</p>
        )}
      </article>

      {/* Duplicado de firma: el reparto vuelve con la conformidad del cliente. */}
      {!esFactura && (
        <div className="mt-8 flex justify-between gap-8 text-sm print:mt-16">
          <div className="flex-1 border-t border-masa-900 pt-1 text-center">Entregue conforme</div>
          <div className="flex-1 border-t border-masa-900 pt-1 text-center">Recibi conforme</div>
        </div>
      )}
    </div>
  );
}
