/**
 * Cartera de cheques — patron del modulo de cosecha.
 *
 * Pestañas Recibidos / Emitidos / Historial, indicadores de vencimiento arriba,
 * alta en un formulario modal (fisico o ECHEQ) y transiciones de estado por
 * fila. Los estados terminales (acreditado, endosado, anulado) van al historial.
 */

import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';

import {
  ETIQUETA_ESTADO_CHEQUE,
  TRANSICIONES_CHEQUE,
  type ChequeVista,
  type EntradaNuevoCheque,
  type EstadoCheque,
  type ResumenCartera,
  type TipoCheque,
} from '../../compartido/contratos';
import { Pastilla, TarjetaIndicador, type TonoPastilla } from '../componentes/comunes';
import { Tabla, type Columna } from '../componentes/Tabla';
import { COMANDO_SEED_DEMO, Vista } from '../componentes/Vista';
import { usarEventos } from '../ganchos/usarEventos';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  cambiarEstadoCheque,
  crearCheque,
  obtenerCheques,
  obtenerProveedores,
  obtenerResumenCartera,
} from '../servicios/cliente';
import type { ProveedorVista } from '../../compartido/contratos';
import { aCentavos, formatearFecha, formatearMoneda } from '../utiles/formato';

type Pestana = 'recibidos' | 'emitidos' | 'historial';

/** Estados vivos que se muestran en las pestañas operativas. */
const VIVOS: readonly EstadoCheque[] = ['en_cartera', 'depositado', 'entregado', 'rechazado'];

function tonoDeEstado(estado: EstadoCheque): TonoPastilla {
  switch (estado) {
    case 'acreditado':
      return 'positivo';
    case 'rechazado':
      return 'peligro';
    case 'depositado':
    case 'endosado':
      return 'info';
    case 'anulado':
      return 'neutro';
    default:
      return 'alerta'; // en_cartera / entregado: plata en la calle.
  }
}

export function PantallaCheques(): JSX.Element {
  const cheques = usarRecurso(() => obtenerCheques(), []);
  const resumen = usarRecurso<ResumenCartera>(() => obtenerResumenCartera(), []);
  const [pestana, setPestana] = useState<Pestana>('recibidos');
  const [modalAlta, setModalAlta] = useState(false);
  // El endoso no se puede resolver con un click: hay que saber a QUIEN se le
  // entrega el cheque, porque ese endoso le baja la deuda al proveedor.
  const [endosando, setEndosando] = useState<ChequeVista | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  const recargarTodo = (): void => {
    cheques.recargar();
    resumen.recargar();
  };
  usarEventos('cheques:cambio', recargarTodo);

  const aplicarTransicion = (cheque: ChequeVista, destino: EstadoCheque): void => {
    if (destino === 'anulado' && !window.confirm(`¿Anular el cheque ${cheque.numero}?`)) return;
    if (destino === 'endosado') {
      setEndosando(cheque);
      return;
    }
    if (destino === 'rechazado' && cheque.tipo === 'recibido') {
      const aviso =
        `El cheque ${cheque.numero} vuelve como rechazado.` +
        (cheque.entidadTipo === 'cliente'
          ? ' La deuda de la cuenta corriente se regenera automaticamente. ¿Confirmas?'
          : ' No esta vinculado a un cliente, asi que la deuda hay que asentarla a mano. ¿Confirmas?');
      if (!window.confirm(aviso)) return;
    }
    setErrorAccion(null);
    cambiarEstadoCheque(cheque.id, destino)
      .then(recargarTodo)
      .catch((causa: unknown) =>
        setErrorAccion(causa instanceof Error ? causa.message : String(causa)),
      );
  };

  const filtrados = useMemo(() => {
    const lista = cheques.datos ?? [];
    if (pestana === 'recibidos') return lista.filter((c) => c.tipo === 'recibido' && VIVOS.includes(c.estado));
    if (pestana === 'emitidos') return lista.filter((c) => c.tipo === 'emitido' && VIVOS.includes(c.estado));
    return lista;
  }, [cheques.datos, pestana]);

  const columnas = armarColumnas(aplicarTransicion);

  return (
    <div className="space-y-5">
      {resumen.datos !== null && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <TarjetaIndicador rotulo="En cartera" valor={String(resumen.datos.enCartera)} />
          <TarjetaIndicador
            rotulo="Importe en cartera"
            valor={formatearMoneda(resumen.datos.importeEnCartera)}
            tono="info"
          />
          <TarjetaIndicador
            rotulo="Vencen en 7 dias"
            valor={String(resumen.datos.porVencer7Dias)}
            tono={resumen.datos.porVencer7Dias > 0 ? 'alerta' : 'neutro'}
          />
          <TarjetaIndicador
            rotulo="Vencidos"
            valor={String(resumen.datos.vencidos)}
            detalle="Sin depositar ni cobrar"
            tono={resumen.datos.vencidos > 0 ? 'peligro' : 'positivo'}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
          {(
            [
              ['recibidos', 'Recibidos'],
              ['emitidos', 'Emitidos'],
              ['historial', 'Historial'],
            ] as const
          ).map(([clave, etiqueta]) => (
            <button
              key={clave}
              type="button"
              onClick={() => setPestana(clave)}
              className={[
                'rounded-pastilla px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-dulce-400',
                pestana === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
              ].join(' ')}
            >
              {etiqueta}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setModalAlta(true)}
          className="inline-flex items-center gap-1.5 rounded-ficha bg-dulce-600 px-4 py-2 text-sm font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Cargar cheque
        </button>
      </div>

      {errorAccion !== null && (
        <p role="alert" className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
          {errorAccion}
        </p>
      )}

      <Vista
        estado={cheques}
        que="la cartera de cheques"
        tituloVacio="Sin cheques cargados"
        detalleVacio="Carga el primero con el boton Nuevo cheque."
        comandoVacio={COMANDO_SEED_DEMO}
      >
        {() =>
          filtrados.length === 0 ? (
            <p className="rounded-ficha border border-dashed border-masa-300 bg-masa-50 px-4 py-8 text-center text-sm text-masa-800">
              No hay cheques en esta pestaña.
            </p>
          ) : (
            <Tabla columnas={columnas} filas={filtrados} claveDeFila={(c) => c.id} />
          )
        }
      </Vista>

      {endosando !== null && (
        <FormularioEndoso
          cheque={endosando}
          alCerrar={() => setEndosando(null)}
          alConfirmar={(proveedorId) =>
            cambiarEstadoCheque(endosando.id, 'endosado', proveedorId).then(() => {
              setEndosando(null);
              recargarTodo();
            })
          }
        />
      )}

      {modalAlta && (
        <FormularioAlta
          alCerrar={() => setModalAlta(false)}
          alGuardar={(entrada) =>
            crearCheque(entrada).then(() => {
              setModalAlta(false);
              recargarTodo();
            })
          }
        />
      )}
    </div>
  );
}

function armarColumnas(
  alCambiar: (cheque: ChequeVista, destino: EstadoCheque) => void,
): readonly Columna<ChequeVista>[] {
  return [
    {
      clave: 'numero',
      titulo: 'Numero',
      celda: (c) => (
        <span className="font-mono">
          {c.numero}
          {c.formato === 'echeq' && <Pastilla texto="ECHEQ" tono="info" />}
        </span>
      ),
    },
    { clave: 'banco', titulo: 'Banco', celda: (c) => c.banco ?? '—' },
    { clave: 'contraparte', titulo: 'Contraparte', celda: (c) => c.contraparte },
    { clave: 'importe', titulo: 'Importe', celda: (c) => formatearMoneda(c.importe), numerica: true },
    { clave: 'emision', titulo: 'Emision', celda: (c) => formatearFecha(c.fechaEmision), numerica: true },
    { clave: 'pago', titulo: 'Pago', celda: (c) => formatearFecha(c.fechaPago), numerica: true },
    {
      clave: 'estado',
      titulo: 'Estado',
      celda: (c) => <Pastilla texto={ETIQUETA_ESTADO_CHEQUE[c.estado]} tono={tonoDeEstado(c.estado)} />,
    },
    {
      clave: 'acciones',
      titulo: 'Acciones',
      celda: (c) => {
        const destinos = TRANSICIONES_CHEQUE[c.tipo][c.estado];
        if (destinos.length === 0) return <span className="text-masa-700">—</span>;
        return (
          <span className="flex flex-wrap gap-1.5">
            {destinos.map((destino) => (
              <button
                key={destino}
                type="button"
                onClick={() => alCambiar(c, destino)}
                className={[
                  'rounded-pastilla border px-2 py-0.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2',
                  destino === 'anulado' || destino === 'rechazado'
                    ? 'border-peligro-300 text-peligro-600 hover:bg-peligro-50 focus-visible:ring-peligro-400'
                    : 'border-dulce-400 text-dulce-700 hover:bg-dulce-50 focus-visible:ring-dulce-400',
                ].join(' ')}
              >
                {ETIQUETA_ESTADO_CHEQUE[destino]}
              </button>
            ))}
          </span>
        );
      },
    },
  ];
}

/* ------------------------------ Formulario alta ----------------------------- */

function FormularioAlta({
  alCerrar,
  alGuardar,
}: {
  readonly alCerrar: () => void;
  readonly alGuardar: (entrada: EntradaNuevoCheque) => Promise<void>;
}): JSX.Element {
  const hoy = new Date().toISOString().slice(0, 10);
  const [tipo, setTipo] = useState<TipoCheque>('recibido');
  const [formato, setFormato] = useState<'fisico' | 'echeq'>('fisico');
  const [numero, setNumero] = useState('');
  const [banco, setBanco] = useState('');
  const [cuitEmisor, setCuitEmisor] = useState('');
  const [contraparte, setContraparte] = useState('');
  const [importePesos, setImportePesos] = useState('');
  const [fechaEmision, setFechaEmision] = useState(hoy);
  const [fechaPago, setFechaPago] = useState(hoy);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const importe = aCentavos(Number(importePesos.replace(',', '.')));
  const valido = numero.trim() !== '' && contraparte.trim() !== '' && importe > 0;

  const guardar = (): void => {
    if (!valido || guardando) return;
    setGuardando(true);
    setError(null);
    alGuardar({
      tipo,
      formato,
      numero: numero.trim(),
      banco: banco.trim() || null,
      cuitEmisor: cuitEmisor.trim() || null,
      contraparte: contraparte.trim(),
      importe,
      fechaEmision,
      fechaPago,
      notas: notas.trim() || null,
    }).catch((causa: unknown) => {
      setError(causa instanceof Error ? causa.message : String(causa));
      setGuardando(false);
    });
  };

  const campo = 'h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';
  const rotulo = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-4"
      onMouseDown={alCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cargar cheque"
        onMouseDown={(evento) => evento.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-panel bg-white p-5 shadow-panel"
      >
        <h2 className="text-lg font-bold text-masa-900">Cargar cheque</h2>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <span className={rotulo}>Tipo</span>
            <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
              {(
                [
                  ['recibido', 'Recibido'],
                  ['emitido', 'Emitido'],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => setTipo(clave)}
                  className={[
                    'flex-1 rounded-pastilla px-2 py-1.5 text-sm font-medium outline-none',
                    tipo === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
                  ].join(' ')}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className={rotulo}>Formato</span>
            <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
              {(
                [
                  ['fisico', 'Fisico'],
                  ['echeq', 'ECHEQ'],
                ] as const
              ).map(([clave, etiqueta]) => (
                <button
                  key={clave}
                  type="button"
                  onClick={() => setFormato(clave)}
                  className={[
                    'flex-1 rounded-pastilla px-2 py-1.5 text-sm font-medium outline-none',
                    formato === clave ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
                  ].join(' ')}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="ch-numero" className={rotulo}>
              {formato === 'echeq' ? 'Identificador ECHEQ' : 'Numero'}
            </label>
            <input id="ch-numero" value={numero} onChange={(e) => setNumero(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="ch-banco" className={rotulo}>Banco</label>
            <input id="ch-banco" value={banco} onChange={(e) => setBanco(e.target.value)} className={campo} />
          </div>

          {formato === 'echeq' && (
            <div>
              <label htmlFor="ch-cuit" className={rotulo}>CUIT emisor</label>
              <input id="ch-cuit" value={cuitEmisor} onChange={(e) => setCuitEmisor(e.target.value)} className={campo} />
            </div>
          )}
          <div className={formato === 'echeq' ? '' : 'col-span-2'}>
            <label htmlFor="ch-contraparte" className={rotulo}>
              {tipo === 'recibido' ? 'Emitido por' : 'Entregado a'}
            </label>
            <input id="ch-contraparte" value={contraparte} onChange={(e) => setContraparte(e.target.value)} className={campo} />
          </div>

          <div>
            <label htmlFor="ch-importe" className={rotulo}>Importe ($)</label>
            <input
              id="ch-importe"
              value={importePesos}
              onChange={(e) => setImportePesos(e.target.value)}
              inputMode="decimal"
              placeholder="150000,00"
              className={`${campo} text-right font-mono`}
            />
          </div>
          <div />

          <div>
            <label htmlFor="ch-emision" className={rotulo}>Fecha de emision</label>
            <input id="ch-emision" type="date" value={fechaEmision} onChange={(e) => setFechaEmision(e.target.value)} className={campo} />
          </div>
          <div>
            <label htmlFor="ch-pago" className={rotulo}>Fecha de pago</label>
            <input id="ch-pago" type="date" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} className={campo} />
          </div>

          <div className="col-span-2">
            <label htmlFor="ch-notas" className={rotulo}>Notas</label>
            <input id="ch-notas" value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} />
          </div>
        </div>

        {error !== null && (
          <p role="alert" className="mt-3 rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={alCerrar}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-50 focus-visible:ring-2 focus-visible:ring-dulce-400"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!valido || guardando}
            className="rounded-ficha bg-dulce-600 px-4 py-2 text-sm font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300 disabled:text-masa-700"
          >
            {guardando ? 'Guardando...' : 'Guardar cheque'}
          </button>
        </div>
      </div>
    </div>
  );
}


/**
 * Endoso: a que proveedor se le entrega el cheque. Sin este dato el sistema
 * marcaba el cheque como endosado y la deuda del proveedor quedaba intacta:
 * habiamos pagado y seguiamos debiendo.
 */
function FormularioEndoso({
  cheque,
  alCerrar,
  alConfirmar,
}: {
  readonly cheque: ChequeVista;
  readonly alCerrar: () => void;
  readonly alConfirmar: (proveedorId: number) => Promise<void>;
}): JSX.Element {
  const [proveedores, setProveedores] = useState<ProveedorVista[]>([]);
  const [proveedorId, setProveedorId] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    obtenerProveedores()
      .then((lista) => setProveedores(lista.filter((p) => p.activo)))
      .catch((causa: unknown) => setError(causa instanceof Error ? causa.message : String(causa)));
  }, []);

  const elegido = proveedores.find((p) => p.id === proveedorId);
  const deuda = elegido === undefined ? 0 : -elegido.saldoCc;

  const confirmar = (): void => {
    if (proveedorId === '' || guardando) return;
    setGuardando(true);
    setError(null);
    alConfirmar(proveedorId).catch((causa: unknown) => {
      setError(causa instanceof Error ? causa.message : String(causa));
      setGuardando(false);
    });
  };

  const campo =
    'h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400';
  const rotulo = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-4"
      onMouseDown={alCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-ficha border-2 border-masa-300 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="border-b border-masa-200 px-4 py-3">
          <h2 className="text-base font-semibold text-masa-900">Endosar cheque {cheque.numero}</h2>
          <p className="mt-0.5 text-sm text-masa-700">
            Se le entrega a un proveedor por {formatearMoneda(cheque.importe)}: le baja la deuda por ese importe.
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div>
            <label className={rotulo} htmlFor="endoso-proveedor">
              Proveedor
            </label>
            <select
              id="endoso-proveedor"
              className={campo}
              value={proveedorId}
              onChange={(e) => setProveedorId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">Elegi el proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>

          {elegido !== undefined && (
            <p className="rounded-ficha border border-masa-200 bg-masa-50 px-3 py-2 text-sm text-masa-800">
              Le debemos <strong className="font-mono">{formatearMoneda(Math.max(deuda, 0))}</strong>
              {cheque.importe > deuda && deuda >= 0 && ' — el cheque supera la deuda y queda saldo a favor nuestro.'}
            </p>
          )}

          {error !== null && (
            <p className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-masa-200 px-4 py-3">
          <button type="button" className="h-10 px-4 text-sm text-masa-800" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            type="button"
            className="h-10 bg-dulce-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
            disabled={proveedorId === '' || guardando}
            onClick={confirmar}
          >
            {guardando ? 'Endosando…' : 'Endosar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
