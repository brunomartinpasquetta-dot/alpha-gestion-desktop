/**
 * Servicio de compras: el espejo de las ventas del lado del proveedor.
 *
 * Una compra RECIBIDA produce, en UNA transaccion:
 *   - movimientos_stock: ingreso positivo por item (documento 'compra').
 *   - forma_pago cuenta_corriente -> asiento 'haber' al proveedor (le debemos).
 *   - forma_pago contado -> egreso de la caja abierta; sin caja abierta se avisa.
 *   - costo_actual del articulo actualizado con el ultimo costo pagado.
 *
 * La cantidad se carga como se compra (2 bolsas) y se convierte a unidad base
 * con el factor (bolsa de 25 kg -> 25000 g): el stock vive SIEMPRE en unidad
 * base, y quien compra piensa en bultos.
 *
 * Anular revierte con asientos espejo, igual que en ventas: el ledger no se edita.
 */

import { and, eq, sql } from 'drizzle-orm';

import type { CompraVista, EntradaNuevaCompra, ResultadoCompra } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import {
  articulos,
  cajaMovimientos,
  cajas,
  compraItems,
  compras,
  cuentasCorrientes,
  movimientosStock,
  proveedores,
} from '../db/schema';
import {
  ejecutarSeguro,
  ErrorNoEncontrado,
  ErrorReglaNegocio,
  ErrorValidacion,
} from '../dominio/errores';
import { emitir } from '../eventos';
import { calcularSubtotalCentavos, esCentavosValido, redondearCantidad } from '../utiles/numeros';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

function armarVista(tx: Tx, compraId: number): CompraVista {
  const fila = tx
    .select({
      id: compras.id,
      fecha: compras.fecha,
      proveedorId: compras.proveedorId,
      proveedorNombre: proveedores.nombre,
      total: compras.total,
      formaPago: compras.formaPago,
      // La anulacion vive en su propia columna: al usuario se le muestra como estado.
      estado: sql<'pendiente' | 'recibida' | 'anulada'>`CASE WHEN ${compras.anulada} THEN 'anulada' ELSE ${compras.estado} END`,
      cantidadItems: sql<number>`(SELECT COUNT(*) FROM compra_items WHERE compra_id = ${compras.id})`.mapWith(Number),
      notas: compras.notas,
    })
    .from(compras)
    .innerJoin(proveedores, eq(proveedores.id, compras.proveedorId))
    .where(eq(compras.id, compraId))
    .get();
  if (!fila) throw new ErrorNoEncontrado('compra', compraId);
  return fila;
}

function cajaAbierta(tx: Tx): { id: number } | undefined {
  return tx
    .select({ id: cajas.id })
    .from(cajas)
    .where(eq(cajas.estado, 'abierta'))
    .orderBy(sql`${cajas.fechaApertura} DESC`)
    .get();
}

export const comprasServicio = {
  crearCompra(entrada: EntradaNuevaCompra): ResultadoCompra {
    if (entrada.items.length === 0) {
      throw new ErrorValidacion('La compra tiene que tener al menos un articulo.');
    }

    const items = entrada.items.map((item) => {
      const cantidadCompra = redondearCantidad(item.cantidadCompra);
      const factor = redondearCantidad(item.factorConversion);
      if (!Number.isFinite(cantidadCompra) || cantidadCompra <= 0) {
        throw new ErrorValidacion(`La cantidad del articulo ${item.articuloId} tiene que ser mayor a cero.`);
      }
      if (!Number.isFinite(factor) || factor <= 0) {
        throw new ErrorValidacion(
          `El factor de conversion del articulo ${item.articuloId} tiene que ser mayor a cero.`,
        );
      }
      if (!esCentavosValido(item.costoUnitario)) {
        throw new ErrorValidacion(
          `El costo del articulo ${item.articuloId} tiene que ser un entero de centavos (>= 0).`,
        );
      }
      const cantidadBase = redondearCantidad(cantidadCompra * factor);
      return {
        articuloId: item.articuloId,
        cantidadCompra,
        unidadCompraId: item.unidadCompraId,
        factorConversion: factor,
        cantidadBase,
        // El costo se carga POR UNIDAD BASE: asi el ledger y el costeo hablan el
        // mismo idioma sin recalcular nada despues.
        costoUnitario: item.costoUnitario,
        subtotal: calcularSubtotalCentavos(item.costoUnitario, cantidadBase),
      };
    });

    const resultado = ejecutarSeguro('registrar una compra', () =>
      obtenerDb().transaction((tx) => {
        const advertencias: string[] = [];
        const ahora = new Date().toISOString();

        const proveedor = tx
          .select({ id: proveedores.id, activo: proveedores.activo, nombre: proveedores.nombre })
          .from(proveedores)
          .where(eq(proveedores.id, entrada.proveedorId))
          .get();
        if (!proveedor) throw new ErrorNoEncontrado('proveedor', entrada.proveedorId);
        if (!proveedor.activo) {
          throw new ErrorReglaNegocio(`${proveedor.nombre} esta dado de baja: no se le puede comprar.`);
        }

        for (const item of items) {
          const articulo = tx
            .select({ id: articulos.id, nombre: articulos.nombre, activo: articulos.activo })
            .from(articulos)
            .where(eq(articulos.id, item.articuloId))
            .get();
          if (!articulo) throw new ErrorNoEncontrado('articulo', item.articuloId);
          if (!articulo.activo) {
            throw new ErrorReglaNegocio(`${articulo.nombre} esta dado de baja: no se puede comprar.`);
          }
        }

        const total = items.reduce((suma, item) => suma + item.subtotal, 0);

        const compra = tx
          .insert(compras)
          .values({
            proveedorId: entrada.proveedorId,
            fecha: ahora,
            total,
            formaPago: entrada.formaPago,
            estado: 'recibida',
            notas: entrada.notas?.trim() || null,
          })
          .returning({ id: compras.id })
          .all()[0];
        if (!compra) throw new ErrorValidacion('La base no devolvio la compra insertada.');

        for (const item of items) {
          tx.insert(compraItems)
            .values({
              compraId: compra.id,
              articuloId: item.articuloId,
              cantidadCompra: item.cantidadCompra,
              unidadCompraId: item.unidadCompraId,
              factorConversion: item.factorConversion,
              cantidadBase: item.cantidadBase,
              costoUnitario: item.costoUnitario,
              subtotal: item.subtotal,
            })
            .run();

          tx.insert(movimientosStock)
            .values({
              articuloId: item.articuloId,
              tipo: 'compra',
              cantidad: item.cantidadBase,
              costoUnitario: item.costoUnitario,
              documentoTipo: 'compra',
              documentoId: compra.id,
              fecha: ahora,
              notas: `Compra #${compra.id}`,
            })
            .run();

          // Ultimo costo pagado: es lo que vale reponer hoy.
          tx.update(articulos)
            .set({ costoActual: item.costoUnitario })
            .where(eq(articulos.id, item.articuloId))
            .run();
        }

        if (entrada.formaPago === 'cuenta_corriente') {
          tx.insert(cuentasCorrientes)
            .values({
              entidadTipo: 'proveedor',
              entidadId: entrada.proveedorId,
              tipoMovimiento: 'haber',
              monto: total,
              documentoTipo: 'compra',
              documentoId: compra.id,
              fecha: ahora,
              notas: `Compra #${compra.id} en cuenta corriente`,
            })
            .run();
        } else {
          const caja = cajaAbierta(tx);
          if (caja === undefined) {
            advertencias.push(
              'No hay caja abierta: la compra de contado quedo registrada pero el pago no salio de ninguna caja.',
            );
          } else {
            tx.insert(cajaMovimientos)
              .values({
                cajaId: caja.id,
                tipo: 'egreso',
                concepto: `Compra #${compra.id} de contado`,
                monto: total,
                documentoTipo: 'compra',
                documentoId: compra.id,
                fecha: ahora,
                notas: null,
              })
              .run();
          }
        }

        return { compra: armarVista(tx, compra.id), advertencias };
      }),
    );

    emitir('compras:cambio');
    return resultado;
  },

  /** Revierte una compra recibida con asientos espejo. No borra nada. */
  anularCompra(compraId: number): ResultadoCompra {
    const resultado = ejecutarSeguro('anular una compra', () =>
      obtenerDb().transaction((tx) => {
        const compra = tx.select().from(compras).where(eq(compras.id, compraId)).get();
        if (!compra) throw new ErrorNoEncontrado('compra', compraId);
        if (compra.anulada) throw new ErrorReglaNegocio('La compra ya esta anulada.');
        if (compra.estado !== 'recibida') {
          throw new ErrorReglaNegocio(`Una compra ${compra.estado} no se puede anular.`);
        }

        const ahora = new Date().toISOString();
        const items = tx.select().from(compraItems).where(eq(compraItems.compraId, compraId)).all();
        const advertencias: string[] = [];

        for (const item of items) {
          // La mercaderia vuelve al proveedor: sale del stock.
          const saldo =
            tx
              .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
              .from(movimientosStock)
              .where(eq(movimientosStock.articuloId, item.articuloId))
              .get()?.s ?? 0;
          if (saldo - item.cantidadBase < 0) {
            const nombre =
              tx.select({ n: articulos.nombre }).from(articulos).where(eq(articulos.id, item.articuloId)).get()?.n ??
              `articulo ${item.articuloId}`;
            advertencias.push(
              `${nombre} queda con stock negativo: parte de lo comprado ya se consumio o se vendio.`,
            );
          }
          tx.insert(movimientosStock)
            .values({
              articuloId: item.articuloId,
              tipo: 'ajuste',
              cantidad: -item.cantidadBase,
              costoUnitario: null,
              documentoTipo: 'compra',
              documentoId: compraId,
              fecha: ahora,
              notas: `Anulacion de compra #${compraId}`,
            })
            .run();
        }

        if (compra.formaPago === 'cuenta_corriente') {
          tx.insert(cuentasCorrientes)
            .values({
              entidadTipo: 'proveedor',
              entidadId: compra.proveedorId,
              tipoMovimiento: 'debe',
              monto: compra.total,
              documentoTipo: 'compra',
              documentoId: compraId,
              fecha: ahora,
              notas: `Anulacion de compra #${compraId}`,
            })
            .run();
        }

        const egresoOriginal = tx
          .select({ id: cajaMovimientos.id })
          .from(cajaMovimientos)
          .where(
            and(
              eq(cajaMovimientos.documentoTipo, 'compra'),
              eq(cajaMovimientos.documentoId, compraId),
              eq(cajaMovimientos.tipo, 'egreso'),
            ),
          )
          .get();
        if (egresoOriginal !== undefined) {
          const caja = cajaAbierta(tx);
          if (caja === undefined) {
            advertencias.push('No hay caja abierta: la devolucion del dinero no quedo asentada.');
          } else {
            tx.insert(cajaMovimientos)
              .values({
                cajaId: caja.id,
                tipo: 'ingreso',
                concepto: `Anulacion de compra #${compraId}`,
                monto: compra.total,
                documentoTipo: 'compra',
                documentoId: compraId,
                fecha: ahora,
                notas: null,
              })
              .run();
          }
        }

        tx.update(compras).set({ anulada: true }).where(eq(compras.id, compraId)).run();
        return { compra: armarVista(tx, compraId), advertencias };
      }),
    );

    emitir('compras:cambio');
    return resultado;
  },
};
