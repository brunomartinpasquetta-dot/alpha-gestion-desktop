/**
 * Manual de uso y estado del sistema.
 *
 * Esta escrito para el operador de la fabrica, no para quien programo: explica
 * el CIRCUITO —que pasa cuando aprieta cada boton y por que— antes que la
 * pantalla. Alguien que entiende que la venta descuenta stock y carga la cuenta
 * corriente en un solo acto no necesita que le expliquen donde esta el boton.
 */

import { useState } from 'react';

import { NOMBRE_PRODUCTO, VERSION_APP } from '../../compartido/config';
import { Aviso } from '../componentes/Formulario';
import type { ResultadoChequeoActualizacion } from '../tipos-globales';

function Seccion({
  titulo,
  children,
}: {
  readonly titulo: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="rounded-ficha border border-masa-200 bg-white px-5 py-4 shadow-ficha">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-masa-700">{titulo}</h2>
      <div className="mt-2 space-y-2 text-sm text-masa-900">{children}</div>
    </section>
  );
}

function Paso({
  n,
  titulo,
  children,
}: {
  readonly n: number;
  readonly titulo: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dulce-600 text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-masa-900">{titulo}</p>
        <p className="text-masa-800">{children}</p>
      </div>
    </div>
  );
}

/* ------------------------------ Actualizaciones ---------------------------- */

function PanelActualizaciones(): JSX.Element {
  const [estado, setEstado] = useState<ResultadoChequeoActualizacion | null>(null);
  const [buscando, setBuscando] = useState(false);
  const disponible = typeof window.alfajores?.actualizaciones?.verificar === 'function';

  const verificar = (): void => {
    setBuscando(true);
    setEstado(null);
    void window.alfajores?.actualizaciones
      .verificar()
      .then(setEstado)
      .finally(() => setBuscando(false));
  };

  return (
    <Seccion titulo="Version y actualizaciones">
      <p>
        Estas usando <strong>{NOMBRE_PRODUCTO} {VERSION_APP}</strong>.
      </p>
      <p className="text-masa-800">
        El programa busca actualizaciones solo cada tanto y las instala al cerrarse, asi nunca te
        interrumpe en el medio del trabajo. Igual podes buscarlas ahora.
      </p>

      {disponible && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            type="button"
            onClick={verificar}
            disabled={buscando}
            className="rounded-ficha bg-dulce-600 px-4 py-2 text-sm font-bold text-white outline-none hover:bg-dulce-700 focus-visible:ring-2 focus-visible:ring-dulce-400 disabled:bg-masa-300"
          >
            {buscando ? 'Buscando...' : 'Buscar actualizaciones'}
          </button>
          <button
            type="button"
            onClick={() => window.alfajores?.actualizaciones.abrirDescargas()}
            className="rounded-ficha border border-masa-300 px-4 py-2 text-sm font-medium text-masa-800 outline-none hover:bg-masa-100"
          >
            Ver pagina de descargas
          </button>
        </div>
      )}

      {estado !== null && (
        <div className="pt-1">
          <Aviso tono={estado.hayActualizacion ? 'alerta' : 'ok'} texto={estado.mensaje} />
        </div>
      )}
    </Seccion>
  );
}

/* ---------------------------------- Manual --------------------------------- */

export function PantallaAyuda(): JSX.Element {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PanelActualizaciones />

      <Seccion titulo="Como se usa, de punta a punta">
        <p className="text-masa-800">
          El sistema sigue el recorrido real de la fabrica. Cada paso deja su rastro y alimenta al
          siguiente.
        </p>
        <div className="mt-3 space-y-3">
          <Paso n={1} titulo="Entra un pedido">
            Desde el celular (la direccion aparece en el panel principal) o desde{' '}
            <strong>Comercial → Pedidos → Nuevo pedido</strong>. Se pide en cajas cerradas. El
            pedido aparece solo en la pantalla de la fabrica, sin refrescar nada.
          </Paso>
          <Paso n={2} titulo="Se planifica la produccion">
            En <strong>Produccion → Ordenes → Planificar orden</strong>: elegis la receta y el
            factor de escala. La cantidad sale del rinde de la receta, no se escribe a mano.
          </Paso>
          <Paso n={3} titulo="Se ejecuta la tanda">
            El boton <strong>Ejecutar</strong> le asigna el numero de lote. Ese numero es lo que
            despues permite rastrear que insumos se usaron y a que clientes fue.
          </Paso>
          <Paso n={4} titulo="Se finaliza">
            Al finalizar, el sistema descuenta los insumos segun la receta e ingresa el producto
            terminado. Si algun insumo queda en negativo, avisa pero no bloquea: la tanda fisica ya
            se hizo, y el aviso significa que faltan compras por cargar.
          </Paso>
          <Paso n={5} titulo="Se vende">
            <strong>Comercial → Ventas → Nueva venta</strong>. En un solo acto descuenta el stock,
            cobra (a la caja o a la cuenta corriente del cliente), marca el pedido como entregado y
            emite el comprobante.
          </Paso>
          <Paso n={6} titulo="Se entrega el papel">
            El boton <strong>Imprimir</strong> de la grilla de ventas saca el remito o la factura,
            con el CAE y el QR si es factura electronica.
          </Paso>
        </div>
      </Seccion>

      <Seccion titulo="Lo que conviene entender">
        <p>
          <strong>El stock no se edita, se mueve.</strong> El saldo de cada articulo es la suma de
          sus movimientos: compras, produccion, ventas y ajustes. Por eso podes hacer clic en
          cualquier articulo y ver exactamente de donde sale su numero. Si hay que corregirlo
          —rotura, merma, un recuento— se usa <strong>Ajustar stock</strong>, que asienta la
          diferencia con su motivo en vez de pisar el numero.
        </p>
        <p>
          <strong>Nada se borra.</strong> Dar de baja un cliente o un articulo lo saca de los
          formularios pero conserva su historia, porque hay ventas y compras que lo referencian.
          Anular una venta no la borra: escribe los movimientos inversos, asi queda el rastro de que
          existio y de que se anulo.
        </p>
        <p>
          <strong>La caja tiene que estar abierta.</strong> Las ventas y compras de contado entran o
          salen de la caja abierta del dia. Si no hay ninguna, la operacion se registra igual pero
          te avisa, porque esa plata quedo sin asentar en ningun arqueo.
        </p>
        <p>
          <strong>Los precios guardan historia.</strong> Cargar un precio nuevo no pisa al anterior:
          rige desde hoy. Asi una venta de marzo se puede entender con el precio que tenia en marzo.
        </p>
      </Seccion>

      <Seccion titulo="Facturacion electronica (ARCA)">
        <p>
          La factura se emite <strong>dentro de la venta</strong>, no en una pantalla aparte. Al
          confirmar una venta con Factura A o B, el sistema le pide el CAE a ARCA y solo registra la
          operacion si ARCA la autoriza. Si la rechaza, la venta no se guarda y no se consume
          numeracion.
        </p>
        <p>
          Para que funcione hace falta cargar, en <strong>Consultas → Facturacion</strong>, el CUIT,
          el certificado digital y la clave privada del tramite de ARCA, y el punto de venta dado de
          alta. El boton <strong>Probar conexion</strong> verifica todo eso antes de facturar de
          verdad.
        </p>
        <p className="text-masa-800">
          La Factura A exige un cliente con CUIT cargado. Si no lo tiene, el sistema lo avisa antes
          de intentar emitirla.
        </p>
      </Seccion>

      <Seccion titulo="Pedidos desde el celular">
        <p>
          El telefono tiene que estar en la <strong>misma red WiFi</strong> que esta computadora. La
          direccion para abrir en el celular aparece en el panel principal, debajo del logo.
        </p>
        <p>
          Funciona <strong>sin senal</strong>: si se corta el internet, el pedido queda en una cola
          en el telefono y se envia solo cuando vuelve. No se duplica aunque se reintente.
        </p>
      </Seccion>

      <Seccion titulo="Si algo sale mal">
        <p>
          <strong>La barra de abajo</strong> muestra si el servidor esta conectado y donde vive la
          base de datos. Si dice que esta desconectado, cerra y volve a abrir el programa.
        </p>
        <p>
          <strong>Los mensajes de error dicen que pasa y que hacer.</strong> No son codigos: si dice
          que un cliente tiene saldo pendiente, es exactamente eso. Cuando el mensaje viene de ARCA
          se muestra tal cual lo mando ARCA, porque es la unica forma de saber que hay que corregir.
        </p>
        <p>
          <strong>Antes de empezar con datos reales</strong> (en Archivo → Usuarios) el sistema hace
          una copia completa de la base. Esa copia queda guardada con la fecha en el nombre.
        </p>
      </Seccion>

      <Seccion titulo="Atajos">
        <p>
          <kbd className="rounded border border-masa-300 bg-masa-50 px-1.5 py-0.5 font-mono text-xs">⌘K</kbd>{' '}
          o{' '}
          <kbd className="rounded border border-masa-300 bg-masa-50 px-1.5 py-0.5 font-mono text-xs">Ctrl+K</kbd>{' '}
          abre el buscador de modulos. Las teclas <strong>F1 a F12</strong> abren los modulos mas
          usados directamente.
        </p>
      </Seccion>

      <footer className="pb-2 text-center text-xs text-masa-700">
        {NOMBRE_PRODUCTO} {VERSION_APP} · Crafted by BPSG
      </footer>
    </div>
  );
}
