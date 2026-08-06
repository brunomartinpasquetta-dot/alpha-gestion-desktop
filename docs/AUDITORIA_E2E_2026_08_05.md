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
