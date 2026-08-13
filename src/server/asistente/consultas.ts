/**
 * Consultas de DATOS de Alfi: responde con los numeros reales de la fabrica,
 * leidos del sistema en el momento. Patron copiado de StockFlow
 * (assistant/consultas.ts): lista de consultas {id, frases, responder},
 * matcheo por frase normalizada con `includes` (primer match gana), y NULL
 * cuando la pregunta no es de datos, para que siga el motor de conocimiento.
 *
 * Reglas que no se negocian:
 *  - DETERMINISTA: cada consulta es un match de frase + una lectura concreta.
 *    Ante la duda se devuelve null; mejor explicar donde mirar que inventar
 *    un numero en un sistema que maneja plata.
 *  - El dinero viaja en CENTAVOS y se formatea a pesos SOLO al responder.
 *  - El stock respeta el ledger y la distincion fisico/reservado/disponible
 *    que ya calcula el sistema: aca no se suma nada por cuenta propia.
 */

import { ETIQUETA_ESTADO_PEDIDO } from '../../compartido/contratos';
import { consultasServicio } from '../servicios/consultas.servicio';
import { chequesServicio } from '../servicios/cheques.servicio';
import { stockServicio } from '../servicios/stock.servicio';

/* -------------------------------- Formato ---------------------------------- */

/** Centavos -> "$1.234,56" (es-AR). */
function pesos(centavos: number): string {
  return `$${(centavos / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function cantidad(valor: number): string {
  return valor.toLocaleString('es-AR', { maximumFractionDigits: 2 });
}

/** Unidades en la forma en que se habla en la fabrica: docenas si aplica. */
function enUnidades(unidades: number, upc: number | null, abreviatura: string): string {
  if (upc === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${cantidad(resto)} u`;
    const base = `${cantidad(docenas)} ${docenas === 1 ? 'docena' : 'docenas'}`;
    return resto === 0 ? base : `${base} + ${cantidad(resto)} u`;
  }
  return `${cantidad(unidades)} ${abreviatura}`;
}

/** Sin acentos y en minusculas, para comparar como la gente escribe. */
function norm(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esDeHoy(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/* ------------------------------- Consultas --------------------------------- */

interface Consulta {
  id: string;
  /** Frases que disparan la consulta (ya normalizadas). */
  frases: string[];
  responder: () => string | null;
}

const CONSULTAS: Consulta[] = [
  {
    id: 'ventas-de-hoy',
    frases: [
      'cuanto vendi hoy', 'cuanto vendimos hoy', 'ventas de hoy', 'venta del dia',
      'cuanto se vendio hoy', 'total vendido hoy', 'cuanto facture hoy',
      'cuanto lleve vendido', 'como venimos hoy', 'cuanto va la venta',
    ],
    responder() {
      const ventas = consultasServicio.listarVentas().filter(
        (v) => v.estado !== 'anulada' && esDeHoy(v.fecha),
      );
      if (ventas.length === 0) return 'Todavia no hay ventas registradas hoy.';
      const total = ventas.reduce((suma, v) => suma + v.total, 0);
      return `Hoy llevas ${ventas.length} venta${ventas.length === 1 ? '' : 's'} por ${pesos(total)}.`;
    },
  },
  {
    id: 'pedidos-pendientes',
    frases: [
      'que pedidos tengo pendientes', 'pedidos pendientes', 'que pedidos hay',
      'que pedidos tengo', 'pedidos sin entregar', 'que hay que entregar',
      'que pedidos faltan', 'pedidos abiertos', 'que me pidieron',
    ],
    responder() {
      const abiertos = consultasServicio
        .listarPedidos()
        .filter((p) => p.estado !== 'entregado' && p.estado !== 'cancelado');
      if (abiertos.length === 0) return 'No hay pedidos sin entregar. Todo al dia 👌';
      const lineas = abiertos
        .slice(0, 8)
        .map(
          (p) =>
            `• #${p.id} ${p.clienteNombre ?? 'Mostrador'} — ${ETIQUETA_ESTADO_PEDIDO[p.estado]}${p.vendedorNombre !== null ? ` (${p.vendedorNombre})` : ''}`,
        );
      const resto = abiertos.length > 8 ? `\n…y ${abiertos.length - 8} mas.` : '';
      const listos = abiertos.filter((p) => p.estado === 'listo').length;
      return (
        `Hay ${abiertos.length} pedido${abiertos.length === 1 ? '' : 's'} sin entregar` +
        `${listos > 0 ? ` (${listos} ya listo${listos === 1 ? '' : 's'} para entregar)` : ''}:\n` +
        lineas.join('\n') +
        resto
      );
    },
  },
  {
    id: 'ordenes-en-curso',
    frases: [
      'que ordenes estan en curso', 'ordenes en curso', 'que se esta elaborando',
      'que estan elaborando', 'tandas en curso', 'que hay en elaboracion',
      'elaboraciones en curso', 'que ordenes hay', 'que se esta haciendo',
    ],
    responder() {
      const ordenes = consultasServicio.listarOrdenesProduccion();
      const enCurso = ordenes.filter((o) => o.estado === 'en_proceso' || o.estado === 'pausada');
      const pendientes = ordenes.filter((o) => o.estado === 'planificada');
      if (enCurso.length === 0 && pendientes.length === 0) {
        return 'No hay elaboraciones en curso ni pendientes.';
      }
      const lineas = enCurso.map(
        (o) =>
          `• ${o.articuloProducidoNombre} — ${enUnidades(o.cantidadPlanificada, o.unidadesPorCaja, o.unidadAbreviatura)}` +
          `${o.numeroLote !== null ? ` · Lote ${o.numeroLote}` : ''}` +
          `${o.estado === 'pausada' ? ' · EN PAUSA' : ''}` +
          `${o.clienteNombre !== null ? ` · para ${o.clienteNombre}` : ''}`,
      );
      const cierre =
        pendientes.length > 0
          ? `\nY ${pendientes.length} orden${pendientes.length === 1 ? '' : 'es'} pendiente${pendientes.length === 1 ? '' : 's'} de arrancar.`
          : '';
      if (enCurso.length === 0) {
        return `No hay tandas en marcha, pero hay ${pendientes.length} pendiente${pendientes.length === 1 ? '' : 's'} de arrancar.`;
      }
      return `En elaboracion ahora:\n${lineas.join('\n')}${cierre}`;
    },
  },
  {
    id: 'insumos-faltantes',
    frases: [
      'que insumos me faltan', 'insumos faltantes', 'que insumos faltan',
      'que falta comprar', 'que tengo que comprar', 'insumos bajo minimo',
      'falta materia prima', 'que materia prima falta', 'que compro',
    ],
    responder() {
      const bajos = stockServicio.saldosPorGrupo('insumos').filter((s) => s.bajoMinimo);
      const enEspera = consultasServicio
        .listarOrdenesProduccion()
        .filter((o) => o.estado === 'planificada' && o.esperaInsumos && o.insumosFaltantes !== null);
      if (bajos.length === 0 && enEspera.length === 0) {
        return 'No hay insumos bajo minimo ni ordenes esperando insumos. 👌';
      }
      const partes: string[] = [];
      if (bajos.length > 0) {
        partes.push(
          'Bajo minimo:\n' +
            bajos
              .slice(0, 8)
              .map(
                (s) =>
                  `• ${s.nombre}: quedan ${cantidad(s.stock)} ${s.unidadAbreviatura}` +
                  `${s.aReponer > 0 ? ` (reponer ${cantidad(s.aReponer)} ${s.unidadAbreviatura})` : ''}`,
              )
              .join('\n') +
            (bajos.length > 8 ? `\n…y ${bajos.length - 8} mas.` : ''),
        );
      }
      if (enEspera.length > 0) {
        partes.push(
          'Ordenes frenadas por insumos:\n' +
            enEspera.slice(0, 5).map((o) => `• Orden #${o.id} (${o.articuloProducidoNombre}): falta ${o.insumosFaltantes}`).join('\n'),
        );
      }
      return partes.join('\n\n');
    },
  },
  {
    id: 'quien-me-debe',
    frases: [
      'quien me debe', 'quienes me deben', 'cuanto me deben', 'deudores',
      'clientes que me deben', 'cuentas corrientes pendientes', 'total por cobrar',
      'que me deben', 'saldos de clientes',
    ],
    responder() {
      const saldos = consultasServicio
        .listarResumenCuentasCorrientes()
        .filter((s) => s.entidadTipo === 'cliente' && s.saldo > 0);
      if (saldos.length === 0) return 'No hay clientes con saldo pendiente. 👌';
      const total = saldos.reduce((suma, s) => suma + s.saldo, 0);
      const lineas = saldos
        .sort((a, b) => b.saldo - a.saldo)
        .slice(0, 5)
        .map((s) => `• ${s.entidadNombre}: ${pesos(s.saldo)}`);
      const resto = saldos.length > 5 ? `\n…y ${saldos.length - 5} mas.` : '';
      return `Te deben ${pesos(total)} entre ${saldos.length} cliente${saldos.length === 1 ? '' : 's'}:\n${lineas.join('\n')}${resto}`;
    },
  },
  {
    id: 'cheques-por-vencer',
    frases: [
      'que cheques vencen', 'cheques por vencer', 'cheques proximos a vencer',
      'que cheques tengo', 'cheques en cartera', 'cuando cobro los cheques',
      'vencimiento de cheques', 'que cheques hay',
    ],
    responder() {
      const enCartera = chequesServicio
        .listar()
        .filter((c) => c.estado === 'en_cartera' || c.estado === 'depositado');
      if (enCartera.length === 0) return 'No hay cheques en cartera.';
      const total = enCartera.reduce((suma, c) => suma + c.importe, 0);
      const lineas = enCartera
        .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago))
        .slice(0, 6)
        .map((c) => {
          const fecha = new Date(c.fechaPago).toLocaleDateString('es-AR', {
            day: '2-digit',
            month: '2-digit',
          });
          return `• ${fecha} — ${c.contraparte}: ${pesos(c.importe)}${c.banco !== null ? ` (${c.banco})` : ''}${c.estado === 'depositado' ? ' · depositado' : ''}`;
        });
      const resto = enCartera.length > 6 ? `\n…y ${enCartera.length - 6} mas.` : '';
      return `Tenes ${enCartera.length} cheque${enCartera.length === 1 ? '' : 's'} por ${pesos(total)}, por fecha de cobro:\n${lineas.join('\n')}${resto}`;
    },
  },
];

/* ------------------- Stock y precio de UN producto ------------------------- */

const PATRON_ARTICULO = [
  /(?:tengo|hay|queda|quedan)\s+stock\s+de\s+(.+)/,
  /(?:cuanto|cuantos|cuantas)\s+(?:stock\s+)?(?:tengo|hay|quedan?)\s+de\s+(.+)/,
  /stock\s+de\s+(.+)/,
  /(?:cuanto|a cuanto)\s+(?:cuesta|sale|vale)\s+(?:el|la|los|las|una|un)?\s*(.+)/,
  /precio\s+de\s+(?:la|el|los|las|una|un)?\s*(.+)/,
];

function consultarArticulo(pregunta: string): string | null {
  const n = norm(pregunta);
  let termino: string | null = null;
  let quierePrecio = false;
  for (const rx of PATRON_ARTICULO) {
    const m = n.match(rx);
    if (m?.[1]) {
      termino = m[1].trim();
      quierePrecio = /cuesta|sale|vale|precio/.test(rx.source);
      break;
    }
  }
  if (!termino || termino.length < 3) return null;

  const encontrados = stockServicio
    .listarArticulosConStock({})
    .filter((a) => a.activo && norm(a.nombre).includes(termino as string))
    .slice(0, 5);
  if (encontrados.length === 0) {
    return `No encontre ningun articulo que se llame "${termino}". Proba con otra palabra.`;
  }

  if (quierePrecio) {
    // Precio: presentaciones con ese nombre (caja, docena, bolsa) por lista.
    // Se responde con las listas base 1 a 4, que son las del talonario.
    const listas = consultasServicio
      .listarListasPrecio()
      .filter((l) => l.activa && /^LISTA [1-4]$/.test(l.nombre));
    const articulo = encontrados[0]!;
    const porLista = listas
      .map((lista) => {
        const vigente = [...lista.precios]
          .filter((p) => p.articuloId === articulo.id)
          .sort((a, b) => b.vigenteDesde.localeCompare(a.vigenteDesde))[0];
        return vigente === undefined ? null : `• ${lista.nombre}: ${pesos(vigente.precio)} la unidad`;
      })
      .filter((linea): linea is string => linea !== null);
    if (porLista.length === 0) {
      return `${articulo.nombre} no tiene precio unitario cargado en las listas 1 a 4. Mira Comercial → Listas de precio (cubanitos, almendras y caja Anyulin tienen precio por caja/bolsa, no unitario).`;
    }
    return `${articulo.nombre}:\n${porLista.join('\n')}`;
  }

  if (encontrados.length === 1) {
    const a = encontrados[0]!;
    return (
      `${a.nombre}: fisico ${enUnidades(a.stock, a.unidadesPorCaja, a.unidadAbreviatura)}, ` +
      `apartado ${enUnidades(a.reservado, a.unidadesPorCaja, a.unidadAbreviatura)}, ` +
      `disponible ${enUnidades(a.disponible, a.unidadesPorCaja, a.unidadAbreviatura)}.`
    );
  }
  const lista = encontrados
    .map((a) => `• ${a.nombre}: disponible ${enUnidades(a.disponible, a.unidadesPorCaja, a.unidadAbreviatura)} (fisico ${cantidad(a.stock)})`)
    .join('\n');
  return `Encontre varios:\n${lista}`;
}

/* ---------------------------------- API ------------------------------------ */

/**
 * Intenta responder con datos del sistema. Devuelve null si la pregunta no es
 * de este tipo, para que siga el motor de conocimiento habitual.
 */
export function responderConDatos(pregunta: string): string | null {
  const n = norm(pregunta);
  if (!n) return null;

  for (const consulta of CONSULTAS) {
    if (consulta.frases.some((f) => n.includes(f))) {
      try {
        return consulta.responder();
      } catch {
        // Si la consulta falla, mejor que conteste el motor de siempre que
        // devolver un error al usuario.
        return null;
      }
    }
  }

  try {
    return consultarArticulo(pregunta);
  } catch {
    return null;
  }
}
