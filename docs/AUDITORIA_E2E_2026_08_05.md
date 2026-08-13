# AUDITORÍA E2E — ALPHA GESTIÓN v0.4.0 → v0.4.1 — 2026-08-05

Auditor: Claude (Opus 5, agente). Auditoría **dinámica**: base limpia migrada
0000→0003 + seed de demostración, servidor real levantado y ejercitado por API,
invariantes verificados por SQL directo contra la base. Los hallazgos se
corrigieron en la misma sesión y la suite completa se re-corrió hasta verde.

Arnés: 65 verificaciones automatizadas en 8 secciones. Reproducible contra
cualquier base con el script de la sesión.

## RESUMEN EJECUTIVO

- Verificaciones: **65/65 PASS** (tras correcciones; la primera pasada dio 60/64)
- Hallazgos: **1 HIGH, 2 MEDIUM, 1 LOW** — los cuatro corregidos en v0.4.1
- Deuda documentada (sin corregir, con decisión pendiente): 2 items

**Estado general:** la columna vertebral del sistema es sólida. Los dos ledgers
son consistentes entre sí, con la API y con los documentos que los alimentan:
stock de la API = SUM(ledger) por artículo, saldos de CC = SUM(debe−haber),
cierres de caja = apertura + neto de movimientos, totales de compras/ventas =
suma de sus items, toda compra recibida y venta entregada tiene su asiento.
Las tres máquinas de estado (pedidos 6×6, órdenes, cheques por tipo) rechazan
**todas** las transiciones ilegales con 422 y aceptan todas las legales, probadas
por matriz exhaustiva. La validación de entrada es correcta (JSON roto, ids no
numéricos, límites, fechas incoherentes, importes no enteros → 400/404).

## HALLAZGOS Y CORRECCIONES (v0.4.1)

### BUG-A01 · HIGH · La cola offline podía duplicar pedidos
- **Módulo:** PWA /pedidos + POST /api/pedidos
- **Escenario:** el celular envía un pedido, el servidor lo persiste, la
  respuesta se pierde (corte de red / túnel). La cola offline reintenta y la
  fábrica recibe el pedido **dos veces**. Reproducido en el arnés: 2 filas con
  el mismo cuerpo.
- **Corrección:** clave de idempotencia. La PWA genera un UUID al armar el
  pedido —antes de saber si hay red— y el mismo pedido viaja siempre con la
  misma clave, directo o desde la cola. El servidor guarda la clave (migración
  0003, columna única en `pedidos`) y ante una clave repetida devuelve el pedido
  original con 200 en vez de crear otro. Verificado: reintento idéntico → 1 solo
  pedido, mismo id, 201/200.

### BUG-A02 · MEDIUM · Finalizar una orden sin stock suficiente dejaba insumos en negativo sin ningún aviso
- **Módulo:** producción / ledger
- **Escenario:** finalizar una tanda cuyos consumos superan el stock del insumo
  (coco: 7.000 g → −23.000 g) devolvía 200 sin advertencia. Es el mismo patrón
  del BUG-E2E-01 pendiente en StockFlow.
- **Decisión de diseño:** NO se bloquea — la producción física ya ocurrió y
  bloquear el registro sería mentirle al ledger. Pero ahora la respuesta incluye
  `advertencias[]` con cada insumo que queda en negativo ("revisá si falta
  cargar una compra") y la ventana de Órdenes las muestra al operador.
  La valorización de inventario ya pisaba los negativos a 0 desde v0.3.x.

### BUG-A03 · MEDIUM · Cantidades de pedido sin tope
- **Escenario:** un pedido de 10¹² unidades se aceptaba (201). Un dedo dormido
  en el celular podía crear un pedido absurdo que ensuciara métricas.
- **Corrección:** tope 1.000.000 y mínimo 0,01 por item en la validación zod.
  Verificado: 1e12 → 400, 0.0001 → 400.

### BUG-A04 · LOW · Cantidad microscópica pasaba el redondeo
- 0,0001 sobrevivía a `redondearCantidad` (4 decimales) y creaba un pedido de
  una diezmilésima de alfajor. Cubierto por el mínimo de BUG-A03.

## DEUDA DOCUMENTADA (decisión pendiente, NO corregida)

### DEUDA-01 · Lecturas de API sin autenticación en LAN — **CERRADA en v0.6.0**
El servidor escucha en 0.0.0.0 para que el celular llegue a la PWA. El PIN
protegía la creación de pedidos, pero los GET (stock, ventas, CC) respondían a
cualquiera en la red local.

Resuelto con `src/server/plugins/guardia-pin.ts`: con PIN configurado, toda
petición a `/api` que no venga de loopback exige el header `x-pin-pedidos`.
Única excepción `/api/eventos`, porque EventSource no puede mandar headers y el
stream solo transporta el NOMBRE del evento, nunca datos. Verificado desde
192.168.18.132: GET /api/ventas y /api/clientes dan 401 sin PIN, 401 con PIN
incorrecto, 200 con el correcto; el escritorio por loopback sigue sin pedirlo.

**Pendiente para el túnel de Cloudflare:** el túnel termina en la máquina, así
que sus peticiones llegan como loopback y este guardia las dejaría pasar. Por
eso `POST /api/pedidos` conserva además su chequeo propio sin excepción de
origen. Antes de exponer el túnel hay que endurecer el criterio para toda la API
(token de sesión o cabecera del túnel), no alcanza con el origen.

### DEUDA-02 · Órdenes históricas sin lote
Las órdenes finalizadas por el seed de demostración (previas al sistema de
lotes) tienen `numero_lote NULL` y no son trazables. Correcto por diseño: el
lote nace al ejecutar por el sistema. Se documenta para no confundir al operador
que vea "—" en tandas viejas.

## COBERTURA DEL ARNÉS

| Sección | Verificaciones | Qué prueba |
|---|---|---|
| 1. API de lectura | 24 | Los 24 endpoints: status 200 y forma del contrato |
| 2. Errores HTTP | 10 | 400/404 correctos, JSON malformado |
| 3. Invariantes de ledger | 9 | SQL directo: sumas, consistencia API↔base, arqueos |
| 4. Máquinas de estado | 2 matrices | Pedidos 6×6 completa; cheques por tipo, todo par (desde,hacia) |
| 5. Producción y lotes | 7 | Lote al ejecutar, asientos al finalizar, trazabilidad, advertencias |
| 6. Casos límite | 7 | Topes, unicode, fechas incoherentes, centavos no enteros |
| 7. Cola offline | 2 | Idempotencia del reintento, validación de clave |
| 8. Seguridad | 4 | Path traversal, PIN, superficie LAN documentada |

## SEGUNDA TANDA — v0.6.0, 6 de agosto de 2026

Integración de ARCA dentro del circuito de ventas (la factura se emite EN la
venta, como en StockFlow) más el cierre de DEUDA-01. Hallazgos nuevos:

### BUG-B01 · TLS de ARCA rechazado por Node — **habría roto la facturación real**
Los servidores de ARCA todavía negocian Diffie-Hellman con claves de 1024 bits.
El OpenSSL que trae Node las rechaza (`dh key too small`), así que `fetch` contra
`servicios1.afip.gov.ar` (WSFE de producción) fallaba el handshake: la
facturación real no habría funcionado nunca. `curl` no lo mostró porque en macOS
usa otra librería de TLS, más permisiva.
**Corregido:** `src/server/fiscal/transporte.ts` habla con ARCA por `node:https`
con `ciphers: 'DEFAULT:@SECLEVEL=1'`, acotado a esas conexiones. Verificado
contra producción: `app=OK db=OK auth=OK`.

### BUG-B02 · Respuesta HTML de ARCA interpretada como éxito
Homologación devolvió una página de error de Oracle con HTTP 200 (falla del lado
de ARCA). El parser no encontraba los tags y devolvía `app=? db=? auth=?` como si
todo hubiera salido bien.
**Corregido:** si la respuesta no es SOAP, se lanza `ARCA_NO_DISPONIBLE` con el
texto del error de ARCA y la indicación de reintentar.

### BUG-B03 · Rechazo de ARCA llegaba como "error interno"
Un certificado inválido producía HTTP 500 con "Ocurrió un error interno": el
operador no podía saber que el problema era el certificado.
**Corregido:** `ErrorArcaDominio` (HTTP 502) transporta el mensaje textual de
ARCA hasta la pantalla. Verificado: *"No se pudo emitir la Factura B:
Certificado no emitido por AC de confianza"*.

### Verificaciones de la integración fiscal

| Prueba | Resultado |
|---|---|
| Migración 0004 sobre la base real (con datos) | Aplica limpia, 25 tablas |
| Venta con remito (camino histórico) | 201, sin comprobante, efectos intactos |
| Venta con factura y ARCA sin configurar | 422, **no se creó la venta** |
| Factura A a cliente sin CUIT | 422 antes de llamar a ARCA |
| Factura con certificado inválido | 502 con motivo real; venta y stock sin tocar |
| CAE aprobado (respuesta real de ARCA) | FB 00001-00000043, neto+IVA = total exacto |
| CAE con observaciones | Comprobante válido + advertencia (no bloquea) |
| CAE rechazado (`Errors`) | Lanza `ARCA_RECHAZO` con código y mensaje |
| Numeración duplicada | Rechazada por índice único |
| Anular venta facturada | Anula y avisa que el CAE exige nota de crédito |
| QR RG 4892 | Payload correcto, decodifica a JSON válido |
| PIN desde LAN (192.168.18.132) | 401 sin PIN / 401 con PIN malo / 200 con PIN |
| SSE desde LAN | 200 (exento, no transporta datos) |
| Regresión: 20 endpoints de lectura | Todos 200 |
| Regresión: idempotencia de pedidos | 201 luego 200, un solo pedido en base |
| Regresión: producción → lote → trazabilidad | L-20260806-01, stock +120, consumos OK |
| Regresión: máquina de estados de cheques | Transiciones válidas 200, inválida 422 |

## TERCERA TANDA — v0.7.0, 6 de agosto de 2026

El sistema pasa de leer a operar: todos los circuitos de escritura que faltaban.

### Alcance nuevo

| Circuito | Que hace |
|---|---|
| ABM clientes | Alta, edicion y baja logica. Bloquea la baja con saldo pendiente |
| ABM proveedores | Igual que clientes |
| ABM articulos | Alta, edicion, baja. Codigo unico; no deja cambiar el tipo con movimientos ni dar de baja con stock |
| Compras | Ingresa stock, genera deuda o egreso de caja, actualiza el costo. Anulable con asientos espejo |
| Caja | Apertura (una sola a la vez), movimientos manuales, cierre con arqueo y diferencia |
| Cobros y pagos | Cuenta corriente + caja si es efectivo; en cheque no toca caja |
| Produccion | Planificar la orden; la cantidad sale del rinde por el factor de escala |

### Verificaciones

Todas contra una copia de la base real, y despues repetidas en la app instalada
manejando los formularios de verdad por CDP.

| Prueba | Resultado |
|---|---|
| Alta/edicion/baja de cliente | 201 / 200 / 200; CUIT normalizado a 11 digitos |
| CUIT invalido | 400 |
| Baja de cliente con saldo | 422 con el nombre y el motivo |
| Codigo de articulo duplicado | 409 |
| Cambiar tipo de articulo con movimientos | 422 |
| Baja de articulo con stock | 422 |
| Compra en cuenta corriente | Stock +50000 g exacto, CC haber, costo actualizado |
| Anular compra | Stock y CC vuelven al valor previo; estado 'anulada' |
| Anular dos veces | 422 |
| Abrir segunda caja | 422 |
| Egreso mayor al saldo de caja | 422 con el saldo disponible |
| Cierre de caja | Teorico 54.000, contado 53.500, diferencia −500 detectada |
| Cobro en efectivo | Deuda baja y la caja sube por el mismo importe |
| Cobro en cheque | Deuda baja, caja intacta |
| Cobro mayor a la deuda | Se registra y avisa del saldo a favor |
| Pago mayor al efectivo en caja | 422 |
| Crear orden con factor 2 | Cantidad = rinde x 2; ejecutar asigna lote |
| Factor de escala 0 | 400 |
| Formularios en la app instalada | Alta de cliente, compra (3 x 1000 = 3000 g) y cobro, todos OK |

### Correcciones durante la verificacion

- **Baja de cliente con deuda no se bloqueaba.** El servicio recalculaba el saldo
  con su propia consulta y devolvia 0. Se elimino esa copia: ahora la vista sale
  del repositorio de lectura, que es la unica definicion del saldo en el sistema.
- **Catalogo de eventos SSE duplicado.** Servidor y renderer declaraban cada uno
  su lista; agregar un evento compilaba de un lado y fallaba del otro. Se movio a
  `contratos.ts` y ambos lo importan.
- **`/api/unidades` quedo anidado dentro de otro handler** y respondia 404. Se
  detecto al probar la app instalada, no en el typecheck.

## CUARTA TANDA — v0.12.0, 7 de agosto de 2026

Primera corrida en **Windows real** (reportada por el usuario: "lo demas parece
funcionar"), ABM en los modulos que faltaban, y un bug grave encontrado al
barrer los 22 modulos a la vez.

### BUG-C01 · El sistema se colgaba con varias ventanas abiertas — **CRITICO**

Con siete pantallas escuchando eventos en tiempo real, la aplicacion dejaba de
responder: las pantallas quedaban en "Cargando..." para siempre.

**Causa:** cada pantalla con tiempo real abria su propio stream SSE por HTTP, y
un stream SSE ocupa una conexion **permanentemente**. Chromium limita las
conexiones simultaneas por servidor a 6. A partir de la septima ventana el cupo
se agotaba y toda peticion nueva quedaba encolada sin resolverse nunca —
incluido `/health`, que es lo que mide la barra de estado.

**Por que no habia aparecido:** hasta ahora las pruebas abrian dos o tres
ventanas. Aparecio al barrer los 22 modulos juntos.

**Corregido:** en el escritorio los eventos ya no viajan por HTTP sino por IPC.
El servidor corre embebido en el proceso main de Electron, asi que el evento
ocurre en la misma memoria: abrir una conexion HTTP para enterarse era dar la
vuelta al mundo. El SSE se conserva para la PWA del celular, que es el unico
camino posible desde afuera y usa una sola pantalla por telefono.

**Verificado:** los 22 modulos abiertos a la vez, 0 con problemas (antes 8
quedaban en blanco o colgadas), y el tiempo real sigue funcionando — un pedido
creado desde otra ventana aparece solo en la de pedidos.

### ABM completado

| Modulo | Antes | Ahora |
|---|---|---|
| Stock de insumos | Solo lectura | Alta, edicion, ajuste y baja |
| Stock de productos | Solo lectura | Alta, edicion, ajuste y baja |
| Usuarios | Solo listado | Alta, edicion y baja, con proteccion del ultimo admin |
| Pedidos | Solo cambio de estado | Alta y edicion desde el escritorio |
| Listas de precio | Solo alta | Renombrar la lista y borrar precios |

### Verificaciones

| Prueba | Resultado |
|---|---|
| Los 22 modulos abiertos simultaneamente | 22/22 cargan, 0 colgadas |
| Tiempo real tras el cambio a IPC | Un pedido de otra ventana aparece solo |
| Alta de usuario desde la interfaz | Creado, aparece en la grilla |
| Baja del unico administrador | 422 con el motivo |
| Usuario duplicado (mayusculas) | 409: se normaliza a minusculas |
| Contraseña corta | 400 |
| Editar pedido en produccion | Rechazado con el motivo |
| Buscar actualizaciones a pedido | "Estas al dia. Version instalada: 0.10.0" |

## QUINTA TANDA — v1.1.0, 7 de agosto de 2026: fabrica completa

Se cargo una fabrica de alfajores DESDE CERO por la API —como lo haria el
cliente— y se corrio el circuito entero. Objetivo: ver si el sistema procesa
bien la informacion de una operacion real, no si cada endpoint responde 200.

### Lo que se cargo

4 proveedores · 5 familias · 5 insumos y 2 productos con costo, minimo, ideal,
proveedor habitual e IVA · 3 clientes con su condicion frente al IVA, lista de
precios y limite de credito · 6 precios (3 listas x 2 productos) · 3 recetas
encadenadas (el dulce de leche es insumo del alfajor).

### El circuito, con los numeros

| Paso | Resultado |
|---|---|
| Reposicion inicial | Separa bien: 3 a producir (tienen receta), 4 a comprar |
| Compra a Molinos (cta. cte.) | $191.250 · stock +100.000 g harina, +75.000 g azucar · deuda exacta |
| Compra de contado | Egreso de caja correcto |
| Tanda de dulce de leche (x2) | Leche 80.000→40.000 · azucar 75.000→67.000 · DDL 0→36.000. **Exacto** |
| Tanda de alfajores (x2,5) | 600 unidades · harina −24.000 · DDL −18.000. **Exacto** |
| Pedido del celular → venta | Tomo el precio del DISTRIBUIDOR ($1.300, no el general $1.800) |
| Venta desde pedido | Pedido pasa a entregado · stock −240 · CC +$312.000 |
| Cobro en efectivo | Baja la deuda y entra a la caja |
| Cobro en cheque | Baja la deuda, NO toca la caja |
| Cierre de caja | Teorico, contado y diferencia correctos |
| Trazabilidad del lote | Devuelve la orden, sus 4 consumos y 5 movimientos |

### CINCO problemas encontrados y corregidos

**C01 · El dulce de leche aparecia en "hay que comprar".** Es un pre-elaborado
que se fabrica con receta, pero la regla miraba el TIPO (solo los terminados se
producian). Un pre-elaborado con receta terminaba en la lista de compras, donde
no hay a quien pedirselo. Ahora decide por si el articulo tiene receta activa.

**C02 · La caja quedaba en negativo sin avisar.** Una compra de contado de
$352.000 con $200.000 en caja se registro sin una palabra: la caja quedo en
−$288.000 y nada lo indicaba. Ahora avisa con cuanto queda y sugiere que falta
registrar un ingreso, y la pantalla de caja lo marca en rojo.

**C03 · Criterio inconsistente entre bloquear y avisar.** El pago a proveedor y
el retiro de caja BLOQUEABAN si no alcanzaba, pero la compra de contado no.
Unificado en avisar: el sistema registra hechos, y bloquear logra que el
operador no cargue lo que ya paso, que es peor que una caja en negativo visible.

**C04 · Se podian cargar dos clientes con el mismo CUIT.** Un CUIT identifica a
una persona: repetirlo parte su cuenta corriente en dos y ninguno de los saldos
es el real. Ahora se rechaza, en clientes y en proveedores. El NOMBRE si se
puede repetir: dos sucursales del mismo kiosco son dos clientes.

**C05 · El aviso de limite de credito no existia.** Se habia escrito pero la
edicion nunca se aplico al archivo, asi que fiar por encima del limite pasaba en
silencio. Verificado: una venta que deja al kiosco debiendo $108.000 con limite
$500 ahora lo dice.

### Evaluacion contra el objetivo

El sistema **procesa correctamente la operacion de la fabrica**: los saldos de
stock salen del ledger y coinciden al gramo con lo que dictan las recetas, los
precios respetan la lista del cliente, la cuenta corriente y la caja cierran, y
un lote permite reconstruir que se uso para fabricarlo.

Lo que la auditoria confirma que **falta para operar de verdad** es lo ya
listado en el estado del proyecto: facturar con el certificado real del cliente
y la prueba a fondo en Windows.

## NO CUBIERTO (requiere UAT o hardware)

- PWA en un teléfono físico (táctil, service worker en iOS/Android reales).
- Build de Windows corriendo en Windows (el instalador se genera en CI pero el
  runtime Windows no se ejercitó en esta auditoría).
- Comportamiento con bases grandes (volumen); los índices existen pero no se
  midió con decenas de miles de movimientos.
- Concurrencia multi-proceso: better-sqlite3 es síncrono en un solo proceso;
  válido mientras no haya multi-terminal.
- **Emisión de un CAE real contra ARCA.** Requiere el certificado del trámite del
  cliente asociado a su CUIT y el punto de venta dado de alta. Se probó todo lo
  que se puede probar sin él: firma CMS real (ARCA la procesó y respondió),
  transporte contra los servidores reales, y el parseo de respuestas de ARCA
  aprobadas, observadas y rechazadas.

---

## Tanda 6 — Reservas de stock y órdenes automáticas (9/8/2026, v1.2.0)

Circuito nuevo, verificado de punta a punta contra la app instalada, no contra
tests: cada paso se hizo por la API real del servidor que corre dentro de la app.

| # | Qué se probó | Resultado |
|---|---|---|
| 1 | Pedido de 60 u de maicena + 120 u de triple | Abrió sus **dos órdenes solas** (#8 y #9), una por producto |
| 2 | Cubrir ese pedido con stock disponible | Apartó las 36 u de maicena que había; informó que faltaban 24 u y 120 u |
| 3 | Efecto sobre el stock | maicena: físico 36, reservado 36, **disponible 0** |
| 4 | La orden que quedó | Se **redujo sola a 24 u** ("Reducida: 36 salieron de stock ya elaborado") |
| 5 | Pedido de 48 u de chocolate, cubierto entero | Repartió por lote: **35 u sin lote + 13 u del lote L-20260805-01** |
| 6 | La orden de ese pedido | Se **canceló sola**: ya estaba cubierto, elaborarla sería tirar insumos |
| 7 | Ejecutar y finalizar la orden del triple (120 u) | Lote L-20260809-01; entró **físico 120 / reservado 120 / disponible 0** |
| 8 | Venta de mostrador de 10 triples (todo comprometido) | Registró y **avisó**: "solo hay 0 sin comprometer. El resto estaba reservado para un pedido" |
| 9 | Venta del pedido 12 (110 triples + 36 maicena) | Consumió las reservas: los tres artículos quedaron en 0/0/0 |
| 10 | Cancelar un pedido con 12 u apartadas | Chocolate volvió de disponible 22 a **disponible 34** |

**Lo que se corrigió durante la auditoría.** La primera versión de "cubrir con
stock" no tocaba la orden cuando no había nada disponible, así que un pedido
parcialmente cubierto seguía teniendo una orden por la cantidad total: el que
produce habría elaborado 60 cuando solo faltaban 24. Ahora el ajuste corre
siempre, con lo que falte de verdad.

**Verificación visual.** Botones de acción de las órdenes: 36×36 px cada uno,
contenedor de 78×36 → cuadrados y en una sola fila. Columna "Docenas" en lugar de
"Tanda". Columna "Para quién" con el pedido y el cliente. En el pedido, columna
"Apartado" con estado Completo / parcial / a elaborar.

---

## Tanda 7 — Circuito comercial completo del diagrama de Bruno (10/8/2026, v1.3.0, solo Mac)

Verificado contra la app instalada, por API y por pantalla (CDP).

| # | Escenario | Resultado |
|---|---|---|
| 1 | Pedido con stock TOTAL (12 u, había 34 libres) | Reservó solo y pasó **directo a LISTO** sin tocar nada |
| 2 | Pedido SIN stock ni insumos (24 u maicena, DDL en −1260) | Orden nació **"Espera insumos: faltan 2820 g de DDL"** — el número incluía lo comprometido por la tanda en curso (1080 g) |
| 2b | Elaborar sin insumos | **Rechazado** con el faltante exacto y la opción de forzar |
| 2c | Se cargó la compra de 5000 g de DDL | La orden **despertó sola** (espera → lista) sin ningún evento manual |
| 2d | Elaborar → Finalizar | Lote L-20260810-01; pedido pasó solo a EN_PRODUCCION y luego a **LISTO**; el producto entró **físico 24 / reservado 24 / disponible 0** |
| 3 | Pedido con stock PARCIAL (48 u, había 22) | Apartó 22 (lote L-20260805-01) y abrió la orden **por 26**, no por 48 |
| 4 | Venta TOTAL desde pedido listo | Pedido → ENTREGADO, reservas consumidas |
| 5 | Venta PARCIAL, resto MANTENER (12 de 24) | Pedido **siguió LISTO con 12 apartadas**; la segunda venta lo cerró ENTREGADO |
| 6 | Venta PARCIAL, resto LIBERAR (6 de 10) | Aviso "4 vuelven a stock disponible"; pedido ENTREGADO; disponible subió de 0 a 42 (64−22) |

**UI verificada:** botón "Vender / facturar" solo en pedidos listos y abre la venta
precargada (pedido, cliente, cajas); pastilla "Espera insumos" con el detalle en
el tooltip; "En elaboración" en lugar de "En proceso"; Stock Productos con
pestañas Productos / Todos los artículos; menú Stock sin la entrada "Artículos"
(F5 liberada); Stock Insumos renombrado.

**Nota de diseño:** "espera de insumos" NO es un estado guardado sino calculado
contra el stock del momento (descontando lo comprometido por tandas en curso).
Por eso el "despertar" al cargar la compra no necesita ningún mecanismo: el
cálculo cambia y la pantalla se refresca por el evento de maestros.

**Publicación:** por pedido de Bruno, esta versión quedó SOLO en la Mac. Windows
sigue en 1.2.2 hasta nueva orden.

---

## Tanda 8 — Correcciones de UX del pedido + bug de reducción (10/8/2026, v1.3.1, solo Mac)

Origen: 8 quejas de Bruno tras probar la 1.3.0. Trabajo repartido: 2 agentes en
paralelo (formulario de pedido / estilo global) + corrección del servidor a mano.

| Queja | Resolución | Verificado |
|---|---|---|
| No se aclara DOCENAS al elegir items | Rótulo "DOCENAS" (o "CAJAS de N") arriba del incrementador, equivalencia legible | CDP: `docenas:true` |
| No se sabe si reservó o hay que elaborar | Resumen en vivo "se reserva / se manda a elaborar" por producto + veredicto | CDP: tabla visible |
| Botón debe ser "Cargar pedido" + confirmación SI/NO | Hecho, con `confirm` que detalla reserva y elaboración | CDP: botón presente |
| Sin mensajes al cargar | Toast temporal (8 s) con el resultado real: reservado completo / parcial / a elaboración / EN ESPERA DE INSUMOS con el faltante | código + tipos |
| Fecha estimada innecesaria | Eliminada del formulario | CDP: `fecha:false` |
| Botones redondeados | Radios del sistema → 2px parejo (criterio copiado de StockFlow: botones y badges `rounded-md`, sin píldoras) | CDP: radios 0-2px |
| Íconos del dock achicados | Tile 84→112px, ícono fijo 28×28 con `shrink-0`, etiqueta a 1 línea | CDP: medido 28×28, 1 línea |
| **BUG: pedido 50→30 cobraba 50** | `liberarExceso`: al editar el pedido a la baja, el sobrante apartado se libera (de la reserva más nueva hacia atrás); la orden pendiente se reduce; la venta precarga y cobra lo real | E2E: pedido 48→24, orden 42→18, venta cobró $7.800 (6 u), no lo apartado original |

Nota: el cobro NUNCA es requisito para elaborar; el pedido se carga sin plata y
se cobra al retirar (o después por cuenta corriente).

---

## Tanda 9 — Pedidos muestra solo pedidos (10/8/2026, v1.3.2, solo Mac)

- **"Estado del pedido"** bajo el encabezado: "reservado X docenas · en produccion Y docenas", por articulo.
- **Entregar a mano: bloqueado.** Solo la venta entrega (probado: el PATCH manual responde "se entrega vendiendolo... boton Vender / facturar"). Antes dejaba pedidos sin factura y reservas colgadas (el pedido 21 de la prueba de Bruno quedo asi: evidencia del bug).
- **Cantidades en docenas/cajas** en toda la pantalla de pedidos; columnas "Pedido / Apartado de stock / En produccion"; "hay N libres" eliminado (era dato de stock, no de pedidos).
- **Botones "Cubrir con stock" y "Soltar lo apartado" eliminados**: reemplazados por el barrido automatico (`cubrirPedidosPendientes`): al liberarse stock (cancelacion, venta parcial, reduccion, tanda que rinde de mas) se aparta solo al pedido mas viejo que espera.
- **Boton demo autosuficiente**: "cargar demo" ahora siembra el catalogo base si falta (tras "empezar de cero" moria).
- Base de la Mac reiniciada a demo limpia (copia previa en `copias/`).

---

## Tanda 10 — Pagos mixtos, modelo StockFlow + cartera de cheques (10/8/2026, v1.4.0, solo Mac)

Modelo extraído del código real de StockFlow por un agente (payment_methods /
sale_payments) y replicado; extensión propia: el cheque dispara la cartera.

| Prueba | Resultado |
|---|---|
| Migración siembra los 5 medios (Efectivo físico, Transferencia, TC, TD, Cheque) | ✓ verificado por API |
| Pagos que no cubren el total | Rechazado: "Los pagos ($10.000) no cubren el total ($12.000). No hay vuelto" |
| Venta mixta $7.000 efectivo + $5.000 transferencia (ref TRF 4482) | ✓ registrada, un ingreso de caja POR PAGO con su medio |
| Pago con cheque sin número/fecha | Rechazado con mensaje claro |
| Pago con cheque completo | ✓ el cheque 00412884 (Banco Nación, $4.000, vence 15/9) entró SOLO a la cartera en_cartera, a nombre del cliente, doc venta #8 |
| Arqueo del cierre | Teórico $77.850 = apertura + SOLO efectivo físico; transferencia y cheque quedaron fuera del cajón (exacto al centavo) |
| UI | Combo "Medio de pago", botón "Pago mixto" con fila por medio, atajo "Todo en Efectivo", indicador Restante/Completo/Excede, panel de cheque con ayuda |

CC sin pagos (se cobra después) y venta rápida sin detalle = todo Efectivo:
compatibilidad total con lo existente. Pendiente: ABM de medios de pago
(agregar "Visa 3 cuotas" etc. con comisión), desglose por medio en el cierre.

---

## Publicación v1.4.0 a Windows (10/8/2026)

Draft → subida (exe 113.520.326 bytes + blockmap + latest.yml) → publicada →
verificada: /releases/latest sirve 1.4.0, exe con firma MZ y tamaño exacto al
manifiesto, cero binarios Mach-O fuera de prebuilds/darwin. Primera prueba real
del auto-update por red de Node en la PC del cliente (viene de 1.2.2).

---

## Tanda 11 — Revisión integral bajo pedido ("REVISA TODO") (10/8/2026, v1.4.1)

Revisión profunda con la herramienta de code-review sobre los servicios y las
pantallas tocadas hoy: **10 hallazgos confirmados, 10 corregidos**, con
regresión E2E de los 4 críticos contra la app instalada:

| # | Hallazgo | Arreglo | Regresión |
|---|---|---|---|
| 1 | Agrandar un pedido (10→50) nunca producía el extra: la orden vieja tapaba la creación | La orden planificada SE AMPLÍA (descontando lo que ya viene en camino) | Pedido 12→60: orden quedó en 60 ✓ |
| 2 | Anular venta electrónica ensuciaba el arqueo (egreso total sin medio contra ingreso excluido) | Reverso POR PAGO con su medio | Venta $6.000 transferencia anulada → cierre con diferencia $0,00 ✓ |
| 3 | El cheque de una venta anulada seguía como activo en cartera | Sale de cartera con nota "devuelto al cliente" + aviso | REV-777 ✓ |
| 4 | Anular venta de pedido dejaba reservas entregadas y pedido entregado | Reservas vuelven a ACTIVAS, pedido vuelve a LISTO | Pedido 13 restaurado con 12 apartadas ✓ |
| 5 | Precarga de venta con Math.round podía SOBREVENDER lo apartado de otro pedido | Math.floor: nunca de más | typecheck + código |
| 6 | Validación de pagos corría DESPUÉS del CAE: un rechazo local quemaba numeración ARCA | Pre-validación (suma, medios, cheque) antes del pedido fiscal | código |
| 7 | Reintento idempotente del celular dejaba pedidos sin órdenes para siempre | El retry re-corre cubrir+generar (idempotentes): auto-reparación | código |
| 8 | Cancelar pedido en 2 transacciones podía dejar cancelado con reservas vivas | Una sola transacción: estado+órdenes+reservas | código |
| 9 | Fórmula del "saldo apartado" copiada 4 veces con una variante distinta | Helper único `pendienteDeItem` en formato.ts | código |
| 10 | El barrido recorría TODOS los pedidos contra el ledger entero en cada venta | Acotado a los artículos recién liberados | código |

v1.4.1 instalada en Mac y publicada a Windows (draft→assets→publicar).
