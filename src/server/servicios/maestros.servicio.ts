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
  EntradaUsuario,
  ProveedorVista,
  UsuarioVista,
} from '../../compartido/contratos';
import bcrypt from 'bcrypt';

import { obtenerDb } from '../db/conexion';
import { emitir } from '../eventos';
import {
  ALICUOTAS_IVA,
  articulos,
  clientes,
  familias,
  movimientosStock,
  proveedores,
  unidadesMedida,
  usuarios,
  vendedores,
} from '../db/schema';
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

/**
 * Arma los campos del articulo desde la entrada del formulario. Vive aparte
 * porque el alta y la edicion tienen que escribir EXACTAMENTE lo mismo: cuando
 * cada una armaba su propio objeto, un campo nuevo se agregaba en una y se
 * olvidaba en la otra.
 */
function camposArticulo(entrada: EntradaArticulo, codigo: string) {
  const alicuota = entrada.alicuotaIva ?? 21;
  if (!ALICUOTAS_IVA.includes(alicuota as (typeof ALICUOTAS_IVA)[number])) {
    throw new ErrorValidacion(
      `La alicuota de IVA ${alicuota}% no existe en ARCA. Validas: ${ALICUOTAS_IVA.join(', ')}.`,
    );
  }
  return {
    codigo,
    nombre: exigirNombre(entrada.nombre),
    tipo: entrada.tipo,
    unidadBaseId: entrada.unidadBaseId,
    stockMin: entrada.stockMin ?? null,
    stockIdeal: entrada.stockIdeal ?? null,
    codigoBarras: textoOpcional(entrada.codigoBarras),
    marca: textoOpcional(entrada.marca),
    familiaId: entrada.familiaId ?? null,
    proveedorHabitualId: entrada.proveedorHabitualId ?? null,
    alicuotaIva: alicuota,
    porPeso: entrada.porPeso ?? false,
    notas: textoOpcional(entrada.notas),
    // Las cajas cerradas solo tienen sentido en lo que se vende por caja.
    unidadesPorCaja: entrada.tipo === 'producto_terminado' ? (entrada.unidadesPorCaja ?? null) : null,
    costoActual: entrada.costoActual ?? null,
  };
}

/**
 * Un CUIT identifica a una persona o empresa: repetirlo significa que el mismo
 * cliente quedo cargado dos veces, y a partir de ahi su cuenta corriente vive
 * partida en dos y ninguno de los dos saldos es el real. El nombre SI se puede
 * repetir (dos sucursales del mismo kiosco son dos clientes distintos).
 */
function verificarCuitUnico(
  cuit: string | null,
  tabla: typeof clientes | typeof proveedores,
  idPropio: number | null,
  que: string,
): void {
  if (cuit === null) return;
  const condicion =
    idPropio === null ? eq(tabla.cuit, cuit) : and(eq(tabla.cuit, cuit), ne(tabla.id, idPropio));
  const duplicado = obtenerDb().select({ nombre: tabla.nombre }).from(tabla).where(condicion).get();
  if (duplicado) {
    throw new ErrorConflicto(`El CUIT ${cuit} ya lo tiene ${que} "${duplicado.nombre}".`);
  }
}

/** Campos del cliente. Alta y edicion escriben lo mismo: ver camposArticulo. */
function camposCliente(entrada: EntradaCliente) {
  return {
    nombre: exigirNombre(entrada.nombre),
    cuit: cuitNormalizado(entrada.cuit),
    tipoDocumento: textoOpcional(entrada.tipoDocumento),
    numeroDocumento: textoOpcional(entrada.numeroDocumento),
    condicionIva: entrada.condicionIva ?? 5,
    telefono: textoOpcional(entrada.telefono),
    celular: textoOpcional(entrada.celular),
    localidad: textoOpcional(entrada.localidad),
    limiteCredito: entrada.limiteCredito ?? 0,
    email: textoOpcional(entrada.email),
    direccion: textoOpcional(entrada.direccion),
    tipo: entrada.tipo,
    listaPrecioId: entrada.listaPrecioId ?? null,
    notas: textoOpcional(entrada.notas),
  };
}

/** Campos del proveedor. */
function camposProveedor(entrada: EntradaProveedor) {
  return {
    codigo: textoOpcional(entrada.codigo)?.toUpperCase() ?? null,
    nombre: exigirNombre(entrada.nombre),
    cuit: cuitNormalizado(entrada.cuit),
    iibb: textoOpcional(entrada.iibb),
    telefono: textoOpcional(entrada.telefono),
    celular: textoOpcional(entrada.celular),
    localidad: textoOpcional(entrada.localidad),
    email: textoOpcional(entrada.email),
    direccion: textoOpcional(entrada.direccion),
    notas: textoOpcional(entrada.notas),
  };
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

/** Familia y proveedor habitual, si vienen, tienen que existir. */
function validarReferencias(entrada: EntradaArticulo): void {
  const db = obtenerDb();
  if (entrada.familiaId != null) {
    const familia = db.select({ id: familias.id }).from(familias).where(eq(familias.id, entrada.familiaId)).get();
    if (!familia) throw new ErrorNoEncontrado('familia', entrada.familiaId);
  }
  if (entrada.proveedorHabitualId != null) {
    const proveedor = db
      .select({ id: proveedores.id })
      .from(proveedores)
      .where(eq(proveedores.id, entrada.proveedorHabitualId))
      .get();
    if (!proveedor) throw new ErrorNoEncontrado('proveedor', entrada.proveedorHabitualId);
  }
}

/** El codigo de barras identifica al articulo en la balanza y el lector: unico. */
function validarCodigoBarras(codigoBarras: string | null | undefined, idPropio: number | null): void {
  const limpio = codigoBarras?.trim();
  if (!limpio) return;
  const db = obtenerDb();
  const condicion =
    idPropio === null
      ? eq(articulos.codigoBarras, limpio)
      : and(eq(articulos.codigoBarras, limpio), ne(articulos.id, idPropio));
  const duplicado = db.select({ codigo: articulos.codigo }).from(articulos).where(condicion).get();
  if (duplicado) {
    throw new ErrorConflicto(`El codigo de barras ${limpio} ya lo usa el articulo ${duplicado.codigo}.`);
  }
}

export const maestrosServicio = {
  /* ------------------------------- Clientes -------------------------------- */

  crearCliente(entrada: EntradaCliente): ClienteVista {
    return ejecutarSeguro('crear un cliente', () => {
      const db = obtenerDb();
      verificarCuitUnico(cuitNormalizado(entrada.cuit), clientes, null, 'el cliente');
      const fila = db
        .insert(clientes)
        .values({ ...camposCliente(entrada), activo: true })
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
      verificarCuitUnico(cuitNormalizado(entrada.cuit), clientes, id, 'el cliente');
      db.update(clientes).set(camposCliente(entrada)).where(eq(clientes.id, id)).run();
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
      verificarCuitUnico(cuitNormalizado(entrada.cuit), proveedores, null, 'el proveedor');
      const fila = db
        .insert(proveedores)
        .values({ ...camposProveedor(entrada), activo: true })
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
      verificarCuitUnico(cuitNormalizado(entrada.cuit), proveedores, id, 'el proveedor');
      db.update(proveedores).set(camposProveedor(entrada)).where(eq(proveedores.id, id)).run();
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
      validarReferencias(entrada);
      validarCodigoBarras(entrada.codigoBarras, null);

      const fila = db
        .insert(articulos)
        .values({ ...camposArticulo(entrada, codigo), activo: true })
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
      validarReferencias(entrada);
      validarCodigoBarras(entrada.codigoBarras, id);

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

      db.update(articulos).set(camposArticulo(entrada, codigo)).where(eq(articulos.id, id)).run();
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

  /* -------------------------------- Usuarios ------------------------------- */

  crearUsuario(entrada: EntradaUsuario): UsuarioVista {
    return ejecutarSeguro('crear un usuario', () => {
      const db = obtenerDb();
      const username = entrada.username.trim().toLowerCase();
      if (username.length < 3) {
        throw new ErrorValidacion('El nombre de usuario tiene que tener al menos 3 caracteres.');
      }
      if (!entrada.password || entrada.password.length < 4) {
        throw new ErrorValidacion('La contraseña tiene que tener al menos 4 caracteres.');
      }
      const duplicado = db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.username, username)).get();
      if (duplicado) throw new ErrorConflicto(`Ya existe el usuario ${username}.`);

      const fila = db
        .insert(usuarios)
        .values({
          username,
          // El hash es lo unico que se guarda: la contraseña en claro no toca la base.
          passwordHash: bcrypt.hashSync(entrada.password, 10),
          rol: entrada.rol,
          activo: true,
        })
        .returning({ id: usuarios.id })
        .all()[0];
      if (!fila) throw new ErrorValidacion('La base no devolvio el usuario insertado.');
      return vistaUsuario(fila.id);
    });
  },

  /** Actualiza rol y, solo si viene una nueva, la contraseña. */
  actualizarUsuario(id: number, entrada: EntradaUsuario): UsuarioVista {
    return ejecutarSeguro('actualizar un usuario', () => {
      const db = obtenerDb();
      const actual = db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, id)).get();
      if (!actual) throw new ErrorNoEncontrado('usuario', id);

      const username = entrada.username.trim().toLowerCase();
      const duplicado = db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(eq(usuarios.username, username), ne(usuarios.id, id)))
        .get();
      if (duplicado) throw new ErrorConflicto(`Ya existe otro usuario llamado ${username}.`);

      if (entrada.password !== undefined && entrada.password !== '' && entrada.password.length < 4) {
        throw new ErrorValidacion('La contraseña tiene que tener al menos 4 caracteres.');
      }

      db.update(usuarios)
        .set({
          username,
          rol: entrada.rol,
          // Password vacio = "no la cambies": editar el rol no puede obligar a
          // reescribir la contraseña.
          ...(entrada.password !== undefined && entrada.password !== ''
            ? { passwordHash: bcrypt.hashSync(entrada.password, 10) }
            : {}),
        })
        .where(eq(usuarios.id, id))
        .run();
      return vistaUsuario(id);
    });
  },

  cambiarActivoUsuario(id: number, activo: boolean): UsuarioVista {
    return ejecutarSeguro('cambiar el estado de un usuario', () => {
      const db = obtenerDb();
      const usuario = db
        .select({ id: usuarios.id, username: usuarios.username, rol: usuarios.rol })
        .from(usuarios)
        .where(eq(usuarios.id, id))
        .get();
      if (!usuario) throw new ErrorNoEncontrado('usuario', id);

      if (!activo && usuario.rol === 'admin') {
        // Quedarse sin ningun administrador activo deja el sistema sin quien
        // administre usuarios: no hay forma de volver atras desde la interfaz.
        const otrosAdmins =
          db
            .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
            .from(usuarios)
            .where(and(eq(usuarios.rol, 'admin'), eq(usuarios.activo, true), ne(usuarios.id, id)))
            .get()?.n ?? 0;
        if (otrosAdmins === 0) {
          throw new ErrorReglaNegocio(
            `${usuario.username} es el unico administrador activo: no se puede dar de baja. ` +
              'Crea otro administrador primero.',
          );
        }
      }

      db.update(usuarios).set({ activo }).where(eq(usuarios.id, id)).run();
      return vistaUsuario(id);
    });
  },

  /* ------------------------------ Vendedores ------------------------------ */

  crearVendedor(entrada: {
    nombre: string;
    telefono?: string | null;
    cuit?: string | null;
    clienteId?: number | null;
    notas?: string | null;
  }): { id: number } {
    return ejecutarSeguro('crear un vendedor', () => {
      const nombre = entrada.nombre.trim();
      if (nombre === '') throw new ErrorValidacion('El vendedor necesita un nombre.');
      const existente = obtenerDb().select().from(vendedores).where(eq(vendedores.nombre, nombre)).get();
      if (existente) throw new ErrorReglaNegocio(`Ya existe un vendedor llamado ${nombre}.`);
      const fila = obtenerDb()
        .insert(vendedores)
        .values({
          nombre,
          telefono: entrada.telefono?.trim() || null,
          cuit: cuitNormalizado(entrada.cuit),
          clienteId: entrada.clienteId ?? null,
          notas: entrada.notas?.trim() || null,
          activo: true,
        })
        .returning({ id: vendedores.id })
        .all()[0]!;
      emitir('maestros:cambio');
      return { id: fila.id };
    });
  },

  actualizarVendedor(
    id: number,
    entrada: {
      nombre: string;
      telefono?: string | null;
      cuit?: string | null;
      clienteId?: number | null;
      notas?: string | null;
      activo: boolean;
    },
  ): { id: number } {
    return ejecutarSeguro('actualizar un vendedor', () => {
      const fila = obtenerDb().select().from(vendedores).where(eq(vendedores.id, id)).get();
      if (!fila) throw new ErrorNoEncontrado('vendedor', id);
      const nombre = entrada.nombre.trim();
      if (nombre === '') throw new ErrorValidacion('El vendedor necesita un nombre.');
      obtenerDb()
        .update(vendedores)
        .set({
          nombre,
          telefono: entrada.telefono?.trim() || null,
          cuit: cuitNormalizado(entrada.cuit),
          clienteId: entrada.clienteId ?? null,
          notas: entrada.notas?.trim() || null,
          activo: entrada.activo,
        })
        .where(eq(vendedores.id, id))
        .run();
      emitir('maestros:cambio');
      return { id };
    });
  },
};

function vistaUsuario(id: number): UsuarioVista {
  const fila = obtenerDb()
    .select({
      id: usuarios.id,
      username: usuarios.username,
      rol: usuarios.rol,
      activo: usuarios.activo,
    })
    .from(usuarios)
    .where(eq(usuarios.id, id))
    .get();
  if (!fila) throw new ErrorNoEncontrado('usuario', id);
  return fila;
}
