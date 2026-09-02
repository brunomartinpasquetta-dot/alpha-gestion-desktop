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

import { and, eq } from 'drizzle-orm';

import { TRANSICIONES_PEDIDO, type EntradaNuevoPedido } from '../../compartido/contratos';
import { obtenerDb } from '../db/conexion';
import { articulos, ordenesProduccion, pedidoItems, pedidoRenglonComponentes, pedidoRenglones, pedidos, presentacionComponentes, reservasStock } from '../db/schema';
import { ejecutarSeguro } from '../dominio/errores';
import { existeEntidad } from '../repositorios/cuentas-corrientes.repositorio';
import * as repo from '../repositorios/pedidos-escritura.repositorio';
import * as repoProduccion from '../repositorios/lectura/produccion.repositorio';
import type { EstadoPedido, Pedido } from '../db/schema';
import { ErrorNoEncontrado, ErrorReglaNegocio, ErrorValidacion } from '../dominio/errores';
import { emitir } from '../eventos';
import { redondearCantidad } from '../utiles/numeros';
import { produccionServicio } from './produccion.servicio';
import { cubrirPedidosPendientes, liberarExceso, liberarReservasDePedido, reservasServicio } from './reservas.servicio';

/** Limite de items por pedido: mas que esto es un error de carga, no un pedido. */
const MAXIMO_ITEMS = 50;

export interface ResultadoCrearPedido {
  pedido: Pedido;
  /** true si la clave de idempotencia ya se habia procesado: no se creo nada. */
  existente: boolean;
  /** Ordenes de produccion que el pedido abrio solo. Ausente si ya existia. */
  ordenes?: {
    creadas: {
      ordenId: number;
      articuloNombre: string;
      cantidad: number;
      /** true si la orden nacio sin insumos suficientes: queda en espera. */
      esperaInsumos: boolean;
      insumosFaltantes: string | null;
    }[];
    sinReceta: string[];
  };
  /** Lo que se aparto automaticamente del stock al cargar el pedido. */
  cobertura?: {
    reservado: { articuloId: number; articuloNombre: string; cantidad: number; numeroLote: string | null }[];
    faltante: { articuloId: number; articuloNombre: string; cantidad: number }[];
    quedoListo: boolean;
  };
}

export const pedidosServicio = {
  /** Crea un pedido validado y avisa a las pantallas conectadas. */
  /**
   * Explota renglones de presentaciones a items en unidades por articulo.
   * "2 cajas B-N-FB + 1 docena de blancos" => B: 2x12+12=36, N: 24, FB: 24.
   * El circuito de reservas y produccion sigue trabajando en unidades; los
   * renglones quedan guardados como la verdad comercial del pedido.
   */
  explotarRenglones(
    renglones: readonly {
      presentacionId?: number | null;
      cantidad: number;
      componentes?: { articuloId: number; unidades: number }[] | null;
    }[],
  ): { articuloId: number; cantidad: number }[] {
    const db = obtenerDb();
    const porArticulo = new Map<number, number>();
    for (const renglon of renglones) {
      if (!Number.isFinite(renglon.cantidad) || renglon.cantidad <= 0) {
        throw new ErrorValidacion('Las cantidades del talonario tienen que ser mayores a cero.');
      }
      // De catalogo o a medida: en ambos casos termina siendo una lista de
      // (articulo, unidades) que multiplica por la cantidad del renglon.
      // Si el renglon trae composicion PROPIA (caja de cubanitos con sus
      // sabores, surtida a medida), esa manda aunque venga con presentacion:
      // la presentacion queda para el nombre y el precio.
      const componentes =
        renglon.componentes && renglon.componentes.length > 0
          ? renglon.componentes
          : renglon.presentacionId != null
            ? db
                .select({
                  articuloId: presentacionComponentes.articuloId,
                  unidades: presentacionComponentes.unidades,
                })
                .from(presentacionComponentes)
                .where(eq(presentacionComponentes.presentacionId, renglon.presentacionId))
                .all()
            : [];
      if (componentes.length === 0) {
        throw new ErrorValidacion(
          renglon.presentacionId != null
            ? `La presentacion ${renglon.presentacionId} no existe o no tiene composicion.`
            : 'Un renglon a medida necesita su composicion (que variedades y cuantas).',
        );
      }
      for (const componente of componentes) {
        if (!Number.isFinite(componente.unidades) || componente.unidades <= 0) {
          throw new ErrorValidacion('Las unidades de la mezcla a medida tienen que ser mayores a cero.');
        }
        porArticulo.set(
          componente.articuloId,
          (porArticulo.get(componente.articuloId) ?? 0) +
            redondearCantidad(componente.unidades * renglon.cantidad),
        );
      }
    }
    return [...porArticulo.entries()].map(([articuloId, cantidad]) => ({
      articuloId,
      cantidad: redondearCantidad(cantidad),
    }));
  },

  crearPedido(entrada: EntradaNuevoPedido): ResultadoCrearPedido {
    // El talonario manda renglones; los items en unidades se derivan aca.
    if (entrada.renglones && entrada.renglones.length > 0) {
      entrada = { ...entrada, items: pedidosServicio.explotarRenglones(entrada.renglones) };
    }
    // Idempotencia: si esta clave ya se proceso, devolver el pedido original.
    // Es lo que evita que un reintento de la cola offline (respuesta perdida
    // despues de persistir) duplique el pedido en la fabrica.
    const clave = entrada.claveIdempotencia?.trim() || null;
    if (clave !== null) {
      const previo = ejecutarSeguro('buscar pedido por clave de idempotencia', () =>
        obtenerDb().select().from(pedidos).where(eq(pedidos.claveIdempotencia, clave)).get(),
      );
      if (previo) {
        // Auto-reparacion: si el primer intento murio DESPUES de insertar el
        // pedido pero ANTES de cubrir stock o abrir las ordenes, el reintento
        // de la cola offline es la unica oportunidad de completarlas. Ambas
        // operaciones son idempotentes, asi que repetirlas no duplica nada.
        reservasServicio.cubrirConStock(previo.id);
        produccionServicio.generarOrdenesParaPedido(previo.id);
        return { pedido: previo, existente: true };
      }
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
      vendedorId: entrada.vendedorId ?? null,
      listaPrecioId: entrada.listaPrecioId ?? null,
      origen: entrada.origen,
      fechaEntregaEstimada: entrada.fechaEntregaEstimada?.trim() || null,
      cargadoPor: entrada.cargadoPor?.trim() || null,
      notas: entrada.notas?.trim() || null,
      claveIdempotencia: clave,
      items,
      // Van en la MISMA transaccion que la cabecera: antes se escribian en una
      // aparte y un fallo entre las dos dejaba el pedido sin su talonario.
      renglones: (entrada.renglones ?? []).map((renglon) => ({
        presentacionId: renglon.presentacionId ?? null,
        descripcion: renglon.descripcion?.trim() || null,
        cantidad: redondearCantidad(renglon.cantidad),
        componentes: renglon.componentes ?? [],
      })),
    });

    // El pedido recien cargado se atiende SOLO, en este orden:
    //  1. Se aparta del stock disponible todo lo que ya este elaborado.
    //  2. Lo que falte abre su orden de produccion (solo por la diferencia).
    //  3. Si el stock cubria todo, el pedido queda LISTO sin tocar nada.
    // Es el circuito completo del papel de Bruno: nadie tiene que acordarse de
    // reservar ni de planificar; el sistema deja el trabajo servido.
    // Los renglones del talonario se guardan tal cual: son la verdad comercial
    // (que pidio y como lo pidio) y la fuente del remito y la orden impresa.
    const cobertura = reservasServicio.cubrirConStock(pedido.id);
    const generadas = produccionServicio.generarOrdenesParaPedido(pedido.id);

    // Cada orden abierta dice si nacio esperando insumos: es lo que decide el
    // mensaje que ve el que cargo el pedido ("enviado a elaboracion" vs "queda
    // en espera, hay que comprar X").
    const vistas = generadas.creadas.length > 0 ? repoProduccion.listarOrdenes() : [];
    const ordenes = {
      sinReceta: generadas.sinReceta,
      creadas: generadas.creadas.map((o) => {
        const vista = vistas.find((v) => v.id === o.ordenId);
        return {
          ...o,
          esperaInsumos: vista?.esperaInsumos ?? false,
          insumosFaltantes: vista?.insumosFaltantes ?? null,
        };
      }),
    };

    // El estado pudo avanzar solo (a listo si el stock cubria todo): se relee
    // para que quien cargo el pedido vea la verdad, no la foto de antes.
    const estadoFinal = repo.buscarEstado(pedido.id);
    if (estadoFinal !== undefined) pedido.estado = estadoFinal;

    emitir('pedidos:cambio');
    return { pedido, existente: false, ordenes, cobertura };
  },

  /** Aplica una transicion de estado valida y avisa a las pantallas. */
  /**
   * Corrige un pedido mal cargado. Solo mientras no entro a produccion: una vez
   * que la fabrica empezo a elaborar contra ese pedido, cambiarlo por atras
   * dejaria la tanda produciendo una cosa y el pedido pidiendo otra.
   */
  actualizarPedido(pedidoId: number, entrada: EntradaNuevoPedido): { id: number } {
    // Igual que en el alta: los renglones del talonario son la verdad comercial
    // y los items en unidades se derivan de ellos.
    if (entrada.renglones && entrada.renglones.length > 0) {
      entrada = { ...entrada, items: pedidosServicio.explotarRenglones(entrada.renglones) };
    }
    if (entrada.items.length === 0) {
      throw new ErrorValidacion('El pedido tiene que tener al menos un articulo.');
    }
    const resultado = ejecutarSeguro('actualizar un pedido', () =>
      obtenerDb().transaction((tx) => {
        const pedido = tx
          .select({ id: pedidos.id, estado: pedidos.estado })
          .from(pedidos)
          .where(eq(pedidos.id, pedidoId))
          .get();
        if (!pedido) throw new ErrorNoEncontrado('pedido', pedidoId);
        // Se puede corregir mientras la fabrica no este elaborando: pendiente,
        // confirmado y tambien LISTO (el cliente bajo el pedido ya elaborado:
        // la diferencia se libera y queda para otros pedidos). Con tandas en
        // curso no: cambiar el pedido por atras dejaria la elaboracion
        // produciendo una cosa y el pedido pidiendo otra.
        if (
          pedido.estado !== 'pendiente' &&
          pedido.estado !== 'confirmado' &&
          pedido.estado !== 'listo'
        ) {
          throw new ErrorReglaNegocio(
            `El pedido #${pedidoId} esta ${pedido.estado}: ya no se puede modificar. ` +
              'Cancelalo y carga uno nuevo si hace falta.',
          );
        }

        for (const item of entrada.items) {
          const articulo = tx
            .select({ id: articulos.id, nombre: articulos.nombre, tipo: articulos.tipo, activo: articulos.activo })
            .from(articulos)
            .where(eq(articulos.id, item.articuloId))
            .get();
          if (!articulo) throw new ErrorNoEncontrado('articulo', item.articuloId);
          if (articulo.tipo !== 'producto_terminado' || !articulo.activo) {
            throw new ErrorReglaNegocio(`${articulo.nombre} no es un producto terminado activo.`);
          }
        }

        tx.update(pedidos)
          .set({
            clienteId: entrada.clienteId ?? null,
            vendedorId: entrada.vendedorId ?? null,
            listaPrecioId: entrada.listaPrecioId ?? null,
            fechaEntregaEstimada: entrada.fechaEntregaEstimada ?? null,
            notas: entrada.notas?.trim() || null,
          })
          .where(eq(pedidos.id, pedidoId))
          .run();

        // Los items se reemplazan enteros: mas simple y menos propenso a error
        // que diferenciar altas, bajas y cambios uno por uno. Los renglones del
        // talonario siguen la misma suerte (el borrado arrastra sus componentes).
        tx.delete(pedidoRenglones).where(eq(pedidoRenglones.pedidoId, pedidoId)).run();
        if (entrada.renglones && entrada.renglones.length > 0) {
          for (const renglon of entrada.renglones) {
            const fila = tx
              .insert(pedidoRenglones)
              .values({
                pedidoId,
                presentacionId: renglon.presentacionId ?? null,
                descripcion: renglon.descripcion?.trim() || null,
                cantidad: redondearCantidad(renglon.cantidad),
              })
              .returning({ id: pedidoRenglones.id })
              .all()[0];
            if (fila && renglon.componentes && renglon.componentes.length > 0) {
              for (const componente of renglon.componentes) {
                tx.insert(pedidoRenglonComponentes)
                  .values({
                    renglonId: fila.id,
                    articuloId: componente.articuloId,
                    unidades: componente.unidades,
                  })
                  .run();
              }
            }
          }
        }
        tx.delete(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)).run();
        for (const item of entrada.items) {
          tx.insert(pedidoItems)
            .values({
              pedidoId,
              articuloId: item.articuloId,
              cantidad: redondearCantidad(item.cantidad),
              notas: item.notas?.trim() || null,
            })
            .run();
        }

        // Si el pedido se ACHICO, el sobrante apartado vuelve a la venta ya:
        // sin esto, un pedido bajado de 50 a 30 seguia reteniendo (y cobrando)
        // 50. Y si un articulo se saco del todo, se suelta entero.
        const nuevosPorArticulo = new Map(
          entrada.items.map((i) => [i.articuloId, redondearCantidad(i.cantidad)]),
        );
        for (const item of entrada.items) {
          liberarExceso(tx, pedidoId, item.articuloId, nuevosPorArticulo.get(item.articuloId) ?? 0);
        }
        const conReserva = tx
          .selectDistinct({ articuloId: reservasStock.articuloId })
          .from(reservasStock)
          .where(and(eq(reservasStock.pedidoId, pedidoId), eq(reservasStock.estado, 'activa')))
          .all();
        for (const fila of conReserva) {
          if (!nuevosPorArticulo.has(fila.articuloId)) {
            liberarExceso(tx, pedidoId, fila.articuloId, 0);
          }
        }

        return { id: pedidoId };
      }),
    );
    // Los items cambiaron: se recalcula la cobertura con stock, se abren las
    // ordenes que falten y se cancelan las que quedaron sin producto.
    reservasServicio.cubrirConStock(pedidoId);
    produccionServicio.generarOrdenesParaPedido(pedidoId);
    // Lo que la reduccion libero puede estar esperandolo otro pedido.
    ejecutarSeguro('repartir stock liberado tras editar', () =>
      obtenerDb().transaction((tx) => {
        cubrirPedidosPendientes(tx);
        return true;
      }),
    );
    emitir('pedidos:cambio');
    return resultado;
  },

  cambiarEstado(pedidoId: number, nuevoEstado: EstadoPedido): { id: number; estado: EstadoPedido } {
    const actual = repo.buscarEstado(pedidoId);
    if (actual === undefined) throw new ErrorNoEncontrado('pedido', pedidoId);

    // Entregar sin vender dejaba el pedido cerrado SIN factura y con la
    // mercaderia apartada para siempre. La entrega es consecuencia de la
    // venta, nunca un boton.
    if (nuevoEstado === 'entregado') {
      throw new ErrorReglaNegocio(
        `El pedido #${pedidoId} se entrega vendiendolo: usa el boton "Vender / facturar". ` +
          'Asi sale el comprobante, se cobra y el stock egresa con su lote.',
      );
    }

    const permitidas = TRANSICIONES_PEDIDO[actual];
    if (!permitidas.includes(nuevoEstado)) {
      throw new ErrorReglaNegocio(
        `Un pedido ${actual} no puede pasar a ${nuevoEstado}. Transiciones validas: ${
          permitidas.length > 0 ? permitidas.join(', ') : 'ninguna (estado terminal)'
        }.`,
        { estadoActual: actual, estadoPedido: nuevoEstado },
      );
    }

    // Cancelar es UNA transaccion: estado, ordenes y reservas juntos. Antes el
    // estado se escribia aparte, y un fallo en el medio dejaba un pedido
    // cancelado con la mercaderia apartada para siempre (stock fantasma).
    if (nuevoEstado === 'cancelado') {
      ejecutarSeguro('cancelar el pedido con sus ordenes y reservas', () =>
        obtenerDb().transaction((tx) => {
          tx.update(pedidos).set({ estado: 'cancelado' }).where(eq(pedidos.id, pedidoId)).run();
          // Las ordenes que todavia no arrancaron mueren con el pedido: nadie
          // debe elaborar para un pedido cancelado. Una tanda EN ELABORACION no
          // se toca (la produccion fisica ya esta en la mesa); al finalizar,
          // como el pedido esta cancelado, lo producido entra DISPONIBLE y el
          // barrido se lo aparta al pedido mas viejo que lo espere.
          tx.update(ordenesProduccion)
            .set({ estado: 'cancelada', notas: `El pedido #${pedidoId} se cancelo` })
            .where(
              and(
                eq(ordenesProduccion.pedidoId, pedidoId),
                eq(ordenesProduccion.estado, 'planificada'),
              ),
            )
            .run();
          liberarReservasDePedido(tx, pedidoId, `Pedido #${pedidoId} cancelado`);
          return true;
        }),
      );
      emitir('maestros:cambio');
      emitir('ordenes:cambio');
    } else {
      repo.actualizarEstado(pedidoId, nuevoEstado);
    }

    emitir('pedidos:cambio');
    return { id: pedidoId, estado: nuevoEstado };
  },
};
