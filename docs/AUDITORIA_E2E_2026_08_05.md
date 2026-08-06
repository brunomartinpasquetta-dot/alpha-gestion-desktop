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

### DEUDA-01 · Lecturas de API sin autenticación en LAN
El servidor escucha en 0.0.0.0 para que el celular llegue a la PWA. El PIN
protege la creación de pedidos, pero los GET (stock, ventas, CC) responden a
cualquiera en la red local. Aceptable en la LAN de la fábrica; **obligatorio
resolver antes de exponer el túnel de Cloudflare** (guía, Fase 8: hardening).
Camino sugerido: token de sesión para todo /api con excepción de la PWA.

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

## NO CUBIERTO (requiere UAT o hardware)

- PWA en un teléfono físico (táctil, service worker en iOS/Android reales).
- Build de Windows corriendo en Windows (el instalador se genera en CI pero el
  runtime Windows no se ejercitó en esta auditoría).
- Comportamiento con bases grandes (volumen); los índices existen pero no se
  midió con decenas de miles de movimientos.
- Concurrencia multi-proceso: better-sqlite3 es síncrono en un solo proceso;
  válido mientras no haya multi-terminal.
