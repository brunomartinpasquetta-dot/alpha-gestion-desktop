/**
 * Repositorio de LECTURA de compras.
 *
 * El listado no trae los items: para la grilla alcanza con cuantos son, y ese
 * recuento se resuelve con un COUNT agregado en la misma consulta. Traer los
 * items de todas las compras para despues contarlos en memoria seria mover datos
 * al pedo.
 */

import { desc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  compraItems,
  compras,
  proveedores,
  type EstadoCompra,
  type FormaPago,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Compra con el proveedor resuelto y el recuento de items. Importes en centavos. */
export interface FilaCompra {
  id: number;
  fecha: string;
  proveedorId: number;
  proveedorNombre: string;
  total: number;
  formaPago: FormaPago;
  estado: EstadoCompra;
  cantidadItems: number;
  notas: string | null;
}

/** Listado de compras, de la mas reciente a la mas antigua. */
export function listarCompras(): FilaCompra[] {
  return ejecutarSeguro('listar compras', () =>
    obtenerDb()
      .select({
        id: compras.id,
        fecha: compras.fecha,
        proveedorId: compras.proveedorId,
        proveedorNombre: proveedores.nombre,
        total: compras.total,
        formaPago: compras.formaPago,
        estado: compras.estado,
        cantidadItems: sql<number>`COUNT(${compraItems.id})`.mapWith(Number),
        notas: compras.notas,
      })
      .from(compras)
      .innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
      .leftJoin(compraItems, eq(compraItems.compraId, compras.id))
      .groupBy(compras.id)
      .orderBy(desc(compras.fecha), desc(compras.id))
      .all(),
  );
}
