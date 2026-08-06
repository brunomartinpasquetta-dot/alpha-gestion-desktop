/**
 * ABM de los maestros del sistema: clientes, proveedores y articulos.
 *
 * Regla comun a los tres: NO se borran fisicamente. Una entidad referenciada por
 * el ledger (una venta, un movimiento de stock) no puede desaparecer sin dejar
 * documentos huerfanos, asi que "eliminar" es desactivar (`activo = false`). El
 * registro sigue existiendo para la historia y deja de ofrecerse en los
 * formularios. Reactivar es el mismo camino en sentido inverso.
 *
 * Los articulos ademas nunca cambian de tipo despues de tener movimientos: el
 * stock de un producto terminado no es intercambiable con el de una materia
 * prima, y el ledger ya quedo escrito bajo un tipo.
 */

import { and, eq, ne, sql } from 'drizzle-orm';

import type {
  ClienteVista,
  EntradaArticulo,
  EntradaCliente,
  EntradaProveedor,
  ProveedorVista,
} from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { articulos, clientes, movimientosStock, proveedores, unidadesMedida } from '../db/schema';
import { listarClientes, listarProveedores } from '../repositorios/lectura/terceros.repositorio';
import {
  ejecutarSeguro,
  ErrorConflicto,
  ErrorNoEncontrado,
  ErrorReglaNegocio,
  ErrorValidacion,
} from '../dominio/errores';

/** Normaliza texto de formulario: recorta y convierte vacio en null. */
function textoOpcional(valor: string | null | undefined): string | null {
  const limpio = valor?.trim();
  return limpio ? limpio : null;
}

/** CUIT: se guarda solo con digitos para que las comparaciones sean estables. */
function cuitNormalizado(valor: string | null | undefined): string | null {
  const digitos = valor?.replace(/\D/g, '') ?? '';
  if (digitos === '') return null;
  if (digitos.length !== 11) {
    throw new ErrorValidacion('El CUIT tiene que tener 11 digitos.');
  }
  return digitos;
}

function exigirNombre(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio.length < 2) throw new ErrorValidacion('El nombre tiene que tener al menos 2 caracteres.');
  return limpio;
}

/*
 * Las vistas salen del repositorio de LECTURA en vez de rearmar las consultas
 * aca. El saldo de cuenta corriente tiene una sola definicion en todo el
 * sistema: duplicarla es como se cuela una baja de un cliente que debe plata.
 */

function vistaCliente(id: number): ClienteVista {
  const fila = listarClientes().find((c) => c.id === id);
  if (!fila) throw new ErrorNoEncontrado('cliente', id);
  return fila;
}

function vistaProveedor(id: number): ProveedorVista {
  const fila = listarProveedores().find((p) => p.id === id);
  if (!fila) throw new ErrorNoEncontrado('proveedor', id);
  return fila;
}

export const maestrosServicio = {
  /* ------------------------------- Clientes -------------------------------- */

  crearCliente(entrada: EntradaCliente): ClienteVista {
    return ejecutarSeguro('crear un cliente', () => {
      const db = obtenerDb();
      const nombre = exigirNombre(entrada.nombre);
      const fila = db
        .insert(clientes)
        .values({
          nombre,
          cuit: cuitNormalizado(entrada.cuit),
          telefono: textoOpcional(entrada.telefono),
          email: textoOpcional(entrada.email),
          direccion: textoOpcional(entrada.direccion),
          tipo: entrada.tipo,
          listaPrecioId: entrada.listaPrecioId ?? null,
          notas: textoOpcional(entrada.notas),
          activo: true,
        })
        .returning({ id: clientes.id })
        .all()[0];
      if (!fila) throw new ErrorValidacion('La base no devolvio el cliente insertado.');
      return vistaCliente(fila.id);
    });
  },

  actualizarCliente(id: number, entrada: EntradaCliente): ClienteVista {
    return ejecutarSeguro('actualizar un cliente', () => {
      const db = obtenerDb();
      const existe = db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, id)).get();
      if (!existe) throw new ErrorNoEncontrado('cliente', id);
      db.update(clientes)
        .set({
          nombre: exigirNombre(entrada.nombre),
          cuit: cuitNormalizado(entrada.cuit),
          telefono: textoOpcional(entrada.telefono),
          email: textoOpcional(entrada.email),
          direccion: textoOpcional(entrada.direccion),
          tipo: entrada.tipo,
          listaPrecioId: entrada.listaPrecioId ?? null,
          notas: textoOpcional(entrada.notas),
        })
        .where(eq(clientes.id, id))
        .run();
      return vistaCliente(id);
    });
  },

  /** Alta o baja logica. No borra: el ledger referencia al cliente. */
  cambiarActivoCliente(id: number, activo: boolean): ClienteVista {
    return ejecutarSeguro('cambiar el estado de un cliente', () => {
      const db = obtenerDb();
      const existe = db.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, id)).get();
      if (!existe) throw new ErrorNoEncontrado('cliente', id);
      if (!activo) {
        const vista = vistaCliente(id);
        if (vista.saldoCc !== 0) {
          throw new ErrorReglaNegocio(
            `${vista.nombre} tiene saldo en cuenta corriente. Saldalo antes de darlo de baja.`,
          );
        }
      }
      db.update(clientes).set({ activo }).where(eq(clientes.id, id)).run();
      return vistaCliente(id);
    });
  },

  /* ------------------------------ Proveedores ------------------------------ */

  crearProveedor(entrada: EntradaProveedor): ProveedorVista {
    return ejecutarSeguro('crear un proveedor', () => {
      const db = obtenerDb();
      const fila = db
        .insert(proveedores)
        .values({
          nombre: exigirNombre(entrada.nombre),
          cuit: cuitNormalizado(entrada.cuit),
          telefono: textoOpcional(entrada.telefono),
          email: textoOpcional(entrada.email),
          direccion: textoOpcional(entrada.direccion),
          notas: textoOpcional(entrada.notas),
          activo: true,
        })
        .returning({ id: proveedores.id })
        .all()[0];
      if (!fila) throw new ErrorValidacion('La base no devolvio el proveedor insertado.');
      return vistaProveedor(fila.id);
    });
  },

  actualizarProveedor(id: number, entrada: EntradaProveedor): ProveedorVista {
    return ejecutarSeguro('actualizar un proveedor', () => {
      const db = obtenerDb();
      const existe = db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, id)).get();
      if (!existe) throw new ErrorNoEncontrado('proveedor', id);
      db.update(proveedores)
        .set({
          nombre: exigirNombre(entrada.nombre),
          cuit: cuitNormalizado(entrada.cuit),
          telefono: textoOpcional(entrada.telefono),
          email: textoOpcional(entrada.email),
          direccion: textoOpcional(entrada.direccion),
          notas: textoOpcional(entrada.notas),
        })
        .where(eq(proveedores.id, id))
        .run();
      return vistaProveedor(id);
    });
  },

  cambiarActivoProveedor(id: number, activo: boolean): ProveedorVista {
    return ejecutarSeguro('cambiar el estado de un proveedor', () => {
      const db = obtenerDb();
      const existe = db.select({ id: proveedores.id }).from(proveedores).where(eq(proveedores.id, id)).get();
      if (!existe) throw new ErrorNoEncontrado('proveedor', id);
      if (!activo) {
        const vista = vistaProveedor(id);
        if (vista.saldoCc !== 0) {
          throw new ErrorReglaNegocio(
            `${vista.nombre} tiene saldo en cuenta corriente. Saldalo antes de darlo de baja.`,
          );
        }
      }
      db.update(proveedores).set({ activo }).where(eq(proveedores.id, id)).run();
      return vistaProveedor(id);
    });
  },

  /* -------------------------------- Articulos ------------------------------ */

  crearArticulo(entrada: EntradaArticulo): number {
    return ejecutarSeguro('crear un articulo', () => {
      const db = obtenerDb();
      const codigo = entrada.codigo.trim().toUpperCase();
      if (codigo.length < 2) throw new ErrorValidacion('El codigo tiene que tener al menos 2 caracteres.');

      const duplicado = db.select({ id: articulos.id }).from(articulos).where(eq(articulos.codigo, codigo)).get();
      if (duplicado) throw new ErrorConflicto(`Ya existe un articulo con el codigo ${codigo}.`);

      const unidad = db
        .select({ id: unidadesMedida.id })
        .from(unidadesMedida)
        .where(eq(unidadesMedida.id, entrada.unidadBaseId))
        .get();
      if (!unidad) throw new ErrorNoEncontrado('unidad de medida', entrada.unidadBaseId);

      // Las cajas cerradas solo tienen sentido en lo que se vende por caja.
      const unidadesPorCaja =
        entrada.tipo === 'producto_terminado' ? (entrada.unidadesPorCaja ?? null) : null;

      const fila = db
        .insert(articulos)
        .values({
          codigo,
          nombre: exigirNombre(entrada.nombre),
          tipo: entrada.tipo,
          unidadBaseId: entrada.unidadBaseId,
          stockMin: entrada.stockMin ?? null,
          unidadesPorCaja,
          costoActual: entrada.costoActual ?? null,
          activo: true,
        })
        .returning({ id: articulos.id })
        .all()[0];
      if (!fila) throw new ErrorValidacion('La base no devolvio el articulo insertado.');
      return fila.id;
    });
  },

  actualizarArticulo(id: number, entrada: EntradaArticulo): number {
    return ejecutarSeguro('actualizar un articulo', () => {
      const db = obtenerDb();
      const actual = db
        .select({ id: articulos.id, tipo: articulos.tipo })
        .from(articulos)
        .where(eq(articulos.id, id))
        .get();
      if (!actual) throw new ErrorNoEncontrado('articulo', id);

      const codigo = entrada.codigo.trim().toUpperCase();
      const duplicado = db
        .select({ id: articulos.id })
        .from(articulos)
        .where(and(eq(articulos.codigo, codigo), ne(articulos.id, id)))
        .get();
      if (duplicado) throw new ErrorConflicto(`Ya existe otro articulo con el codigo ${codigo}.`);

      // Cambiar el tipo con movimientos escritos mezclaria stocks de naturaleza
      // distinta y dejaria el ledger historico bajo un tipo que ya no existe.
      if (entrada.tipo !== actual.tipo) {
        const movimientos =
          db
            .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
            .from(movimientosStock)
            .where(eq(movimientosStock.articuloId, id))
            .get()?.n ?? 0;
        if (movimientos > 0) {
          throw new ErrorReglaNegocio(
            'El articulo ya tiene movimientos de stock: no se puede cambiar su tipo. ' +
              'Dalo de baja y crea uno nuevo con el tipo correcto.',
          );
        }
      }

      db.update(articulos)
        .set({
          codigo,
          nombre: exigirNombre(entrada.nombre),
          tipo: entrada.tipo,
          unidadBaseId: entrada.unidadBaseId,
          stockMin: entrada.stockMin ?? null,
          unidadesPorCaja:
            entrada.tipo === 'producto_terminado' ? (entrada.unidadesPorCaja ?? null) : null,
          costoActual: entrada.costoActual ?? null,
        })
        .where(eq(articulos.id, id))
        .run();
      return id;
    });
  },

  cambiarActivoArticulo(id: number, activo: boolean): number {
    return ejecutarSeguro('cambiar el estado de un articulo', () => {
      const db = obtenerDb();
      const existe = db.select({ id: articulos.id, nombre: articulos.nombre }).from(articulos).where(eq(articulos.id, id)).get();
      if (!existe) throw new ErrorNoEncontrado('articulo', id);
      if (!activo) {
        const stock =
          db
            .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
            .from(movimientosStock)
            .where(eq(movimientosStock.articuloId, id))
            .get()?.s ?? 0;
        if (stock !== 0) {
          throw new ErrorReglaNegocio(
            `${existe.nombre} todavia tiene stock (${stock}). Ajustalo a cero antes de darlo de baja.`,
          );
        }
      }
      db.update(articulos).set({ activo }).where(eq(articulos.id, id)).run();
      return id;
    });
  },
};
