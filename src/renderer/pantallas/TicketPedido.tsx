/**
 * Ticket de 80 mm del pedido: el papel que sale en la SALA DE ELABORACION.
 *
 * No es un comprobante fiscal ni un remito: es la orden de trabajo. Lleva lo
 * que hay que armar (los renglones del talonario con su composicion, incluidas
 * las cajas armadas a medida), para quien es, y las tandas con su lote.
 *
 * Se imprime con el dialogo del sistema (window.print) sobre papel de 80 mm:
 * `@page { size: 80mm auto }` + ancho fijo. Sin motor de impresion, sin PDF:
 * la misma receta que ya usamos en el resto de los productos BPSG.
 */

import { useEffect, useState } from 'react';

import type { OrdenProduccionVista, PedidoVista } from '../../compartido/contratos';
import type { LineaTicketVista } from '../tipos-globales';
import { obtenerOrdenesProduccion, obtenerPedidos } from '../servicios/cliente';
import { leerPreferenciasImpresion } from './Sistema';
import { formatearCantidad } from '../utiles/formato';

function fechaLarga(iso: string): string {
  const f = new Date(iso);
  return `${f.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })} ${f.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Cantidad en la unidad de la fabrica: docenas cuando corresponde. */
function enUnidades(unidades: number, upc: number | null, abreviatura: string): string {
  if (upc === 12) {
    const docenas = Math.floor(unidades / 12);
    const resto = Math.round(unidades - docenas * 12);
    if (docenas === 0) return `${resto} u`;
    return resto === 0
      ? `${docenas} ${docenas === 1 ? 'doc' : 'doc'}`
      : `${docenas} doc + ${resto} u`;
  }
  return `${formatearCantidad(unidades)} ${abreviatura}`;
}

/**
 * El MISMO contenido del ticket, pero como lineas para la termica. Se arma
 * aparte del JSX a proposito: la impresora no entiende HTML, y asi las dos
 * salidas (papel termico y hoja comun) dicen exactamente lo mismo.
 */
function lineasEscPos(pedido: PedidoVista, ordenes: OrdenProduccionVista[]): LineaTicketVista[] {
  const lineas: LineaTicketVista[] = [
    { texto: 'ORDEN DE ELABORACION', negrita: true, centrado: true },
    { texto: 'ANYULIN - Alfajores Corondinos', centrado: true },
    { texto: '', separador: true },
    { texto: `PEDIDO #${pedido.id}`, grande: true, centrado: true },
    { texto: (pedido.clienteNombre ?? 'MOSTRADOR').toUpperCase(), negrita: true, centrado: true },
    { texto: '', separador: true },
    { texto: `Cargado: ${fechaLarga(pedido.fechaPedido)}` },
  ];
  if (pedido.vendedorNombre !== null) lineas.push({ texto: `Vendedor: ${pedido.vendedorNombre}` });
  if (pedido.cargadoPor !== null) lineas.push({ texto: `Tomo: ${pedido.cargadoPor}` });
  lineas.push({ texto: `Impreso: ${fechaLarga(new Date().toISOString())}` });
  lineas.push({ texto: '', separador: true });
  lineas.push({ texto: 'QUE HAY QUE ARMAR', negrita: true });

  if (pedido.renglones.length > 0) {
    for (const r of pedido.renglones) {
      lineas.push({
        texto: `${formatearCantidad(r.cantidad)} x ${r.descripcion ?? r.presentacionNombre ?? 'Renglon'}`,
        negrita: true,
      });
      if (r.componentes.length > 0) {
        lineas.push({
          texto: `   ${r.componentes.map((c) => `${formatearCantidad(c.unidades)} ${c.articuloNombre}`).join(' + ')}`,
        });
      }
    }
  } else {
    for (const i of pedido.items) {
      lineas.push({
        texto: `${enUnidades(i.cantidad, i.unidadesPorCaja, i.unidadAbreviatura)} ${i.nombre}`,
        negrita: true,
      });
    }
  }

  if (ordenes.length > 0) {
    lineas.push({ texto: '', separador: true });
    lineas.push({ texto: 'TANDAS', negrita: true });
    for (const o of ordenes) {
      lineas.push({
        texto:
          `#${o.id} ${o.articuloProducidoNombre} - ` +
          `${enUnidades(o.cantidadPlanificada, o.unidadesPorCaja, o.unidadAbreviatura)}` +
          `${o.numeroLote !== null ? ` Lote ${o.numeroLote}` : ''}` +
          `${o.esperaInsumos && o.estado === 'planificada' ? ' FALTAN INSUMOS' : ''}`,
      });
    }
  }

  if (pedido.notas !== null && pedido.notas !== '') {
    lineas.push({ texto: '', separador: true });
    lineas.push({ texto: 'NOTAS', negrita: true });
    lineas.push({ texto: pedido.notas });
  }

  lineas.push({ texto: '', separador: true });
  lineas.push({ texto: 'Elaboro: ______________   Hora: ______' });
  return lineas;
}

export function TicketPedido({ pedidoId }: { readonly pedidoId: number }): JSX.Element {
  const [pedido, setPedido] = useState<PedidoVista | null>(null);
  const [ordenes, setOrdenes] = useState<OrdenProduccionVista[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([obtenerPedidos(), obtenerOrdenesProduccion()])
      .then(([pedidos, todas]) => {
        const encontrado = pedidos.find((p) => p.id === pedidoId) ?? null;
        if (encontrado === null) {
          setError(`No se encontro el pedido #${pedidoId}.`);
          return;
        }
        setPedido(encontrado);
        setOrdenes(todas.filter((o) => o.pedidoId === pedidoId && o.estado !== 'cancelada'));
      })
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)));
  }, [pedidoId]);

  const [estadoImpresion, setEstadoImpresion] = useState<string | null>(null);

  // Apenas estan los datos, el ticket se manda a imprimir SOLO. Con impresora
  // termica elegida en Configuracion, sale por ESC/POS sin ningun dialogo (la
  // sala de elaboracion no tiene que tocar nada); si no hay ninguna elegida,
  // se abre el dialogo del sistema, que imprime igual en una hoja comun.
  useEffect(() => {
    if (pedido === null) return undefined;
    const impresora = leerPreferenciasImpresion().impresoraTickets;
    const puente = window.alfajores?.impresion;
    if (impresora !== '' && puente) {
      setEstadoImpresion('Imprimiendo...');
      void puente
        .ticket(impresora, lineasEscPos(pedido, ordenes))
        .then((r) => {
          setEstadoImpresion(r.ok ? `Ticket impreso en ${impresora}.` : (r.error ?? 'No se pudo imprimir.'));
          // Salio el papel: la ventana ya no hace falta.
          if (r.ok) setTimeout(() => window.alfajores?.ventanas.cerrarme(), 1500);
        })
        .catch((causa: unknown) =>
          setEstadoImpresion(causa instanceof Error ? causa.message : String(causa)),
        );
      return undefined;
    }
    const temporizador = setTimeout(() => window.print(), 350);
    return () => clearTimeout(temporizador);
  }, [pedido, ordenes]);

  if (error !== null) {
    return <p className="p-4 text-sm text-peligro-600">{error}</p>;
  }
  if (pedido === null) {
    return <p className="p-4 text-sm text-masa-700">Preparando el ticket...</p>;
  }

  const renglones =
    pedido.renglones.length > 0
      ? pedido.renglones.map((r) => ({
          clave: `r${r.id}`,
          cantidad: `${formatearCantidad(r.cantidad)} x`,
          titulo: r.descripcion ?? r.presentacionNombre ?? 'Renglon',
          detalle:
            r.componentes.length > 0
              ? r.componentes
                  .map((c) => `${formatearCantidad(c.unidades)} ${c.articuloNombre}`)
                  .join(' + ')
              : null,
        }))
      : pedido.items.map((i) => ({
          clave: `i${i.id}`,
          cantidad: enUnidades(i.cantidad, i.unidadesPorCaja, i.unidadAbreviatura),
          titulo: i.nombre,
          detalle: null,
        }));

  return (
    <div className="ticket-80">
      <style>{`
        @page { size: 80mm auto; margin: 3mm; }
        @media print {
          html, body { background: #fff; }
          .no-imprimir { display: none !important; }
        }
        .ticket-80 {
          width: 74mm;
          margin: 0 auto;
          padding: 2mm 0;
          font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          font-size: 11px;
          line-height: 1.35;
          color: #000;
        }
        .ticket-80 h1 { font-size: 15px; font-weight: 800; margin: 0; letter-spacing: .5px; }
        .ticket-80 .sep { border-top: 1px dashed #000; margin: 6px 0; }
        .ticket-80 .fila { display: flex; gap: 6px; }
        .ticket-80 .fila .cant { font-weight: 800; white-space: nowrap; }
        .ticket-80 .chico { font-size: 10px; }
        .ticket-80 .caja { border: 1px solid #000; padding: 3px 5px; }
      `}</style>

      {estadoImpresion !== null && (
        <p className="no-imprimir" style={{ marginBottom: 8, fontSize: 12, fontWeight: 600 }}>
          {estadoImpresion}
        </p>
      )}
      <div className="no-imprimir" style={{ marginBottom: 10, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => {
            const impresora = leerPreferenciasImpresion().impresoraTickets;
            const puente = window.alfajores?.impresion;
            if (impresora !== '' && puente) {
              setEstadoImpresion('Imprimiendo...');
              void puente
                .ticket(impresora, lineasEscPos(pedido, ordenes))
                .then((r) => setEstadoImpresion(r.ok ? `Ticket impreso en ${impresora}.` : (r.error ?? 'No se pudo imprimir.')));
              return;
            }
            window.print();
          }}
          style={{ height: 36, padding: '0 14px', border: '1px solid #8d5f23', background: '#8d5f23', color: '#fff', fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}
        >
          Imprimir
        </button>
        <button
          type="button"
          onClick={() => window.alfajores?.ventanas.cerrarme()}
          style={{ height: 36, padding: '0 14px', border: '1px solid #c9bda9', background: '#fff', fontWeight: 700, textTransform: 'uppercase', fontSize: 12 }}
        >
          Cerrar
        </button>
      </div>

      <div style={{ textAlign: 'center' }}>
        <h1>ORDEN DE ELABORACION</h1>
        <div className="chico">ANYULIN · Alfajores Corondinos</div>
      </div>

      <div className="sep" />

      <div className="caja" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>PEDIDO #{pedido.id}</div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{pedido.clienteNombre ?? 'MOSTRADOR'}</div>
      </div>

      <div className="chico" style={{ marginTop: 5 }}>
        <div>Cargado: {fechaLarga(pedido.fechaPedido)}</div>
        {pedido.vendedorNombre !== null && <div>Vendedor: {pedido.vendedorNombre}</div>}
        {pedido.cargadoPor !== null && <div>Tomo: {pedido.cargadoPor}</div>}
        <div>Impreso: {fechaLarga(new Date().toISOString())}</div>
      </div>

      <div className="sep" />
      <div style={{ fontWeight: 800, marginBottom: 3 }}>QUE HAY QUE ARMAR</div>

      {renglones.map((r) => (
        <div key={r.clave} style={{ marginBottom: 4 }}>
          <div className="fila">
            <span className="cant">{r.cantidad}</span>
            <span>{r.titulo}</span>
          </div>
          {r.detalle !== null && (
            <div className="chico" style={{ paddingLeft: 12 }}>
              {r.detalle}
            </div>
          )}
        </div>
      ))}

      {ordenes.length > 0 && (
        <>
          <div className="sep" />
          <div style={{ fontWeight: 800, marginBottom: 3 }}>TANDAS</div>
          {ordenes.map((o) => (
            <div key={o.id} className="chico">
              #{o.id} {o.articuloProducidoNombre} —{' '}
              {enUnidades(o.cantidadPlanificada, o.unidadesPorCaja, o.unidadAbreviatura)}
              {o.numeroLote !== null ? ` · Lote ${o.numeroLote}` : ''}
              {o.esperaInsumos && o.estado === 'planificada' ? ' · FALTAN INSUMOS' : ''}
            </div>
          ))}
        </>
      )}

      {pedido.notas !== null && pedido.notas !== '' && (
        <>
          <div className="sep" />
          <div style={{ fontWeight: 800 }}>NOTAS</div>
          <div>{pedido.notas}</div>
        </>
      )}

      <div className="sep" />
      <div className="chico" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Elaboro: ______________</span>
        <span>Hora: ______</span>
      </div>
      <div style={{ height: 12 }} />
    </div>
  );
}
