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
  cheques,
  clientes,
  comprobantes,
  cuentasCorrientes,
  mediosPago,
  movimientosStock,
  pedidoItems,
  pedidos,
  reservasStock,
  ventaItems,
  ventaPagos,
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
import { entregarReservasParciales, liberarReservasDePedido, stockDisponible } from './reservas.servicio';

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

    // La venta fiada no lleva pagos: el cobro es un acto posterior, por CC.
    if (entrada.formaPago === 'cuenta_corriente' && (entrada.pagos?.length ?? 0) > 0) {
      throw new ErrorReglaNegocio('Una venta en cuenta corriente no lleva pagos: se cobra despues.');
    }

    /* --------- Pagos validados ANTES del CAE: un rechazo local despues de
       ARCA quemaria un comprobante emitido sin venta. La transaccion los
       re-valida igual (defensa en profundidad), pero el camino normal muere
       aca, antes de gastar numeracion. --------- */
    if (entrada.formaPago === 'contado' && entrada.pagos && entrada.pagos.length > 0) {
      const sumaPrevista = entrada.pagos.reduce((acumulado, pago) => acumulado + pago.importe, 0);
      const totalTentativo = items.reduce((suma, item) => suma + item.subtotal, 0);
      if (sumaPrevista !== totalTentativo) {
        throw new ErrorValidacion(
          `Los pagos ($${(sumaPrevista / 100).toFixed(2)}) no coinciden con el total ($${(totalTentativo / 100).toFixed(2)}). No hay vuelto: carga lo cobrado en cada medio.`,
        );
      }
      const mediosPre = obtenerDb().select().from(mediosPago).all();
      for (const pago of entrada.pagos) {
        const medio = mediosPre.find((m) => m.id === pago.medioPagoId);
        if (!medio) throw new ErrorNoEncontrado('medio de pago', pago.medioPagoId);
        if (!medio.activo) throw new ErrorReglaNegocio(`El medio de pago ${medio.nombre} esta inactivo.`);
        if (medio.tipo === 'cheque' && (!pago.cheque?.numero?.trim() || !pago.cheque?.fechaPago?.trim())) {
          throw new ErrorValidacion(
            'El pago con cheque necesita numero y fecha de cobro para entrar a la cartera.',
          );
        }
      }
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
              .select({
                nombre: clientes.nombre,
                cuit: clientes.cuit,
                condicionIva: clientes.condicionIva,
              })
              .from(clientes)
              .where(eq(clientes.id, clienteId))
              .get();
      if (clienteId !== null && !receptor) throw new ErrorNoEncontrado('cliente', clienteId);

      // Lo vendido se agrupa por alicuota de IVA: cada articulo tiene la suya y
      // la factura las declara por separado.
      const alicuotaPorArticulo = new Map<number, number>();
      for (const item of items) {
        const fila = db
          .select({ alicuota: articulos.alicuotaIva })
          .from(articulos)
          .where(eq(articulos.id, item.articuloId))
          .get();
        alicuotaPorArticulo.set(item.articuloId, fila?.alicuota ?? 21);
      }
      const acumulado = new Map<number, number>();
      for (const item of items) {
        const alicuota = alicuotaPorArticulo.get(item.articuloId) ?? 21;
        acumulado.set(alicuota, (acumulado.get(alicuota) ?? 0) + item.subtotal);
      }
      const porAlicuota = [...acumulado.entries()].map(([alicuota, totalCentavos]) => ({
        alicuota,
        totalCentavos,
      }));

      // Si ARCA rechaza, esto lanza y no se escribio una sola fila.
      comprobante = await fiscalServicio.emitirComprobante({
        tipo: tipoComprobante,
        totalCentavos: totalPrevisto,
        porAlicuota,
        receptor: {
          nombre: receptor?.nombre ?? 'Consumidor Final',
          cuit: receptor?.cuit ?? null,
          // La condicion sale del CLIENTE; lo enviado en la venta solo la pisa
          // si viene explicito (una venta puntual a otra condicion).
          condicionIva: entrada.condicionIvaReceptor ?? receptor?.condicionIva,
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

          // Pedido asociado: tiene que estar listo. Si queda entregado o sigue
          // abierto se decide DESPUES de saber cuanto se llevo (entrega parcial).
          const pedidoId = entrada.pedidoId ?? null;
          if (pedidoId !== null) {
            const pedido = tx.select({ estado: pedidos.estado }).from(pedidos).where(eq(pedidos.id, pedidoId)).get();
            if (!pedido) throw new ErrorNoEncontrado('pedido', pedidoId);
            if (pedido.estado !== 'listo') {
              throw new ErrorReglaNegocio(
                `El pedido #${pedidoId} esta ${pedido.estado}: solo un pedido listo se entrega con la venta.`,
              );
            }
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

            // Vender por mostrador algo que estaba apartado para un pedido no se
            // bloquea —el que atiende sabe si puede hacerlo—, pero tiene que
            // avisar: del otro lado hay un cliente que lo encargo y lo espera.
            if (pedidoId === null) {
              const disponible = stockDisponible(tx, item.articuloId);
              if (disponible < item.cantidad) {
                const nombre =
                  tx.select({ n: articulos.nombre }).from(articulos).where(eq(articulos.id, item.articuloId)).get()?.n ??
                  `articulo ${item.articuloId}`;
                advertencias.push(
                  `${nombre}: se venden ${redondearCantidad(item.cantidad)} pero solo hay ${redondearCantidad(disponible)} sin comprometer. ` +
                    'El resto estaba reservado para un pedido.',
                );
              }
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

          /* ---------------- Entrega del pedido: total o parcial ----------------
             El cliente pidio 50 y puede llevarse 34. La venta consume las
             reservas SOLO por lo vendido (de la mas vieja a la mas nueva, para
             no perder el lote), y el destino del resto lo decide el operador:
              - 'liberar': no lo quiere mas -> vuelve a disponible, pedido cierra.
              - 'mantener' (default): lo retira despues -> sigue apartado y el
                pedido queda LISTO con el saldo, listo para una segunda venta. */
          if (pedidoId !== null) {
            for (const item of items) {
              entregarReservasParciales(tx, pedidoId, item.articuloId, item.cantidad, venta.id);
            }

            // Pendiente real por articulo: lo pedido menos TODO lo vendido de
            // este pedido (ventas previas no anuladas + esta).
            const pendientes = tx
              .select({
                articuloId: pedidoItems.articuloId,
                nombre: articulos.nombre,
                pedida: sql<number>`SUM(${pedidoItems.cantidad})`.mapWith(Number),
                vendida: sql<number>`COALESCE((
                  SELECT SUM(vi.cantidad) FROM venta_items vi
                  JOIN ventas v ON v.id = vi.venta_id
                  WHERE v.pedido_id = ${pedidoId} AND v.estado != 'anulada'
                    AND vi.articulo_id = ${pedidoItems.articuloId}
                ), 0)`.mapWith(Number),
              })
              .from(pedidoItems)
              .innerJoin(articulos, eq(articulos.id, pedidoItems.articuloId))
              .where(eq(pedidoItems.pedidoId, pedidoId))
              .groupBy(pedidoItems.articuloId)
              .all();

            const restante = pendientes
              .map((f) => ({ ...f, falta: redondearCantidad(Math.max(0, f.pedida - f.vendida)) }))
              .filter((f) => f.falta > 0);

            if (restante.length === 0) {
              // Se llevo todo: pedido entregado y cualquier reserva sobrante
              // (una tanda que rindio de mas) vuelve a la venta.
              liberarReservasDePedido(tx, pedidoId, 'Pedido entregado completo; sobrante a disponible');
              tx.update(pedidos).set({ estado: 'entregado' }).where(eq(pedidos.id, pedidoId)).run();
            } else if (entrada.restoPedido === 'liberar') {
              const detalle = restante.map((f) => `${f.falta} de ${f.nombre}`).join(', ');
              liberarReservasDePedido(tx, pedidoId, `El cliente no llevo el resto (${detalle})`);
              tx.update(pedidos).set({ estado: 'entregado' }).where(eq(pedidos.id, pedidoId)).run();
              advertencias.push(`Entrega parcial: ${detalle} vuelven a stock disponible.`);
            } else {
              const detalle = restante.map((f) => `${f.falta} de ${f.nombre}`).join(', ');
              advertencias.push(
                `Entrega parcial: quedan ${detalle} apartados. El pedido sigue LISTO para cuando los retire.`,
              );
            }
          }

          // Efecto financiero segun la forma de pago.
          if (entrada.formaPago === 'cuenta_corriente' && clienteId !== null) {
            // Fiar por encima del limite no se bloquea —la mercaderia ya salio—
            // pero el duenio tiene que enterarse en el momento, no al cierre.
            const cliente = tx
              .select({ nombre: clientes.nombre, limite: clientes.limiteCredito })
              .from(clientes)
              .where(eq(clientes.id, clienteId))
              .get();
            if (cliente !== undefined && cliente.limite > 0) {
              const saldoPrevio =
                tx
                  .select({
                    s: sql<number>`COALESCE(SUM(CASE WHEN ${cuentasCorrientes.tipoMovimiento} = 'debe' THEN ${cuentasCorrientes.monto} ELSE -${cuentasCorrientes.monto} END), 0)`.mapWith(Number),
                  })
                  .from(cuentasCorrientes)
                  .where(
                    and(
                      eq(cuentasCorrientes.entidadTipo, 'cliente'),
                      eq(cuentasCorrientes.entidadId, clienteId),
                    ),
                  )
                  .get()?.s ?? 0;
              const saldoNuevo = saldoPrevio + total;
              if (saldoNuevo > cliente.limite) {
                advertencias.push(
                  `${cliente.nombre} queda debiendo ${(saldoNuevo / 100).toFixed(2)} y su limite ` +
                    `es ${(cliente.limite / 100).toFixed(2)}.`,
                );
              }
            }

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
            /* ------------------- Pagos (mixtos) de la venta -------------------
               Modelo de StockFlow: la venta tiene N pagos y la suma es EXACTA
               (sin vuelto: el cajero carga lo cobrado en cada medio). Cada pago
               genera su ingreso de caja con el medio anotado; al arqueo fisico
               solo le importa el efectivo. El cheque, ademas, entra SOLO a la
               cartera con su venta como documento: eso es lo que StockFlow no
               tiene y aca si hace falta (los clientes pagan con diferidos). */
            const pagosEntrada =
              entrada.pagos && entrada.pagos.length > 0
                ? entrada.pagos
                : null;

            const medios = tx.select().from(mediosPago).all();
            const porId = new Map(medios.map((m) => [m.id, m]));

            const pagos =
              pagosEntrada ??
              (() => {
                // Sin detalle de pagos: todo al Efectivo (venta rapida de mostrador).
                const efectivo =
                  medios.find((m) => m.esEfectivoFisico && m.activo) ??
                  medios.find((m) => m.tipo === 'efectivo' && m.activo);
                if (!efectivo) {
                  throw new ErrorReglaNegocio(
                    'No hay un medio de pago Efectivo activo para registrar la venta.',
                  );
                }
                return [{ medioPagoId: efectivo.id, importe: total, referencia: null, cheque: null }];
              })();

            const suma = pagos.reduce((acumulado, pago) => acumulado + pago.importe, 0);
            if (suma > total) {
              throw new ErrorValidacion(
                `Los pagos ($${(suma / 100).toFixed(2)}) exceden el total de la venta ($${(total / 100).toFixed(2)}).`,
              );
            }
            if (suma < total) {
              throw new ErrorValidacion(
                `Los pagos ($${(suma / 100).toFixed(2)}) no cubren el total de la venta ($${(total / 100).toFixed(2)}). No hay vuelto: carga lo cobrado en cada medio.`,
              );
            }

            const caja = cajaAbierta(tx);
            if (caja === undefined) {
              advertencias.push(
                'No hay caja abierta: la venta quedo registrada pero la plata no entro a ninguna caja.',
              );
            }

            for (const pago of pagos) {
              const medio = porId.get(pago.medioPagoId);
              if (!medio) throw new ErrorNoEncontrado('medio de pago', pago.medioPagoId);
              if (!medio.activo) {
                throw new ErrorReglaNegocio(`El medio de pago ${medio.nombre} esta inactivo.`);
              }

              // Comision del medio: la absorbe el comercio, snapshot al momento.
              const comisionImporte = Math.round((pago.importe * medio.comisionPct) / 100);
              const netoImporte = pago.importe - comisionImporte;

              // Cheque: obligatorio el detalle, y entra SOLO a la cartera.
              let chequeId: number | null = null;
              if (medio.tipo === 'cheque') {
                const detalle = pago.cheque ?? null;
                if (detalle === null || !detalle.numero?.trim() || !detalle.fechaPago?.trim()) {
                  throw new ErrorValidacion(
                    'El pago con cheque necesita numero y fecha de cobro para entrar a la cartera.',
                  );
                }
                const contraparte =
                  clienteId === null
                    ? 'Mostrador'
                    : tx.select({ n: clientes.nombre }).from(clientes).where(eq(clientes.id, clienteId)).get()?.n ??
                      'Cliente';
                const chequeNuevo = tx
                  .insert(cheques)
                  .values({
                    tipo: 'recibido',
                    formato: detalle.formato ?? 'fisico',
                    numero: detalle.numero.trim(),
                    banco: detalle.banco?.trim() || null,
                    contraparte,
                    entidadTipo: clienteId === null ? null : 'cliente',
                    entidadId: clienteId,
                    importe: pago.importe,
                    fechaEmision: ahora.slice(0, 10),
                    fechaPago: detalle.fechaPago,
                    estado: 'en_cartera',
                    documentoTipo: 'venta',
                    documentoId: venta.id,
                    notas: `Recibido en la venta #${venta.id}`,
                  })
                  .returning({ id: cheques.id })
                  .all()[0];
                chequeId = chequeNuevo?.id ?? null;
              }

              tx.insert(ventaPagos)
                .values({
                  ventaId: venta.id,
                  medioPagoId: medio.id,
                  importe: pago.importe,
                  referencia: pago.referencia?.trim() || null,
                  comisionPct: medio.comisionPct,
                  comisionImporte,
                  netoImporte,
                  chequeId,
                })
                .run();

              if (caja !== undefined) {
                tx.insert(cajaMovimientos)
                  .values({
                    cajaId: caja.id,
                    tipo: 'ingreso',
                    concepto: medio.esEfectivoFisico
                      ? `Venta #${venta.id}`
                      : `Venta #${venta.id} — ${medio.nombre}`,
                    monto: pago.importe,
                    documentoTipo: 'venta',
                    documentoId: venta.id,
                    medioPagoId: medio.id,
                    fecha: ahora,
                    notas: null,
                  })
                  .run();
              }
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

        // Caja: espejo POR PAGO, cada egreso con su medio. Un solo egreso sin
        // medio rompia el arqueo: el ingreso de una transferencia esta excluido
        // del teorico del cajon, pero el egreso "pelado" contaba como efectivo
        // y aparecia plata fantasma al cierre.
        const advertencias: string[] = [];
        const pagosDeLaVenta = tx.select().from(ventaPagos).where(eq(ventaPagos.ventaId, ventaId)).all();
        const ingresoOriginal = tx
          .select({ id: cajaMovimientos.id })
          .from(cajaMovimientos)
          .where(
            and(
              eq(cajaMovimientos.documentoTipo, 'venta'),
              eq(cajaMovimientos.documentoId, ventaId),
              eq(cajaMovimientos.tipo, 'ingreso'),
            ),
          )
          .get();
        if (ingresoOriginal !== undefined) {
          const caja = cajaAbierta(tx);
          if (caja === undefined) {
            advertencias.push('No hay caja abierta: la devolucion del efectivo no quedo asentada en ninguna caja.');
          } else if (pagosDeLaVenta.length > 0) {
            for (const pago of pagosDeLaVenta) {
              const nombreMedio = tx
                .select({ n: mediosPago.nombre, fisico: mediosPago.esEfectivoFisico })
                .from(mediosPago)
                .where(eq(mediosPago.id, pago.medioPagoId))
                .get();
              tx.insert(cajaMovimientos)
                .values({
                  cajaId: caja.id,
                  tipo: 'egreso',
                  concepto:
                    nombreMedio !== undefined && !nombreMedio.fisico
                      ? `Anulacion de venta #${ventaId} — ${nombreMedio.n}`
                      : `Anulacion de venta #${ventaId}`,
                  monto: pago.importe,
                  documentoTipo: 'venta',
                  documentoId: ventaId,
                  medioPagoId: pago.medioPagoId,
                  fecha: ahora,
                  notas: null,
                })
                .run();
            }
          } else {
            // Venta anterior a los pagos mixtos: el espejo unico de siempre.
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

        // El cheque que entro con esta venta se le devuelve al cliente: no
        // puede seguir figurando como plata por cobrar en la cartera.
        for (const pago of pagosDeLaVenta) {
          if (pago.chequeId === null) continue;
          const cheque = tx.select().from(cheques).where(eq(cheques.id, pago.chequeId)).get();
          if (cheque !== undefined && cheque.estado === 'en_cartera') {
            tx.update(cheques)
              .set({ estado: 'rechazado', notas: `Venta #${ventaId} anulada: cheque devuelto al cliente` })
              .where(eq(cheques.id, pago.chequeId))
              .run();
            advertencias.push(`El cheque ${cheque.numero} salio de la cartera (venta anulada).`);
          } else if (cheque !== undefined) {
            advertencias.push(
              `El cheque ${cheque.numero} de esta venta ya esta ${cheque.estado}: revisalo a mano en la cartera.`,
            );
          }
        }

        // Las reservas que esta venta consumio vuelven a estar ACTIVAS: la
        // mercaderia reingreso al deposito y sigue siendo del cliente del
        // pedido. Sin esto, otro le compraba la mercaderia devuelta.
        if (venta.pedidoId !== null) {
          tx.update(reservasStock)
            .set({ estado: 'activa', ventaId: null })
            .where(and(eq(reservasStock.ventaId, ventaId), eq(reservasStock.estado, 'entregada')))
            .run();
          const pedido = tx
            .select({ estado: pedidos.estado })
            .from(pedidos)
            .where(eq(pedidos.id, venta.pedidoId))
            .get();
          if (pedido !== undefined && pedido.estado === 'entregado') {
            tx.update(pedidos).set({ estado: 'listo' }).where(eq(pedidos.id, venta.pedidoId)).run();
            advertencias.push(`El pedido #${venta.pedidoId} volvio a LISTO con su mercaderia apartada.`);
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
