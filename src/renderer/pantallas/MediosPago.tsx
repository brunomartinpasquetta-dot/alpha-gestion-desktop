/**
 * ABM de medios de pago (formas de pago), copiado del modelo de StockFlow:
 * tabla configurable con tipo, comision/interes del medio (porcentaje que
 * absorbe el comercio y queda registrado en cada venta), efectivo fisico
 * (unico que entra al arqueo) y orden de aparicion en el cobro.
 */

import { useState } from 'react';

import type { MedioPagoVista, TipoMedioPago } from '../../compartido/contratos';
import { EstadoCargando, EstadoError, Pastilla, Seccion } from '../componentes/comunes';
import { CampoNumero, CampoSelector, CampoTexto, ModalFormulario } from '../componentes/Formulario';
import { usarRecurso } from '../ganchos/usarRecurso';
import { actualizarMedioPago, crearMedioPago, obtenerMediosPago } from '../servicios/cliente';

const TIPOS: readonly { valor: TipoMedioPago; etiqueta: string }[] = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'tarjeta_debito', etiqueta: 'Tarjeta de debito' },
  { valor: 'tarjeta_credito', etiqueta: 'Tarjeta de credito' },
  { valor: 'cheque', etiqueta: 'Cheque' },
  { valor: 'otro', etiqueta: 'Otro' },
];

interface FormMedio {
  nombre: string;
  tipo: TipoMedioPago;
  esEfectivoFisico: boolean;
  comisionPct: number | '';
  orden: number | '';
  activo: boolean;
}

const FORM_VACIO: FormMedio = {
  nombre: '',
  tipo: 'efectivo',
  esEfectivoFisico: false,
  comisionPct: 0,
  orden: 0,
  activo: true,
};

export function PantallaMediosPago(): JSX.Element {
  const medios = usarRecurso<MedioPagoVista[]>(() => obtenerMediosPago(), []);
  const [editando, setEditando] = useState<MedioPagoVista | null | 'nuevo'>(null);
  const [form, setForm] = useState<FormMedio>(FORM_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (medios.cargando) return <EstadoCargando que="los medios de pago" />;
  if (medios.error !== null) return <EstadoError mensaje={medios.error} alReintentar={medios.recargar} />;
  const lista = [...(medios.datos ?? [])].sort((a, b) => a.orden - b.orden || a.id - b.id);

  const abrir = (medio: MedioPagoVista | 'nuevo'): void => {
    setForm(
      medio === 'nuevo'
        ? FORM_VACIO
        : {
            nombre: medio.nombre,
            tipo: medio.tipo,
            esEfectivoFisico: medio.esEfectivoFisico,
            comisionPct: medio.comisionPct,
            orden: medio.orden,
            activo: medio.activo,
          },
    );
    setError(null);
    setEditando(medio);
  };

  const guardar = (): void => {
    if (form.nombre.trim().length < 2) {
      setError('El nombre tiene que tener al menos 2 caracteres.');
      return;
    }
    setGuardando(true);
    setError(null);
    const comun = {
      nombre: form.nombre.trim(),
      tipo: form.tipo,
      esEfectivoFisico: form.esEfectivoFisico,
      comisionPct: form.comisionPct === '' ? 0 : form.comisionPct,
      orden: form.orden === '' ? 0 : form.orden,
    };
    const operacion =
      editando === 'nuevo'
        ? crearMedioPago(comun)
        : actualizarMedioPago((editando as MedioPagoVista).id, { ...comun, activo: form.activo });
    operacion
      .then(() => {
        setAviso(editando === 'nuevo' ? 'Medio de pago creado.' : 'Medio de pago actualizado.');
        setEditando(null);
        setGuardando(false);
        medios.recargar();
        setTimeout(() => setAviso(null), 4000);
      })
      .catch((causa: unknown) => {
        setError(causa instanceof Error ? causa.message : String(causa));
        setGuardando(false);
      });
  };

  return (
    <div className="space-y-4">
      <Seccion
        titulo="Medios de pago"
        acciones={
          <button
            type="button"
            onClick={() => abrir('nuevo')}
            className="h-9 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase tracking-wide text-white"
          >
            Nuevo medio
          </button>
        }
      >
        {aviso !== null && (
          <p className="mb-2 rounded-ficha border border-menta-300 bg-menta-50 px-3 py-1.5 text-sm text-menta-800">
            {aviso}
          </p>
        )}
        <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                <th className="px-3 py-2 font-semibold">Orden</th>
                <th className="px-3 py-2 font-semibold">Nombre</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 text-right font-semibold">Comision / interes</th>
                <th className="px-3 py-2 font-semibold">Arqueo</th>
                <th className="px-3 py-2 font-semibold">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lista.map((medio) => (
                <tr key={medio.id} className={['border-b border-masa-100', !medio.activo ? 'opacity-50' : ''].join(' ')}>
                  <td className="px-3 py-2 font-mono tabular-nums text-masa-700">{medio.orden}</td>
                  <td className="px-3 py-2 font-medium text-masa-900">{medio.nombre}</td>
                  <td className="px-3 py-2 text-masa-800">
                    {TIPOS.find((t) => t.valor === medio.tipo)?.etiqueta ?? medio.tipo}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-masa-900">
                    {medio.comisionPct > 0 ? `${medio.comisionPct}%` : '—'}
                  </td>
                  <td className="px-3 py-2">
                    {medio.esEfectivoFisico ? <Pastilla texto="Entra al arqueo" tono="positivo" /> : <Pastilla texto="Electronico" />}
                  </td>
                  <td className="px-3 py-2">
                    {medio.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => abrir(medio)}
                      className="h-8 rounded-none border border-masa-300 bg-white px-3 text-xs font-bold uppercase text-masa-800"
                    >
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-masa-700">
          La comision/interes del medio queda registrada en cada venta (el cliente paga el importe
          integro; el porcentaje lo absorbe el comercio, como la comision de la tarjeta). Solo los
          medios marcados "Entra al arqueo" cuentan al cerrar la caja.
        </p>
      </Seccion>

      {editando !== null && (
        <ModalFormulario
          titulo={editando === 'nuevo' ? 'Nuevo medio de pago' : `Editar ${(editando as MedioPagoVista).nombre}`}
          descripcion="El orden define como aparecen en el cobro. La comision es el porcentaje del medio (interes de tarjeta, costo de pasarela)."
          ancho="max-w-lg"
          error={error}
          guardando={guardando}
          puedeGuardar={form.nombre.trim().length >= 2}
          etiquetaGuardar={editando === 'nuevo' ? 'Crear medio' : 'Guardar cambios'}
          alCerrar={() => setEditando(null)}
          alGuardar={guardar}
        >
          <CampoTexto id="mp-nombre" rotulo="Nombre" valor={form.nombre} alCambiar={(v) => setForm({ ...form, nombre: v })} maximo={60} />
          <CampoSelector
            id="mp-tipo"
            rotulo="Tipo"
            valor={form.tipo}
            opciones={TIPOS.map((t) => ({ valor: t.valor, etiqueta: t.etiqueta }))}
            alCambiar={(v) => setForm({ ...form, tipo: v as TipoMedioPago })}
          />
          <CampoNumero id="mp-comision" rotulo="Comision / interes (%)" valor={form.comisionPct} alCambiar={(v) => setForm({ ...form, comisionPct: v })} />
          <CampoNumero id="mp-orden" rotulo="Orden en el cobro" valor={form.orden} alCambiar={(v) => setForm({ ...form, orden: v })} />
          <label className="flex items-center gap-2 text-sm text-masa-900">
            <input
              type="checkbox"
              checked={form.esEfectivoFisico}
              onChange={(e) => setForm({ ...form, esEfectivoFisico: e.target.checked })}
            />
            Es efectivo fisico (billetes al cajon: entra al arqueo del cierre)
          </label>
          {editando !== 'nuevo' && (
            <label className="flex items-center gap-2 text-sm text-masa-900">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              />
              Activo (se ofrece al cobrar)
            </label>
          )}
        </ModalFormulario>
      )}
    </div>
  );
}
