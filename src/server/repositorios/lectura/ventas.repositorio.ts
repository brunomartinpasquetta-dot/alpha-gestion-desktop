/**
 * Repositorio de LECTURA de ventas.
 *
 * El cliente entra por LEFT JOIN porque `ventas.cliente_id` es opcional: la
 * venta de mostrador sin cliente identificado es un caso corriente, no un dato
 * faltante. Por eso `clienteNombre` viaja como `string | null` hasta la vista.
 */

import { desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  clientes,
  comprobantes,
  ventaItems,
  ventas,
  type EstadoVenta,
  type FormaPago,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Venta con el cliente resuelto y el recuento de items. Importes en centavos. */
export interface FilaVenta {
  id: number;
  fecha: string;
  clienteId: number | null;
  clienteNombre: string | null;
  total: number;
  formaPago: FormaPago;
  estado: EstadoVenta;
  pedidoId: number | null;
  cantidadItems: number;
  notas: string | null;
  /** "FB 00001-00000042" si la venta se facturo; null = remito interno. */
  comprobanteEtiqueta: string | null;
  cae: string | null;
}

/** Listado de ventas, de la mas reciente a la mas antigua. */
export function listarVentas(): FilaVenta[] {
  return ejecutarSeguro('listar ventas', () =>
    obtenerDb()
      .select({
        id: ventas.id,
        fecha: ventas.fecha,
        clienteId: ventas.clienteId,
        clienteNombre: clientes.nombre,
        total: ventas.total,
        formaPago: ventas.formaPago,
        estado: ventas.estado,
        pedidoId: ventas.pedidoId,
        cantidadItems: sql<number>`COUNT(${ventaItems.id})`.mapWith(Number),
        notas: ventas.notas,
        comprobanteEtiqueta: sql<string | null>`CASE WHEN ${comprobantes.id} IS NULL THEN NULL ELSE
          'F' || ${comprobantes.letra} || ' ' || printf('%05d', ${comprobantes.puntoVenta}) || '-' || printf('%08d', ${comprobantes.numero}) END`,
        cae: comprobantes.cae,
      })
      .from(ventas)
      .leftJoin(clientes, eq(clientes.id, ventas.clienteId))
      .leftJoin(comprobantes, eq(comprobantes.ventaId, ventas.id))
      .leftJoin(ventaItems, eq(ventaItems.ventaId, ventas.id))
      .groupBy(ventas.id)
      .orderBy(desc(ventas.fecha), desc(ventas.id))
      .all(),
  );
}
