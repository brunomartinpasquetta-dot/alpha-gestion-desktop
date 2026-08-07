/**
 * Arma el comprobante imprimible de una venta: remito interno o factura con CAE.
 *
 * Todo lo que se imprime sale de lo que quedo guardado al emitir, no de los
 * maestros de hoy. Si el cliente cambia de direccion o la fabrica cambia de
 * razon social, un comprobante viejo tiene que seguir diciendo lo que decia
 * cuando se emitio: es un documento, no una consulta.
 */

import { eq, sql } from 'drizzle-orm';

import {
  nombreCondicionReceptor,
  type ComprobanteImprimible,
  type LineaComprobante,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  clientes,
  comprobantes,
  configuracionFiscal,
  ventaItems,
  ventas,
} from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado } from '../dominio/errores';
import { etiquetaComprobante } from './ventas.servicio';

/** Nombre legible de la condicion frente al IVA. */
const NOMBRE_CONDICION: Record<string, string> = {
  RI: 'Responsable Inscripto',
  MT: 'Monotributo',
};

/** Codigo ARCA -> nombre del comprobante. */
const NOMBRE_TIPO: Record<number, string> = {
  1: 'FACTURA A',
  6: 'FACTURA B',
};

export const comprobantesServicio = {
  obtenerImprimible(ventaId: number): ComprobanteImprimible {
    return ejecutarSeguro('armar el comprobante', () => {
      const db = obtenerDb();

      const venta = db
        .select({
          id: ventas.id,
          fecha: ventas.fecha,
          estado: ventas.estado,
          formaPago: ventas.formaPago,
          notas: ventas.notas,
          total: ventas.total,
          clienteId: ventas.clienteId,
        })
        .from(ventas)
        .where(eq(ventas.id, ventaId))
        .get();
      if (!venta) throw new ErrorNoEncontrado('venta', ventaId);

      const config = db.select().from(configuracionFiscal).get();
      const fiscal = db.select().from(comprobantes).where(eq(comprobantes.ventaId, ventaId)).get();

      const cliente =
        venta.clienteId === null
          ? undefined
          : db
              .select({
                nombre: clientes.nombre,
                cuit: clientes.cuit,
                direccion: clientes.direccion,
              })
              .from(clientes)
              .where(eq(clientes.id, venta.clienteId))
              .get();

      const filas = db
        .select({
          codigo: articulos.codigo,
          nombre: articulos.nombre,
          cantidad: ventaItems.cantidad,
          unidadesPorCaja: articulos.unidadesPorCaja,
          precioUnitario: ventaItems.precioUnitario,
          subtotal: ventaItems.subtotal,
          // Por subconsulta en vez de otro join: es un dato de catalogo, chico y fijo.
          unidadAbreviatura: sql<string>`(SELECT abreviatura FROM unidades_medida WHERE id = ${articulos.unidadBaseId})`,
        })
        .from(ventaItems)
        .innerJoin(articulos, eq(articulos.id, ventaItems.articuloId))
        .where(eq(ventaItems.ventaId, ventaId))
        .all();

      const lineas: LineaComprobante[] = filas.map((f) => ({
        codigo: f.codigo,
        nombre: f.nombre,
        cantidad: f.cantidad,
        unidadAbreviatura: f.unidadAbreviatura,
        // La fabrica vende cajas cerradas y el remito las muestra, pero SOLO
        // cuando la cantidad da cajas enteras: "0,417 cajas" en un comprobante
        // no le sirve a nadie y confunde a quien recibe la mercaderia.
        cajas:
          f.unidadesPorCaja != null && f.unidadesPorCaja > 0 && f.cantidad % f.unidadesPorCaja === 0
            ? f.cantidad / f.unidadesPorCaja
            : null,
        precioUnitario: f.precioUnitario,
        subtotal: f.subtotal,
      }));

      return {
        ventaId: venta.id,
        fecha: venta.fecha,
        estado: venta.estado,
        formaPago: venta.formaPago,
        notas: venta.notas,
        emisor: {
          razonSocial: config?.razonSocial?.trim() || 'Alpha Gestión',
          cuit: config?.cuit ?? '',
          direccion: config?.direccion ?? null,
          condicionIva: NOMBRE_CONDICION[config?.condicionIva ?? 'RI'] ?? 'Responsable Inscripto',
          iibb: config?.iibb ?? null,
        },
        receptor: {
          // El comprobante congelo el nombre del receptor al emitirse; el remito
          // no tiene ese registro, asi que usa el maestro.
          nombre: fiscal?.receptorNombre ?? cliente?.nombre ?? 'Consumidor Final',
          cuit: fiscal?.docNumero && fiscal.docTipo === 80 ? fiscal.docNumero : (cliente?.cuit ?? null),
          direccion: cliente?.direccion ?? null,
          condicionIva:
            fiscal === undefined ? '—' : nombreCondicionReceptor(fiscal.condicionIvaReceptor),
        },
        fiscal:
          fiscal === undefined
            ? null
            : {
                letra: fiscal.letra,
                tipo: NOMBRE_TIPO[fiscal.codigoArca] ?? `COMPROBANTE ${fiscal.letra}`,
                puntoVenta: fiscal.puntoVenta,
                numero: fiscal.numero,
                etiqueta: etiquetaComprobante(fiscal.letra, fiscal.puntoVenta, fiscal.numero),
                cae: fiscal.cae,
                caeVencimiento: fiscal.caeVencimiento,
                neto: fiscal.neto,
                iva: fiscal.iva,
                urlQr: fiscal.urlQr,
              },
        lineas,
        total: venta.total,
      };
    });
  },
};
