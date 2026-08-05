/**
 * Repositorio de LECTURA de maestros de terceros: clientes, proveedores y
 * listas de precio.
 *
 * Los saldos de cuenta corriente se resuelven con un LEFT JOIN agregado contra
 * el ledger `cuentas_corrientes` en la misma consulta, no con una consulta por
 * entidad: la grilla de clientes de una distribuidora puede tener cientos de
 * filas y un N+1 ahi se nota.
 */

import { asc, eq, sql } from 'drizzle-orm';

import { obtenerDb } from '../../db/conexion';
import {
  articulos,
  clientes,
  cuentasCorrientes,
  listasPrecio,
  precios,
  proveedores,
  type TipoCliente,
} from '../../db/schema';
import { ejecutarSeguro } from '../../dominio/errores';

/** Saldo de cuenta corriente en centavos: (debe - haber). Positivo = nos deben. */
const SALDO_CC = sql<number>`COALESCE(SUM(
  CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto}
       ELSE -${cuentasCorrientes.monto} END
), 0)`;

export interface FilaCliente {
  id: number;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  tipo: TipoCliente;
  listaPrecioId: number | null;
  listaPrecioNombre: string | null;
  activo: boolean;
  saldoCc: number;
}

export interface FilaProveedor {
  id: number;
  nombre: string;
  cuit: string | null;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  activo: boolean;
  saldoCc: number;
}

export interface FilaListaPrecio {
  id: number;
  nombre: string;
  activa: boolean;
}

export interface FilaPrecio {
  id: number;
  listaPrecioId: number;
  articuloId: number;
  codigo: string;
  nombre: string;
  precio: number;
  vigenteDesde: string;
}

/** Clientes con su lista de precios y su saldo de cuenta corriente. */
export function listarClientes(): FilaCliente[] {
  return ejecutarSeguro('listar clientes', () =>
    obtenerDb()
      .select({
        id: clientes.id,
        nombre: clientes.nombre,
        cuit: clientes.cuit,
        telefono: clientes.telefono,
        email: clientes.email,
        direccion: clientes.direccion,
        tipo: clientes.tipo,
        listaPrecioId: clientes.listaPrecioId,
        listaPrecioNombre: listasPrecio.nombre,
        activo: clientes.activo,
        saldoCc: SALDO_CC.mapWith(Number),
      })
      .from(clientes)
      .leftJoin(listasPrecio, eq(listasPrecio.id, clientes.listaPrecioId))
      .leftJoin(
        cuentasCorrientes,
        sql`${cuentasCorrientes.entidadTipo} = 'cliente' AND ${cuentasCorrientes.entidadId} = ${clientes.id}`,
      )
      .groupBy(clientes.id)
      .orderBy(asc(clientes.nombre))
      .all(),
  );
}

/** Proveedores con su saldo de cuenta corriente. */
export function listarProveedores(): FilaProveedor[] {
  return ejecutarSeguro('listar proveedores', () =>
    obtenerDb()
      .select({
        id: proveedores.id,
        nombre: proveedores.nombre,
        cuit: proveedores.cuit,
        telefono: proveedores.telefono,
        email: proveedores.email,
        direccion: proveedores.direccion,
        activo: proveedores.activo,
        saldoCc: SALDO_CC.mapWith(Number),
      })
      .from(proveedores)
      .leftJoin(
        cuentasCorrientes,
        sql`${cuentasCorrientes.entidadTipo} = 'proveedor' AND ${cuentasCorrientes.entidadId} = ${proveedores.id}`,
      )
      .groupBy(proveedores.id)
      .orderBy(asc(proveedores.nombre))
      .all(),
  );
}

/** Listas de precio, sin sus precios (se traen aparte en una sola consulta). */
export function listarListasPrecio(): FilaListaPrecio[] {
  return ejecutarSeguro('listar listas de precio', () =>
    obtenerDb()
      .select({ id: listasPrecio.id, nombre: listasPrecio.nombre, activa: listasPrecio.activa })
      .from(listasPrecio)
      .orderBy(asc(listasPrecio.nombre))
      .all(),
  );
}

/**
 * Precios de TODAS las listas en una sola consulta. El servicio los agrupa por
 * `listaPrecioId`, evitando una consulta por lista.
 */
export function listarPreciosDeTodasLasListas(): FilaPrecio[] {
  return ejecutarSeguro('listar precios', () =>
    obtenerDb()
      .select({
        id: precios.id,
        listaPrecioId: precios.listaPrecioId,
        articuloId: precios.articuloId,
        codigo: articulos.codigo,
        nombre: articulos.nombre,
        precio: precios.precio,
        vigenteDesde: precios.vigenteDesde,
      })
      .from(precios)
      .innerJoin(articulos, eq(articulos.id, precios.articuloId))
      .orderBy(asc(articulos.nombre))
      .all(),
  );
}
