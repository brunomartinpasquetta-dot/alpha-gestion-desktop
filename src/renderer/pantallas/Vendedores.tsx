/**
 * ABM de vendedores (revendedores): quienes traen pedidos de otros clientes.
 *
 * Misma regla que el resto de los maestros: no se borra, se desactiva. La
 * pantalla muestra ademas que clientes tienen asignado a cada vendedor, que es
 * lo que decide el vendedor propuesto al cargar un pedido.
 */

import { useState } from 'react';

import type { ClienteVista, VendedorVista } from '../../compartido/contratos';
import { BotonWhatsApp } from '../componentes/whatsapp';
import { EstadoCargando, EstadoError, Pastilla, Seccion } from '../componentes/comunes';
import { CampoSelector, CampoTexto, ModalFormulario } from '../componentes/Formulario';
import { usarRecurso } from '../ganchos/usarRecurso';
import {
  actualizarVendedor,
  crearVendedor,
  obtenerClientes,
  obtenerVendedores,
} from '../servicios/cliente';

interface FormVendedor {
  nombre: string;
  telefono: string;
  cuit: string;
  clienteId: number | '';
  notas: string;
  activo: boolean;
}

const FORM_VACIO: FormVendedor = { nombre: '', telefono: '', cuit: '', clienteId: '', notas: '', activo: true };

export function PantallaVendedores(): JSX.Element {
  const vendedores = usarRecurso<VendedorVista[]>(() => obtenerVendedores(), []);
  const clientes = usarRecurso<ClienteVista[]>(() => obtenerClientes(), []);
  const [editando, setEditando] = useState<VendedorVista | null | 'nuevo'>(null);
  const [form, setForm] = useState<FormVendedor>(FORM_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  if (vendedores.cargando) return <EstadoCargando que="los vendedores" />;
  if (vendedores.error !== null)
    return <EstadoError mensaje={vendedores.error} alReintentar={vendedores.recargar} />;
  const lista = vendedores.datos ?? [];
  const todosLosClientes = clientes.datos ?? [];

  const clientesDe = (vendedorId: number): ClienteVista[] =>
    todosLosClientes.filter((c) => c.vendedorId === vendedorId && c.activo);

  const abrirNuevo = (): void => {
    setForm(FORM_VACIO);
    setError(null);
    setEditando('nuevo');
  };

  const abrirEdicion = (v: VendedorVista): void => {
    setForm({
      nombre: v.nombre,
      telefono: v.telefono ?? '',
      cuit: v.cuit ?? '',
      clienteId: v.clienteId ?? '',
      notas: v.notas ?? '',
      activo: v.activo,
    });
    setError(null);
    setEditando(v);
  };

  const guardar = (): void => {
    if (form.nombre.trim().length < 2) {
      setError('El nombre tiene que tener al menos 2 caracteres.');
      return;
    }
    setGuardando(true);
    setError(null);
    const operacion =
      editando === 'nuevo'
        ? crearVendedor({
            nombre: form.nombre,
            telefono: form.telefono.trim() || null,
            cuit: form.cuit.trim() || null,
            clienteId: form.clienteId === '' ? null : form.clienteId,
            notas: form.notas.trim() || null,
          })
        : actualizarVendedor((editando as VendedorVista).id, {
            nombre: form.nombre,
            telefono: form.telefono.trim() || null,
            cuit: form.cuit.trim() || null,
            clienteId: form.clienteId === '' ? null : form.clienteId,
            notas: form.notas.trim() || null,
            activo: form.activo,
          });
    operacion
      .then(() => {
        setAviso(editando === 'nuevo' ? 'Vendedor creado.' : 'Vendedor actualizado.');
        setEditando(null);
        setGuardando(false);
        vendedores.recargar();
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
        titulo="Vendedores"
        acciones={
          <button
            type="button"
            onClick={abrirNuevo}
            className="h-9 rounded-none border border-dulce-400 bg-dulce-500 px-4 text-sm font-bold uppercase tracking-wide text-white"
          >
            Nuevo vendedor
          </button>
        }
      >
        {aviso !== null && (
          <p className="mb-2 rounded-ficha border border-menta-300 bg-menta-50 px-3 py-1.5 text-sm text-menta-800">
            {aviso}
          </p>
        )}
        {lista.length === 0 ? (
          <p className="rounded-ficha border border-masa-200 bg-white px-3 py-4 text-sm text-masa-700">
            Todavia no hay vendedores cargados.
          </p>
        ) : (
          <div className="overflow-hidden rounded-ficha border border-masa-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-masa-200 text-left text-micro uppercase tracking-wide text-masa-700">
                  <th className="px-3 py-2 font-semibold">Nombre</th>
                  <th className="px-3 py-2 font-semibold">Telefono</th>
                  <th className="px-3 py-2 font-semibold">CUIT</th>
                  <th className="px-3 py-2 font-semibold">Clientes asignados</th>
                  <th className="px-3 py-2 font-semibold">Notas</th>
                  <th className="px-3 py-2 font-semibold">Estado</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {lista.map((v) => {
                  const asignados = clientesDe(v.id);
                  return (
                    <tr key={v.id} className={['border-b border-masa-100', !v.activo ? 'opacity-50' : ''].join(' ')}>
                      <td className="px-3 py-2 font-medium text-masa-900">{v.nombre}</td>
                      <td className="px-3 py-2 text-masa-800">
                        <span className="inline-flex items-center gap-1">
                          {v.telefono ?? '—'}
                          <BotonWhatsApp telefono={v.telefono} />
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-masa-800">{v.cuit ?? '—'}</td>
                      <td className="px-3 py-2 text-masa-800">
                        {asignados.length === 0
                          ? '—'
                          : asignados.map((c) => c.nombre).join(', ')}
                      </td>
                      <td className="px-3 py-2 text-masa-700">{v.notas ?? '—'}</td>
                      <td className="px-3 py-2">
                        {v.activo ? <Pastilla texto="Activo" tono="positivo" /> : <Pastilla texto="Inactivo" />}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => abrirEdicion(v)}
                          className="h-8 rounded-none border border-masa-300 bg-white px-3 text-xs font-bold uppercase text-masa-800"
                        >
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Seccion>

      {editando !== null && (
        <ModalFormulario
          titulo={editando === 'nuevo' ? 'Nuevo vendedor' : `Editar ${(editando as VendedorVista).nombre}`}
          descripcion="El vendedor se propone solo al cargar pedidos de sus clientes asignados (la asignacion se hace en la ficha de cada cliente)."
          ancho="max-w-lg"
          error={error}
          guardando={guardando}
          puedeGuardar={form.nombre.trim().length >= 2}
          etiquetaGuardar={editando === 'nuevo' ? 'Crear vendedor' : 'Guardar cambios'}
          alCerrar={() => setEditando(null)}
          alGuardar={guardar}
        >
          <CampoTexto id="ve-nombre" rotulo="Nombre" valor={form.nombre} alCambiar={(v) => setForm({ ...form, nombre: v })} maximo={80} />
          <CampoTexto id="ve-telefono" rotulo="Telefono" valor={form.telefono} alCambiar={(v) => setForm({ ...form, telefono: v })} maximo={40} />
          <CampoTexto id="ve-cuit" rotulo="CUIT (11 digitos)" valor={form.cuit} alCambiar={(v) => setForm({ ...form, cuit: v })} maximo={13} />
          <CampoSelector
            id="ve-cliente"
            rotulo="Ficha de cliente vinculada (para facturarle a el)"
            valor={form.clienteId}
            vacio="Sin ficha: no se le puede facturar"
            opciones={todosLosClientes.filter((c) => c.activo).map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
            alCambiar={(v) => setForm({ ...form, clienteId: v === '' ? '' : Number(v) })}
          />
          <CampoTexto id="ve-notas" rotulo="Notas" valor={form.notas} alCambiar={(v) => setForm({ ...form, notas: v })} maximo={300} />
          {editando !== 'nuevo' && (
            <label className="flex items-center gap-2 text-sm text-masa-900">
              <input
                type="checkbox"
                checked={form.activo}
                onChange={(e) => setForm({ ...form, activo: e.target.checked })}
              />
              Activo (aparece en los desplegables de pedidos y clientes)
            </label>
          )}
        </ModalFormulario>
      )}
    </div>
  );
}
