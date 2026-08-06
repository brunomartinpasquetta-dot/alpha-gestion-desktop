/**
 * Servicio de pedidos: la primera capa de ESCRITURA de negocio del sistema.
 *
 * Reglas que hace cumplir:
 *  - Un pedido nace siempre `pendiente`, con al menos un item.
 *  - Los items solo pueden ser productos terminados activos: el celular no puede
 *    pedir harina.
 *  - El cliente, si viene, tiene que existir.
 *  - Los cambios de estado siguen la maquina de TRANSICIONES_PEDIDO: no se puede
 *    entregar un pedido cancelado ni volver atras una entrega.
 *  - El pedido NO mueve stock: es una intencion, no un hecho. El stock lo mueven
 *    la produccion y la venta que se derivan de el.
 *
 * Cada escritura emite un evento SSE para que la pantalla de fabrica se entere
 * al instante.
 */

import { eq } from 'drizzle-orm';

import { TRANSICIONES_PEDIDO, type EntradaNuevoPedido } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { pedidos } from '../db/schema';
import { ejecutarSeguro } from '../dominio/errores';
import { existeEntidad } from '../repositorios/cuentas-corrientes.repositorio';
import * as repo from '../repositorios/pedidos-escritura.repositorio';
import type { EstadoPedido, Pedido } from '../db/schema';
import { ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';

/** Limite de items por pedido: mas que esto es un error de carga, no un pedido. */
const MAXIMO_ITEMS = 50;

export interface ResultadoCrearPedido {
  pedido: Pedido;
  /** true si la clave de idempotencia ya se habia procesado: no se creo nada. */
  existente: boolean;
}

export const pedidosServicio = {
  /** Crea un pedido validado y avisa a las pantallas conectadas. */
  crearPedido(entrada: EntradaNuevoPedido): ResultadoCrearPedido {
    // Idempotencia: si esta clave ya se proceso, devolver el pedido original.
    // Es lo que evita que un reintento de la cola offline (respuesta perdida
    // despues de persistir) duplique el pedido en la fabrica.
    const clave = entrada.claveIdempotencia?.trim() || null;
    if (clave !== null) {
      const previo = ejecutarSeguro('buscar pedido por clave de idempotencia', () =>
        obtenerDb().select().from(pedidos).where(eq(pedidos.claveIdempotencia, clave)).get(),
      );
      if (previo) return { pedido: previo, existente: true };
    }
    if (entrada.items.length === 0) {
      throw new ErrorValidacion('El pedido tiene que tener al menos un articulo.');
    }
    if (entrada.items.length > MAXIMO_ITEMS) {
      throw new ErrorValidacion(`Un pedido no puede tener mas de ${MAXIMO_ITEMS} articulos.`);
    }

    // Cantidades: positivas, finitas y redondeadas con la utilidad central.
    const items = entrada.items.map((item) => {
      const cantidad = redondearCantidad(item.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new ErrorValidacion(
          `La cantidad del articulo ${item.articuloId} tiene que ser mayor a cero.`,
        );
      }
      return { articuloId: item.articuloId, cantidad, notas: item.notas?.trim() || null };
    });

    // Un mismo articulo dos veces en el pedido casi siempre es un dedo de mas
    // en el celular. Se rechaza con mensaje claro en vez de sumar en silencio.
    const vistos = new Set<number>();
    for (const item of items) {
      if (vistos.has(item.articuloId)) {
        throw new ErrorValidacion(
          `El articulo ${item.articuloId} aparece mas de una vez en el pedido. Uni las cantidades.`,
        );
      }
      vistos.add(item.articuloId);
    }

    // Solo productos terminados activos.
    const pedidosIds = items.map((item) => item.articuloId);
    const vendibles = new Set(repo.filtrarProductosVendibles(pedidosIds));
    const invalidos = pedidosIds.filter((id) => !vendibles.has(id));
    if (invalidos.length > 0) {
      throw new ErrorReglaNegocio(
        `Estos articulos no son productos terminados activos: ${invalidos.join(', ')}.`,
        { articulosInvalidos: invalidos },
      );
    }

    // El cliente es opcional (mostrador), pero si viene tiene que existir.
    const clienteId = entrada.clienteId ?? null;
    if (clienteId !== null && !existeEntidad('cliente', clienteId)) {
      throw new ErrorNoEncontrado('cliente', clienteId);
    }

    const pedido = repo.insertarPedido({
      clienteId,
      origen: entrada.origen,
      fechaEntregaEstimada: entrada.fechaEntregaEstimada?.trim() || null,
      cargadoPor: entrada.cargadoPor?.trim() || null,
      notas: entrada.notas?.trim() || null,
      claveIdempotencia: clave,
      items,
    });

    emitir('pedidos:cambio');
    return { pedido, existente: false };
  },

  /** Aplica una transicion de estado valida y avisa a las pantallas. */
  cambiarEstado(pedidoId: number, nuevoEstado: EstadoPedido): { id: number; estado: EstadoPedido } {
    const actual = repo.buscarEstado(pedidoId);
    if (actual === undefined) throw new ErrorNoEncontrado('pedido', pedidoId);

    const permitidas = TRANSICIONES_PEDIDO[actual];
    if (!permitidas.includes(nuevoEstado)) {
      throw new ErrorReglaNegocio(
        `Un pedido ${actual} no puede pasar a ${nuevoEstado}. Transiciones validas: ${
          permitidas.length > 0 ? permitidas.join(', ') : 'ninguna (estado terminal)'
        }.`,
        { estadoActual: actual, estadoPedido: nuevoEstado },
      );
    }

    repo.actualizarEstado(pedidoId, nuevoEstado);
    emitir('pedidos:cambio');
    return { id: pedidoId, estado: nuevoEstado };
  },
};
