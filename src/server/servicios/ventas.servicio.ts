/**
 * Servicio de ventas: el documento que cierra el circuito comercial.
 *
 * La venta nace ENTREGADA porque registra un hecho —la mercaderia salio— y en
 * UNA transaccion produce todos sus efectos:
 *   - movimientos_stock: egreso negativo por cada item (documento 'venta').
 *   - forma_pago cuenta_corriente -> asiento 'debe' al cliente (exige cliente).
 *   - forma_pago contado -> ingreso a la caja abierta; si no hay caja abierta,
 *     la venta se registra igual y se AVISA (la plata entro; el arqueo del dia
 *     lo va a mostrar como diferencia si nadie abre caja).
 *   - si viene de un pedido 'listo', el pedido pasa a 'entregado' en el acto.
 *
 * ANULAR no borra nada: revierte con asientos espejo (tipo 'ajuste' en stock,
 * 'haber' en CC, egreso en caja) que dejan rastro. El ledger nunca se edita.
 */

import { appendFileSync } from 'node:fs';
import path from 'node:path';

import { and, eq, sql } from 'drizzle-orm';

import type { EntradaNuevaVenta, ResultadoVenta, VentaVista } from '../../compartido/contratos';
import { obtenerDb, obtenerRutaDb } from '../db/conexion';
import {
  articulos,
  cajaMovimientos,
  cajas,
  clientes,
  comprobantes,
  cuentasCorrientes,
  movimientosStock,
  pedidos,
  ventaItems,
  ventas,
} from '../db/schema';
import { fiscalServicio, type DatosComprobanteAprobado } from './fiscal.servicio';
import {
  ejecutarSeguro,
  ErrorNoEncontrado,
  ErrorReglaNegocio,
  ErrorValidacion,
} from '../dominio/errores';
import { emitir } from '../eventos';
import { calcularSubtotalCentavos, esCentavosValido, redondearCantidad } from '../utiles/numeros';

type Tx = Parameters<Parameters<ReturnType<typeof obtenerDb>['transaction']>[0]>[0];

/** "FB 00001-00000042": como se muestra un comprobante en cualquier grilla. */
export function etiquetaComprobante(letra: string, puntoVenta: number, numero: number): string {
  return `F${letra} ${String(puntoVenta).padStart(5, '0')}-${String(numero).padStart(8, '0')}`;
}

/** Vista de la venta recien escrita, con cliente y comprobante resueltos. */
function armarVista(tx: Tx, ventaId: number): VentaVista {
  const fila = tx
    .select({
      id: ventas.id,
      fecha: ventas.fecha,
      clienteId: ventas.clienteId,
      clienteNombre: clientes.nombre,
      total: ventas.total,
      formaPago: ventas.formaPago,
      estado: ventas.estado,
      pedidoId: ventas.pedidoId,
      cantidadItems: sql<number>`(SELECT COUNT(*) FROM venta_items WHERE venta_id = ${ventas.id})`.mapWith(Number),
      notas: ventas.notas,
      letra: comprobantes.letra,
      puntoVenta: comprobantes.puntoVenta,
      numero: comprobantes.numero,
      cae: comprobantes.cae,
    })
    .from(ventas)
    .leftJoin(clientes, eq(clientes.id, ventas.clienteId))
    .leftJoin(comprobantes, eq(comprobantes.ventaId, ventas.id))
    .where(eq(ventas.id, ventaId))
    .get();
  if (!fila) throw new ErrorNoEncontrado('venta', ventaId);
  const { letra, puntoVenta, numero, cae, ...venta } = fila;
  return {
    ...venta,
    comprobanteEtiqueta:
      letra !== null && puntoVenta !== null && numero !== null
        ? etiquetaComprobante(letra, puntoVenta, numero)
        : null,
    cae,
  };
}

/** Caja abierta mas reciente, o undefined. */
function cajaAbierta(tx: Tx): { id: number } | undefined {
  return tx
    .select({ id: cajas.id })
    .from(cajas)
    .where(eq(cajas.estado, 'abierta'))
    .orderBy(sql`${cajas.fechaApertura} DESC`)
    .get();
}

/**
 * Deja constancia en disco de un CAE que ARCA autorizo pero cuya venta no se
 * pudo escribir. Nunca lanza: si tambien falla escribir el log, el error
 * original tiene que seguir su camino hacia el operador.
 */
function registrarComprobanteHuerfano(comprobante: DatosComprobanteAprobado, causa: unknown): void {
  try {
    const linea = JSON.stringify({
      cuando: new Date().toISOString(),
      comprobante: etiquetaComprobante(comprobante.letra, comprobante.puntoVenta, comprobante.numero),
      cae: comprobante.cae,
      caeVencimiento: comprobante.caeVencimiento,
      receptor: comprobante.receptorNombre,
      docNumero: comprobante.docNumero,
      total: comprobante.total,
      motivo: causa instanceof Error ? causa.message : String(causa),
    });
    appendFileSync(
      path.join(path.dirname(obtenerRutaDb()), 'comprobantes-huerfanos.log'),
      `${linea}\n`,
      'utf8',
    );
  } catch {
    // Si ni el log se puede escribir, igual sube el error original.
  }
}

export const ventasServicio = {
  /**
   * Registra la venta y, si se pidio factura, emite el comprobante fiscal.
   *
   * El orden importa: se valida todo, se pide el CAE a ARCA y RECIEN AHI se
   * abre la transaccion. Si ARCA rechaza, la venta no llega a existir y no se
   * consumio numeracion.
   *
   * La ventana peligrosa es la inversa: que ARCA apruebe y despues falle la
   * escritura local. Ese CAE ya existe ante ARCA y no se puede anular (solo se
   * cancela con nota de credito), asi que se vuelca a `comprobantes-huerfanos.log`
   * junto a la base y el error le dice al operador que hay un comprobante emitido
   * sin venta. Sin ese registro, el comprobante desaparece sin dejar rastro.
   */
  async crearVenta(entrada: EntradaNuevaVenta): Promise<ResultadoVenta> {
    if (entrada.items.length === 0) {
      throw new ErrorValidacion('La venta tiene que tener al menos un articulo.');
    }

    // Cantidades y precios validados ANTES de abrir la transaccion.
    const items = entrada.items.map((item) => {
      const cantidad = redondearCantidad(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new ErrorValidacion(`La cantidad del articulo ${item.articuloId} tiene que ser mayor a cero.`);
      }
      if (!esCentavosValido(item.precioUnitario)) {
        throw new ErrorValidacion(
          `El precio del articulo ${item.articuloId} tiene que ser un entero de centavos (>= 0).`,
        );
      }
      return {
        articuloId: item.articuloId,
        cantidad,
        precioUnitario: item.precioUnitario,
        subtotal: calcularSubtotalCentavos(item.precioUnitario, cantidad),
      };
    });

    const clienteId = entrada.clienteId ?? null;
    if (entrada.formaPago === 'cuenta_corriente' && clienteId === null) {
      throw new ErrorReglaNegocio(
        'Una venta en cuenta corriente necesita un cliente: no se le puede fiar al mostrador.',
      );
    }

    /* ------------------- Comprobante fiscal, ANTES de escribir ------------------ */

    const tipoComprobante = entrada.comprobante ?? 'remito';
    const totalPrevisto = items.reduce((suma, item) => suma + item.subtotal, 0);
    let comprobante: DatosComprobanteAprobado | null = null;

    if (tipoComprobante !== 'remito') {
      const db = obtenerDb();
      const receptor =
        clienteId === null
          ? null
          : db
              .select({ nombre: clientes.nombre, cuit: clientes.cuit })
              .from(clientes)
              .where(eq(clientes.id, clienteId))
              .get();
      if (clienteId !== null && !receptor) throw new ErrorNoEncontrado('cliente', clienteId);

      // Si ARCA rechaza, esto lanza y no se escribio una sola fila.
      comprobante = await fiscalServicio.emitirComprobante({
        tipo: tipoComprobante,
        totalCentavos: totalPrevisto,
        receptor: {
          nombre: receptor?.nombre ?? 'Consumidor Final',
          cuit: receptor?.cuit ?? null,
          condicionIva: entrada.condicionIvaReceptor,
        },
      });
    }

    const registrar = (): ResultadoVenta =>
      ejecutarSeguro('registrar una venta', () =>
        obtenerDb().transaction((tx) => {
          const advertencias: string[] = [];
          const ahora = new Date().toISOString();

          // Cliente y productos existentes y vendibles.
          if (clienteId !== null) {
            const cliente = tx.select({ id: clientes.id }).from(clientes).where(eq(clientes.id, clienteId)).get();
            if (!cliente) throw new ErrorNoEncontrado('cliente', clienteId);
          }
          for (const item of items) {
            const articulo = tx
              .select({ id: articulos.id, nombre: articulos.nombre, tipo: articulos.tipo, activo: articulos.activo })
              .from(articulos)
              .where(eq(articulos.id, item.articuloId))
              .get();
            if (!articulo) throw new ErrorNoEncontrado('articulo', item.articuloId);
            if (articulo.tipo !== 'producto_terminado' || !articulo.activo) {
              throw new ErrorReglaNegocio(`${articulo.nombre} no es un producto terminado activo: no se puede vender.`);
            }
          }

          // Pedido asociado: tiene que estar listo, y pasa a entregado.
          const pedidoId = entrada.pedidoId ?? null;
          if (pedidoId !== null) {
            const pedido = tx.select({ estado: pedidos.estado }).from(pedidos).where(eq(pedidos.id, pedidoId)).get();
            if (!pedido) throw new ErrorNoEncontrado('pedido', pedidoId);
            if (pedido.estado !== 'listo') {
              throw new ErrorReglaNegocio(
                `El pedido #${pedidoId} esta ${pedido.estado}: solo un pedido listo se entrega con la venta.`,
              );
            }
            tx.update(pedidos).set({ estado: 'entregado' }).where(eq(pedidos.id, pedidoId)).run();
          }

          const total = items.reduce((suma, item) => suma + item.subtotal, 0);

          const venta = tx
            .insert(ventas)
            .values({
              clienteId,
              fecha: ahora,
              total,
              formaPago: entrada.formaPago,
              pedidoId,
              estado: 'entregada',
              notas: entrada.notas?.trim() || null,
            })
            .returning({ id: ventas.id })
            .all()[0];
          if (!venta) throw new ErrorValidacion('La base no devolvio la venta insertada.');

          // El CAE ya esta aprobado: aca solo se guarda lo que ARCA autorizo.
          if (comprobante !== null) {
            tx.insert(comprobantes).values({ ...comprobante, ventaId: venta.id }).run();
            if (comprobante.observaciones !== null) {
              advertencias.push(`ARCA aprobo el comprobante con observaciones: ${comprobante.observaciones}`);
            }
          }

          for (const item of items) {
            tx.insert(ventaItems)
              .values({
                ventaId: venta.id,
                articuloId: item.articuloId,
                cantidad: item.cantidad,
                precioUnitario: item.precioUnitario,
                subtotal: item.subtotal,
              })
              .run();

            // Egreso de stock, con aviso si queda negativo (la venta fisica ya paso).
            const saldo =
              tx
                .select({ s: sql<number>`COALESCE(SUM(${movimientosStock.cantidad}), 0)`.mapWith(Number) })
                .from(movimientosStock)
                .where(eq(movimientosStock.articuloId, item.articuloId))
                .get()?.s ?? 0;
            if (saldo - item.cantidad < 0) {
              const nombre =
                tx.select({ n: articulos.nombre }).from(articulos).where(eq(articulos.id, item.articuloId)).get()?.n ??
                `articulo ${item.articuloId}`;
              advertencias.push(
                `${nombre} queda con stock negativo (${redondearCantidad(saldo - item.cantidad)}): revisa produccion o compras sin cargar.`,
              );
            }
            tx.insert(movimientosStock)
              .values({
                articuloId: item.articuloId,
                tipo: 'venta',
                cantidad: -item.cantidad,
                costoUnitario: null,
                documentoTipo: 'venta',
                documentoId: venta.id,
                fecha: ahora,
                notas: `Venta #${venta.id}`,
              })
              .run();
          }

          // Efecto financiero segun la forma de pago.
          if (entrada.formaPago === 'cuenta_corriente' && clienteId !== null) {
            tx.insert(cuentasCorrientes)
              .values({
                entidadTipo: 'cliente',
                entidadId: clienteId,
                tipoMovimiento: 'debe',
                monto: total,
                documentoTipo: 'venta',
                documentoId: venta.id,
                fecha: ahora,
                notas: `Venta #${venta.id} en cuenta corriente`,
              })
              .run();
          } else {
            const caja = cajaAbierta(tx);
            if (caja === undefined) {
              advertencias.push(
                'No hay caja abierta: la venta de contado quedo registrada pero el efectivo no entro a ninguna caja.',
              );
            } else {
              tx.insert(cajaMovimientos)
                .values({
                  cajaId: caja.id,
                  tipo: 'ingreso',
                  concepto: `Venta #${venta.id} de contado`,
                  monto: total,
                  documentoTipo: 'venta',
                  documentoId: venta.id,
                  fecha: ahora,
                  notas: null,
                })
                .run();
            }
          }

          return { venta: armarVista(tx, venta.id), advertencias };
        }),
      );

    let resultado: ResultadoVenta;
    try {
      resultado = registrar();
    } catch (error) {
      if (comprobante !== null) {
        registrarComprobanteHuerfano(comprobante, error);
        throw new ErrorReglaNegocio(
          `ARCA autorizo la ${comprobante.letra === 'A' ? 'Factura A' : 'Factura B'} ` +
            `${etiquetaComprobante(comprobante.letra, comprobante.puntoVenta, comprobante.numero)} ` +
            `(CAE ${comprobante.cae}) pero la venta no se pudo registrar. El comprobante EXISTE ante ARCA: ` +
            'quedo anotado en comprobantes-huerfanos.log y hay que regularizarlo con una nota de credito.',
        );
      }
      throw error;
    }

    emitir('ventas:cambio');
    emitir('pedidos:cambio');
    return resultado;
  },

  /** Anula una venta entregada revirtiendo TODOS sus efectos con asientos espejo. */
  anularVenta(ventaId: number): ResultadoVenta {
    const resultado = ejecutarSeguro('anular una venta', () =>
      obtenerDb().transaction((tx) => {
        const venta = tx.select().from(ventas).where(eq(ventas.id, ventaId)).get();
        if (!venta) throw new ErrorNoEncontrado('venta', ventaId);
        if (venta.estado !== 'entregada') {
          throw new ErrorReglaNegocio(`Una venta ${venta.estado} no se puede anular.`);
        }

        const ahora = new Date().toISOString();
        const items = tx.select().from(ventaItems).where(eq(ventaItems.ventaId, ventaId)).all();

        // Stock: vuelve lo que salio, como ajuste con rastro al documento.
        for (const item of items) {
          tx.insert(movimientosStock)
            .values({
              articuloId: item.articuloId,
              tipo: 'ajuste',
              cantidad: item.cantidad,
              costoUnitario: null,
              documentoTipo: 'venta',
              documentoId: ventaId,
              fecha: ahora,
              notas: `Anulacion de venta #${ventaId}`,
            })
            .run();
        }

        // CC: espejo del debe.
        if (venta.formaPago === 'cuenta_corriente' && venta.clienteId !== null) {
          tx.insert(cuentasCorrientes)
            .values({
              entidadTipo: 'cliente',
              entidadId: venta.clienteId,
              tipoMovimiento: 'haber',
              monto: venta.total,
              documentoTipo: 'venta',
              documentoId: ventaId,
              fecha: ahora,
              notas: `Anulacion de venta #${ventaId}`,
            })
            .run();
        }

        // Caja: espejo del ingreso, SOLO si hubo ingreso original.
        const ingresoOriginal = tx
          .select({ id: cajaMovimientos.id, cajaId: cajaMovimientos.cajaId })
          .from(cajaMovimientos)
          .where(
            and(
              eq(cajaMovimientos.documentoTipo, 'venta'),
              eq(cajaMovimientos.documentoId, ventaId),
              eq(cajaMovimientos.tipo, 'ingreso'),
            ),
          )
          .get();
        const advertencias: string[] = [];
        if (ingresoOriginal !== undefined) {
          const caja = cajaAbierta(tx);
          if (caja === undefined) {
            advertencias.push('No hay caja abierta: la devolucion del efectivo no quedo asentada en ninguna caja.');
          } else {
            tx.insert(cajaMovimientos)
              .values({
                cajaId: caja.id,
                tipo: 'egreso',
                concepto: `Anulacion de venta #${ventaId}`,
                monto: venta.total,
                documentoTipo: 'venta',
                documentoId: ventaId,
                fecha: ahora,
                notas: null,
              })
              .run();
          }
        }

        // El comprobante fiscal NO se borra: un CAE emitido no se anula ante
        // ARCA, se cancela con una nota de credito. Se avisa para que quede claro.
        const fiscal = tx
          .select({ letra: comprobantes.letra, puntoVenta: comprobantes.puntoVenta, numero: comprobantes.numero })
          .from(comprobantes)
          .where(eq(comprobantes.ventaId, ventaId))
          .get();
        if (fiscal !== undefined) {
          advertencias.push(
            `La venta tenia ${etiquetaComprobante(fiscal.letra, fiscal.puntoVenta, fiscal.numero)} con CAE: ` +
              'ese comprobante sigue vigente ante ARCA y hay que cancelarlo con una nota de credito.',
          );
        }

        tx.update(ventas).set({ estado: 'anulada' }).where(eq(ventas.id, ventaId)).run();
        return { venta: armarVista(tx, ventaId), advertencias };
      }),
    );

    emitir('ventas:cambio');
    return resultado;
  },
};
