/**
 * Servicio de CONSULTAS de los modulos.
 *
 * Arma las vistas que define `src/compartido/contratos.ts` a partir de los
 * repositorios de lectura. Es la capa que:
 *  - agrupa los anidados (items de recetas, de pedidos, precios de listas) con
 *    DOS consultas y un agrupamiento en memoria, nunca con una consulta por padre;
 *  - deriva los campos calculados que no valen la pena guardar;
 *  - normaliza los nulls que deja el LEFT JOIN.
 *
 * No conoce Fastify ni HTTP: las rutas lo consumen, no al reves.
 */

import { asc } from 'drizzle-orm';

import type {
  Estadisticas,
  MedioPagoVista,
  ResumenCajaGeneral,
  UsuarioVista,
  CajaMovimientoVista,
  CajaVista,
  ClienteVista,
  CompraVista,
  ListaPrecioVista,
  MovimientoStockVista,
  OrdenProduccionVista,
  PedidoVista,
  PrecioVista,
  ProveedorVista,
  RecetaVista,
  ResumenCuentaCorriente,
  ResumenGeneral,
  VentaVista,
  VendedorVista,
  MovimientoGrupoVista,
} from '../../compartido/contratos';
import { existe as existeArticulo } from '../repositorios/articulos.repositorio';
import * as repoCaja from '../repositorios/lectura/caja.repositorio';
import * as repoCompras from '../repositorios/lectura/compras.repositorio';
import * as repoGestion from '../repositorios/lectura/gestion.repositorio';
import * as repoCc from '../repositorios/lectura/cuentas-corrientes.repositorio';
import * as repoPedidos from '../repositorios/lectura/pedidos.repositorio';
import * as repoProduccion from '../repositorios/lectura/produccion.repositorio';
import * as repoRecetas from '../repositorios/lectura/recetas.repositorio';
import * as repoResumen from '../repositorios/lectura/resumen.repositorio';
import * as repoStock from '../repositorios/lectura/stock.repositorio';
import * as repoTerceros from '../repositorios/lectura/terceros.repositorio';
import * as repoVentas from '../repositorios/lectura/ventas.repositorio';
import { obtenerDb } from '../db/conexion';
import { mediosPago } from '../db/schema';
import { ejecutarSeguro, ErrorNoEncontrado } from '../dominio/errores';

/** Limites del ledger por articulo, para que una pantalla no traiga la historia entera. */
export const LIMITE_MOVIMIENTOS_DEFAULT = 100;
export const LIMITE_MOVIMIENTOS_MAXIMO = 500;

/**
 * Agrupa hijos por el id de su padre. Devuelve un Map para que el armado de las
 * vistas sea O(n) en vez de un filter por cada padre.
 */
function agruparPorPadre<T>(hijos: readonly T[], obtenerPadreId: (hijo: T) => number): Map<number, T[]> {
  const porPadre = new Map<number, T[]>();
  for (const hijo of hijos) {
    const clave = obtenerPadreId(hijo);
    const acumulado = porPadre.get(clave);
    if (acumulado) acumulado.push(hijo);
    else porPadre.set(clave, [hijo]);
  }
  return porPadre;
}

export const consultasServicio = {
  /* ------------------------------- Recetas ------------------------------- */

  listarRecetas(): RecetaVista[] {
    const recetas = repoRecetas.listarRecetas();
    if (recetas.length === 0) return [];

    const items = repoRecetas.listarItemsDeRecetas(recetas.map((r) => r.id));
    const porReceta = agruparPorPadre(items, (item) => item.recetaId);

    return recetas.map((receta) => ({
      id: receta.id,
      articuloProducidoId: receta.articuloProducidoId,
      articuloProducidoCodigo: receta.articuloProducidoCodigo,
      articuloProducidoNombre: receta.articuloProducidoNombre,
      articuloProducidoTipo: receta.articuloProducidoTipo,
      rindeCantidad: receta.rindeCantidad,
      rindeUnidadAbreviatura: receta.rindeUnidadAbreviatura,
      activa: receta.activa,
      notas: receta.notas,
      items: (porReceta.get(receta.id) ?? []).map((item) => ({
        id: item.id,
        articuloInsumoId: item.articuloInsumoId,
        insumoCodigo: item.insumoCodigo,
        insumoNombre: item.insumoNombre,
        insumoTipo: item.insumoTipo,
        cantidad: item.cantidad,
        unidadAbreviatura: item.unidadAbreviatura,
        mermaEsperadaPct: item.mermaEsperadaPct,
      })),
    }));
  },

  /* ------------------------------ Produccion ----------------------------- */

  listarMediosPago(): MedioPagoVista[] {
    return ejecutarSeguro('listar medios de pago', () =>
      obtenerDb()
        .select()
        .from(mediosPago)
        .orderBy(asc(mediosPago.orden), asc(mediosPago.id))
        .all()
        .map((m) => ({
          id: m.id,
          nombre: m.nombre,
          tipo: m.tipo,
          esEfectivoFisico: m.esEfectivoFisico,
          comisionPct: m.comisionPct,
          activo: m.activo,
          orden: m.orden,
        })),
    );
  },

  listarOrdenesProduccion(): OrdenProduccionVista[] {
    return repoProduccion.listarOrdenes();
  },

  /* -------------------------------- Pedidos ------------------------------ */

  listarPedidos(): PedidoVista[] {
    const pedidos = repoPedidos.listarPedidos();
    if (pedidos.length === 0) return [];

    const items = repoPedidos.listarItemsDePedidos(pedidos.map((p) => p.id));
    const porPedido = agruparPorPadre(items, (item) => item.pedidoId);
    const renglones = repoPedidos.listarRenglonesDePedidos(pedidos.map((p) => p.id));
    const renglonesPorPedido = agruparPorPadre(renglones, (r) => r.pedidoId);
    const componentesAMedida = repoPedidos.listarComponentesDeRenglones(renglones.map((r) => r.id));

    return pedidos.map((pedido) => ({
      ...pedido,
      items: (porPedido.get(pedido.id) ?? []).map((item) => ({
        id: item.id,
        articuloId: item.articuloId,
        codigo: item.codigo,
        nombre: item.nombre,
        cantidad: item.cantidad,
        unidadAbreviatura: item.unidadAbreviatura,
        unidadesPorCaja: item.unidadesPorCaja,
        notas: item.notas,
        reservado: item.reservado,
        disponible: item.disponible,
      })),
      renglones: (renglonesPorPedido.get(pedido.id) ?? []).map((r) => ({
        id: r.id,
        presentacionId: r.presentacionId,
        presentacionCodigo: r.presentacionCodigo,
        presentacionNombre: r.presentacionNombre,
        descripcion: r.descripcion,
        cantidad: r.cantidad,
        componentes: componentesAMedida
          .filter((c) => c.renglonId === r.id)
          .map((c) => ({ articuloId: c.articuloId, articuloNombre: c.articuloNombre, unidades: c.unidades })),
      })),
    }));
  },

  /* --------------------------- Compras y ventas -------------------------- */

  listarCompras(): CompraVista[] {
    return repoCompras.listarCompras();
  },

  listarVentas(): VentaVista[] {
    return repoVentas.listarVentas();
  },

  /* --------------------------------- Caja -------------------------------- */

  listarCajas(): CajaVista[] {
    return repoCaja.listarCajas();
  },

  listarMovimientosCaja(cajaId?: number): CajaMovimientoVista[] {
    return repoCaja.listarMovimientos(cajaId);
  },

  /* --------------------------- Cuentas corrientes ------------------------ */

  /**
   * Resumen por entidad. El nombre puede venir null si el ledger tiene
   * movimientos de una entidad borrada: en ese caso mostramos un rotulo
   * explicito en vez de una fila fantasma, porque el ledger no se borra nunca.
   */
  listarResumenCuentasCorrientes(): ResumenCuentaCorriente[] {
    return repoCc.listarResumenPorEntidad().map((fila) => ({
      entidadTipo: fila.entidadTipo,
      entidadId: fila.entidadId,
      entidadNombre:
        fila.entidadNombre ??
        `${fila.entidadTipo === 'cliente' ? 'Cliente' : 'Proveedor'} #${fila.entidadId} (eliminado)`,
      debe: fila.debe,
      haber: fila.haber,
      saldo: fila.debe - fila.haber,
      cantidadMovimientos: fila.cantidadMovimientos,
      ultimoMovimiento: fila.ultimoMovimiento,
    }));
  },

  /* ------------------------------- Maestros ------------------------------ */

  listarClientes(): ClienteVista[] {
    return repoTerceros.listarClientes();
  },

  listarVendedores(): VendedorVista[] {
    return repoTerceros.listarVendedores();
  },

  listarProveedores(): ProveedorVista[] {
    return repoTerceros.listarProveedores();
  },

  listarListasPrecio(): ListaPrecioVista[] {
    const listas = repoTerceros.listarListasPrecio();
    if (listas.length === 0) return [];

    const precios = repoTerceros.listarPreciosDeTodasLasListas();
    const porLista = agruparPorPadre(precios, (precio) => precio.listaPrecioId);

    return listas.map((lista) => ({
      id: lista.id,
      nombre: lista.nombre,
      activa: lista.activa,
      baseListaId: lista.baseListaId,
      recargoPct: lista.recargoPct,
      precios: (porLista.get(lista.id) ?? []).map<PrecioVista>((precio) => ({
        id: precio.id,
        articuloId: precio.articuloId,
        codigo: precio.codigo,
        nombre: precio.nombre,
        precio: precio.precio,
        vigenteDesde: precio.vigenteDesde,
      })),
    }));
  },

  /* --------------------------- Ledger por articulo ----------------------- */

  /**
   * Ledger de un articulo con saldo acumulado. Es la vista que demuestra que el
   * stock sale de sumar movimientos y no de un campo guardado.
   */
  listarMovimientosDeGrupo(grupo: 'insumos' | 'productos', limite = 200): MovimientoGrupoVista[] {
    return repoStock.listarMovimientosDeGrupo(grupo, Math.min(limite, 1000));
  },

  listarMovimientosDeArticulo(articuloId: number, limite?: number): MovimientoStockVista[] {
    if (!existeArticulo(articuloId)) throw new ErrorNoEncontrado('articulo', articuloId);

    const limiteEfectivo = Math.min(
      Math.max(limite ?? LIMITE_MOVIMIENTOS_DEFAULT, 1),
      LIMITE_MOVIMIENTOS_MAXIMO,
    );
    return repoStock.listarMovimientosConAcumulado(articuloId, limiteEfectivo);
  },

  /* ------------------------------ Caja general --------------------------- */

  /**
   * Tesoreria consolidada. El saldo acumulado es aperturas + ingresos - egresos:
   * lo que deberia haber pasado por caja desde que existe el sistema.
   */
  obtenerCajaGeneral(): ResumenCajaGeneral {
    const fila = repoGestion.resumirCajaGeneral();
    return {
      ...fila,
      saldoAcumulado: fila.totalAperturas + fila.totalIngresos - fila.totalEgresos,
    };
  },

  /* ------------------------------- Estadisticas -------------------------- */

  obtenerEstadisticas(): Estadisticas {
    const valorizacion = repoGestion.valorizarInventario();
    return {
      ventasPorMes: repoGestion.ventasPorMes(6),
      comprasPorMes: repoGestion.comprasPorMes(6),
      masVendidos: repoGestion.articulosMasVendidos(10),
      valorizacion: {
        ...valorizacion,
        total: valorizacion.insumos + valorizacion.productos,
      },
    };
  },

  /* --------------------------------- Usuarios ---------------------------- */

  listarUsuarios(): UsuarioVista[] {
    return repoGestion.listarUsuarios();
  },

  /* -------------------------------- Resumen ------------------------------ */

  obtenerResumenGeneral(): ResumenGeneral {
    const cajaAbierta = repoResumen.resumirCajaAbierta();
    const saldosCc = repoCc.agregarSaldosGlobales();

    return {
      articulos: repoResumen.contarArticulos(),
      pedidos: repoResumen.contarPedidosPorEstado(),
      produccion: repoResumen.contarOrdenesPorEstado(),
      compras: repoResumen.resumirCompras(),
      ventas: repoResumen.resumirVentas(),
      caja: {
        abierta: cajaAbierta !== null,
        cajaId: cajaAbierta?.cajaId ?? null,
        saldoEstimado: cajaAbierta?.saldoEstimado ?? 0,
      },
      cuentasCorrientes: {
        saldoClientes: saldosCc.saldoClientes,
        saldoProveedores: saldosCc.saldoProveedores,
      },
    };
  },
};
