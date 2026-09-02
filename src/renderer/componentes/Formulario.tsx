/**
 * Piezas comunes de los formularios de alta y edicion.
 *
 * Existen para que los seis ABM del sistema se vean y se comporten igual: mismo
 * modal, mismos campos, mismo lugar para el error, mismo par de botones. Cuando
 * cada pantalla arma su propio formulario, terminan divergiendo en detalles que
 * el operador percibe como que "cada pantalla funciona distinto".
 */

import type { ReactNode } from 'react';

const CLASE_CAMPO =
  'h-10 w-full rounded-ficha border border-masa-300 bg-white px-3 text-sm text-masa-900 outline-none focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-100 disabled:text-masa-700';
const CLASE_ROTULO = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-masa-700';

/** Modal con cabecera, cuerpo desplazable y pie de acciones. */
export function ModalFormulario({
  titulo,
  descripcion,
  error,
  guardando,
  etiquetaGuardar = 'Guardar',
  puedeGuardar = true,
  ancho = 'max-w-lg',
  alCerrar,
  alGuardar,
  children,
  pieIzquierdo,
}: {
  readonly titulo: string;
  readonly descripcion?: string;
  readonly error?: string | null;
  readonly guardando?: boolean;
  readonly etiquetaGuardar?: string;
  readonly puedeGuardar?: boolean;
  readonly ancho?: string;
  readonly alCerrar: () => void;
  readonly alGuardar: () => void;
  readonly children: ReactNode;
  readonly pieIzquierdo?: ReactNode;
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-masa-900/50 p-4"
      onMouseDown={alCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onMouseDown={(evento) => evento.stopPropagation()}
        className={`flex max-h-[92vh] w-full ${ancho} flex-col overflow-hidden rounded-panel bg-white shadow-panel`}
      >
        <div className="border-b border-masa-200 px-5 py-4">
          <h2 className="text-lg font-bold text-masa-900">{titulo}</h2>
          {descripcion !== undefined && <p className="mt-0.5 text-sm text-masa-700">{descripcion}</p>}
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {children}
          {error != null && error !== '' && (
            <p
              role="alert"
              className="rounded-ficha border border-peligro-200 bg-peligro-50 px-3 py-2 text-sm text-peligro-600"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-masa-200 bg-masa-50 px-5 py-3">
          <div className="min-w-0 text-sm text-masa-800">{pieIzquierdo}</div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={alCerrar}
              className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-dulce-400"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={alGuardar}
              disabled={guardando === true || !puedeGuardar}
              className="rounded-ficha bg-dulce-600 px-5 py-2 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300 disabled:text-masa-700"
            >
              {guardando === true ? 'Guardando...' : etiquetaGuardar}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CampoTexto({
  id,
  rotulo,
  valor,
  alCambiar,
  ayuda,
  marcador,
  maximo = 200,
  requerido = false,
  deshabilitado = false,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: string;
  readonly alCambiar: (valor: string) => void;
  readonly ayuda?: string;
  readonly marcador?: string;
  readonly maximo?: number;
  readonly requerido?: boolean;
  readonly deshabilitado?: boolean;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ROTULO}>
        {rotulo}
        {requerido && <span className="ml-1 text-peligro-600">*</span>}
      </label>
      <input
        id={id}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={marcador}
        maxLength={maximo}
        disabled={deshabilitado}
        className={CLASE_CAMPO}
      />
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

/** Campo de fecha (AAAA-MM-DD), con el mismo alto y borde que el resto. */
export function CampoFecha({
  id,
  rotulo,
  valor,
  alCambiar,
  ayuda,
  requerido = false,
  deshabilitado = false,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: string;
  readonly alCambiar: (valor: string) => void;
  readonly ayuda?: string;
  readonly requerido?: boolean;
  readonly deshabilitado?: boolean;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ROTULO}>
        {rotulo}
        {requerido && <span className="ml-1 text-peligro-600">*</span>}
      </label>
      <input
        id={id}
        type="date"
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        disabled={deshabilitado}
        className={CLASE_CAMPO}
      />
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

/**
 * Campo de dinero. Trabaja en PESOS de cara al usuario y entrega CENTAVOS
 * enteros: la conversion vive aca y no en cada pantalla, que es donde se
 * cuelan los errores de redondeo.
 */
export function CampoMoneda({
  id,
  rotulo,
  centavos,
  alCambiar,
  ayuda,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly centavos: number;
  readonly alCambiar: (centavos: number) => void;
  readonly ayuda?: string;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ROTULO}>
        {rotulo}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-masa-700">$</span>
        <input
          id={id}
          value={centavos === 0 ? '' : String(centavos / 100)}
          onChange={(e) => {
            const numero = Number(e.target.value.replace(',', '.'));
            alCambiar(Number.isFinite(numero) && numero >= 0 ? Math.round(numero * 100) : 0);
          }}
          inputMode="decimal"
          placeholder="0,00"
          className={`${CLASE_CAMPO} pl-7 text-right font-mono tabular-nums`}
        />
      </div>
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

export function CampoNumero({
  id,
  rotulo,
  valor,
  alCambiar,
  ayuda,
  minimo = 0,
  paso = 'any',
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: number | '';
  readonly alCambiar: (valor: number | '') => void;
  readonly ayuda?: string;
  readonly minimo?: number;
  readonly paso?: string;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ROTULO}>
        {rotulo}
      </label>
      <input
        id={id}
        type="number"
        min={minimo}
        step={paso}
        value={valor}
        onChange={(e) => alCambiar(e.target.value === '' ? '' : Number(e.target.value))}
        className={`${CLASE_CAMPO} text-right font-mono tabular-nums`}
      />
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

export function CampoSelector<T extends string | number>({
  id,
  rotulo,
  valor,
  opciones,
  alCambiar,
  ayuda,
  vacio,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly valor: T | '';
  readonly opciones: readonly { readonly valor: T; readonly etiqueta: string }[];
  readonly alCambiar: (valor: T | '') => void;
  readonly ayuda?: string;
  /** Texto de la opcion vacia. Si se omite, el campo es obligatorio. */
  readonly vacio?: string;
}): JSX.Element {
  return (
    <div>
      <label htmlFor={id} className={CLASE_ROTULO}>
        {rotulo}
      </label>
      <select
        id={id}
        value={valor}
        onChange={(e) => {
          const bruto = e.target.value;
          if (bruto === '') return alCambiar('');
          const opcion = opciones.find((o) => String(o.valor) === bruto);
          alCambiar(opcion === undefined ? '' : opcion.valor);
        }}
        className={CLASE_CAMPO}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={String(o.valor)} value={String(o.valor)}>
            {o.etiqueta}
          </option>
        ))}
      </select>
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

/** Grupo de botones excluyentes. Para 2 o 3 opciones cortas. */
export function CampoOpciones<T extends string>({
  rotulo,
  valor,
  opciones,
  alCambiar,
  ayuda,
}: {
  readonly rotulo: string;
  readonly valor: T;
  readonly opciones: readonly { readonly valor: T; readonly etiqueta: string }[];
  readonly alCambiar: (valor: T) => void;
  readonly ayuda?: string;
}): JSX.Element {
  return (
    <div>
      <span className={CLASE_ROTULO}>{rotulo}</span>
      <div className="flex gap-1 rounded-ficha border border-masa-200 bg-masa-50 p-1">
        {opciones.map((o) => (
          <button
            key={o.valor}
            type="button"
            onClick={() => alCambiar(o.valor)}
            className={[
              'flex-1 rounded-pastilla px-2 py-1.5 text-sm font-medium outline-none',
              valor === o.valor ? 'bg-dulce-600 text-white' : 'text-masa-800 hover:bg-masa-100',
            ].join(' ')}
          >
            {o.etiqueta}
          </button>
        ))}
      </div>
      {ayuda !== undefined && <p className="mt-1 text-xs text-masa-700">{ayuda}</p>}
    </div>
  );
}

/** Dos columnas en pantallas anchas, una sola en angostas. */
export function Fila({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>;
}

/** Aviso de resultado de una operacion, con el tono segun como salio. */
export function Aviso({
  tono,
  texto,
}: {
  readonly tono: 'ok' | 'alerta' | 'mal';
  readonly texto: string;
}): JSX.Element {
  return (
    <p
      role={tono === 'mal' ? 'alert' : 'status'}
      className={[
        'rounded-ficha border px-3 py-2 text-sm',
        tono === 'ok' ? 'border-menta-200 bg-menta-50 text-menta-700' : '',
        tono === 'alerta' ? 'border-alerta-200 bg-alerta-50 text-alerta-700' : '',
        tono === 'mal' ? 'border-peligro-200 bg-peligro-50 text-peligro-600' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {texto}
    </p>
  );
}

/** Boton de accion principal de una pantalla (el "Nuevo ..." de cada modulo). */
export function BotonPrimario({
  onClick,
  children,
}: {
  readonly onClick: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-ficha bg-dulce-600 px-4 py-2 text-sm font-medium text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400"
    >
      {children}
    </button>
  );
}

/** Boton chico para la columna de acciones de una tabla. */
export function BotonFila({
  onClick,
  tono = 'neutro',
  children,
}: {
  readonly onClick: () => void;
  readonly tono?: 'neutro' | 'peligro';
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-pastilla border px-2 py-0.5 text-xs font-medium outline-none focus-visible:ring-2',
        tono === 'peligro'
          ? 'border-peligro-300 text-peligro-600 hover:bg-peligro-50 focus-visible:ring-peligro-400'
          : 'border-masa-300 text-masa-800 hover:bg-masa-100 focus-visible:ring-dulce-400',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
