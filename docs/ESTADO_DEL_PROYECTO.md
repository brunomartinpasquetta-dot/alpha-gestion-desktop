# Estado del proyecto — Alpha Gestión

**Fecha:** 6 de agosto de 2026 · **Versión instalada:** v0.12.0 · **Repositorio:** `brunomartinpasquetta-dot/alpha-gestion-desktop`

Este documento dice qué está terminado, qué falta y en qué orden conviene hacerlo
para llegar a una versión presentable al cliente. Se actualiza en cada entrega.

---

## 1. Resumen en una línea

El sistema **ya opera completo y entrega el papel**: se puede vender, comprar,
producir, cobrar, pagar, ajustar stock, cargar recetas y precios, facturar
electrónicamente e **imprimir el remito o la factura con su QR**. Queda **una
sola cosa** para presentarlo: **probarlo en Windows**, que es donde va a correr.
Todo lo demás del alcance acordado está hecho y probado.

---

## 2. Qué está TERMINADO y probado

### Circuitos operativos completos

| Circuito | Estado | Qué hace |
|---|---|---|
| **Ventas** | ✅ Operativo | Descuenta stock, cobra (caja o cuenta corriente), entrega el pedido y emite el comprobante. Anulable con asientos espejo |
| **Facturación ARCA** | ✅ Motor listo | Factura A/B con CAE, emitida DENTRO de la venta. Falta el certificado del cliente (ver §4) |
| **Compras** | ✅ Operativo | Ingresa stock, genera deuda o egreso de caja, actualiza el costo. Anulable |
| **Pedidos desde el celular** | ✅ Operativo | PWA con cola offline e idempotencia; la fábrica los ve en tiempo real |
| **Producción y trazabilidad** | ✅ Operativo | La orden se abre sola con el pedido → ejecutar (nace el lote) → finalizar (consume insumos, ingresa producto). La cantidad se carga en DOCENAS, no en factor de escala |
| **Reservas de stock** | ✅ Operativo | Lo elaborado contra un pedido entra al depósito reservado para ese cliente. Stock físico / reservado / disponible, con trazabilidad de lote |
| **Caja diaria** | ✅ Operativo | Apertura, movimientos manuales, cierre con arqueo y diferencia |
| **Cuentas corrientes** | ✅ Operativo | Cobros y pagos, con impacto en caja si son en efectivo |
| **Cheques** | ✅ Operativo | Cartera de recibidos y emitidos con máquina de estados |
| **ABM de maestros** | ✅ Operativo | Clientes, proveedores y artículos: alta, edición y baja lógica |

### Infraestructura

- **Base de datos:** SQLite con ledger único (el stock y los saldos se calculan,
  no se guardan). 25 tablas, 6 migraciones aplicadas.
- **Distribución:** instalador de Mac y de Windows por GitHub Releases, con
  actualización automática en Windows. Pipeline auto-reparable.
- **Seguridad de red:** con PIN configurado, toda la API exige el PIN desde fuera
  de la máquina (deuda DEUDA-01, cerrada en v0.6.0).
- **Auditoría E2E:** 65/65 verificaciones + 3 tandas de correcciones documentadas
  en `AUDITORIA_E2E_2026_08_05.md`.

---

## 3. Qué FALTA — ordenado por prioridad

### 🔴 BLOQUEANTES para presentar al cliente

**B1 · Probar el sistema corriendo en Windows.** ✅ **PRIMERA CORRIDA HECHA**
el 7/8: instala y funciona. Falta la prueba a fondo (facturación con
certificado real, PWA desde el celular, impresión).

**Nota histórica del riesgo original:**
El cliente usa Windows y el sistema nunca se ejecutó ahí: se compila en CI pero
el runtime no se ejercitó. **Sigue siendo el mayor riesgo abierto**, aunque en
v0.8.0 se le quitó el diente más peligroso (la dependencia de `openssl`). Lo que
queda por verificar es de menor calibre: permisos de red y comportamiento del
instalador. Una revisión del código no encontró rutas POSIX ni procesos externos.

~~**B2 · Imprimir comprobantes.**~~ ✅ **HECHO en v0.9.0.** Remito X y factura
A/B en hoja A4, con el QR obligatorio de la RG 4892, el CAE y su vencimiento.
Los datos del emisor y del receptor se congelan al emitir: un comprobante viejo
sigue diciendo lo que decía. El remito trae el pie de conformidad para el
reparto.

~~**B3 · Ajuste manual de stock.**~~ ✅ **HECHO en v0.8.0.** Con dos modos:
cargar lo que se contó (el sistema calcula la diferencia) o sumar/restar. El
motivo es obligatorio y se asienta como movimiento, nunca se edita el saldo.

~~**B4 · ABM de recetas.**~~ ✅ **HECHO en v0.8.0.** Alta, edición y
activación. Editar una receta no altera las tandas ya producidas.

### 🟡 IMPORTANTES antes de que opere en serio

~~**I1 · ABM de listas de precio.**~~ ✅ **HECHO en v0.8.0.** Crear listas y
fijar precios. Un precio nuevo no pisa al anterior: rige desde hoy y el
historial se conserva.

~~**I2 · Carga inicial de datos del cliente.**~~ ✅ **HECHO en v0.10.0.** En
Usuarios hay un panel "Empezar con los datos reales": hace una copia de la base,
exige escribir una frase de confirmación y borra los datos de demostración
conservando unidades, usuarios y la configuración de ARCA. La numeración vuelve
a empezar en 1: la primera venta real es la venta #1.

**I3 · Login.** El ABM de usuarios está hecho en v0.11.0 (alta, edición, baja,
con protección del último administrador), pero **falta la pantalla de login**:
hoy cualquiera que abra el programa entra. Para una fábrica chica puede ser
aceptable, pero hay que decidirlo con el cliente.

~~**I4 · Editar y anular pedidos.**~~ ✅ **HECHO en v0.11.0.** Se cargan y se
corrigen desde el escritorio, mientras no hayan entrado a producción.

### 🟢 DESEABLES (no bloquean la presentación)

- **Contabilidad:** la pantalla dice "no implementado". Requiere plan de cuentas,
  asientos y libro IVA — es un módulo entero, no un ajuste.
- **Impresión térmica** (comanda de producción).
- **Acceso desde fuera de la fábrica** (túnel de Cloudflare). Ojo: requiere
  endurecer la seguridad antes, ver §5.
- **Reportes exportables** a Excel/PDF.
- **Backup automático** de la base.

---

## 3-ter. Reglas del negocio con las que está construido el sistema

Estas son las reglas que asumí. **Todo el sistema las respeta y toda pantalla
nueva tiene que revisarse contra ellas.** Si alguna está mal, corregirla acá
primero y después el código.

| # | Regla |
|---|---|
| 1 | **Materia prima y pre-elaborado (insumos):** se COMPRAN a proveedores y se CONSUMEN en producción. No se venden: no llevan precio de venta, ni lista, ni unidades por caja |
| 2 | **Producto terminado:** se PRODUCE con una receta y se VENDE. Lleva precio por lista y se vende en cajas cerradas. No se compra |
| 3 | **Si falta un insumo** → se compra al proveedor habitual |
| 4 | **Si falta un producto** → se produce con una orden, NO se compra |
| 5 | **Pedidos y ventas** → solo productos terminados |
| 6 | **Compras** → cualquier artículo, en la práctica insumos |
| 7 | **Recetas** → producen un pre-elaborado o un terminado; consumen insumos |
| 8 | **Precios** → hay 3 listas (General, Mayorista, Distribuidor) y cada cliente tiene la suya |
| 9 | **Cada pedido abre su orden de producción** automáticamente, una por producto. El que elabora decide cuáles arranca y puede tener varias tandas en curso a la vez |
| 10 | **Lo elaborado contra un pedido entra RESERVADO** para ese cliente: está en el depósito pero no se le puede vender a otro. La producción interna entra disponible |
| 11 | **Disponible = físico − reservado.** Es el número que mira el que vende. Vender por encima del disponible avisa pero no bloquea |
| 12 | **Si ya hay stock hecho, se puede cubrir el pedido con él** en vez de elaborar de nuevo: se aparta anotando de qué tanda sale, y la orden se reduce a la diferencia o se cancela |

Verificado el 7/8 pantalla por pantalla: venta, pedido, compra, receta, ajuste de
stock, fijar precio, actualización masiva y ficha de artículo respetan las 8
primeras. Las reglas 9 a 12 se agregaron el 9/8 y se verificaron de punta a punta
contra la app instalada: pedido de 60 u + 120 u abrió sus dos órdenes solas,
cubrir con stock apartó 36 u repartidas por lote y dejó la orden en 24 u, la tanda
finalizada entró reservada (físico 120 / disponible 0), la venta de mostrador
avisó que estaba comprometido, la venta del pedido consumió las reservas y la
cancelación de otro pedido devolvió lo apartado a disponible.

## 3-bis. Comparación módulo por módulo contra StockFlow

Inventario hecho el 7/8 leyendo `~/dev/stockflow`. **Criterio: cuando un módulo
existe en los dos sistemas, se lee el de StockFlow y se replica** — campos,
layout y funciones—, no se diseña algo equivalente.

### Ya replicados con su patrón (panel de detalle, no modal)

| Módulo | Estado |
|---|---|
| Artículos / Stock insumos / Stock productos | ✅ v0.14.0 — grilla de 12 columnas, precios con utilidad, alta rápida de familia y proveedor, búsqueda, filtros, Excel, atajos |
| Clientes | ✅ v0.15.0 — + condición IVA, límite de crédito, tipo de documento, localidad, celular |
| Proveedores | ✅ v0.15.0 — + código, ingresos brutos, localidad, celular |
| Actualización de precios | ✅ v0.16.0 — con vista previa y redondeo comercial |
| Generador de compras ("Qué comprar") | ✅ v0.16.0 — por mínimo o ideal, agrupado por proveedor |

### Que StockFlow tiene y Alpha todavía no

| Módulo | Valor para la fábrica | Nota |
|---|---|---|
| **Toma de inventario** | Alto | Contar el depósito y ajustar en bloque. Se apoya en el ajuste de stock que ya existe |
| **Importar desde Excel** | Alto para arrancar | Cargar el catálogo inicial del cliente sin tipear |
| **Historial de precios** | Medio | Los datos ya se guardan con su vigencia; falta la pantalla |
| Libro IVA ventas/compras | Medio | Parte de contabilidad, que sigue sin implementar |
| Presupuestos | Bajo | Una fábrica de alfajores vende, no cotiza |
| Medios de pago (tarjetas) | Bajo | El cliente opera con efectivo, cheques y cuenta corriente |
| Promociones | Bajo | — |
| Ventas por vendedor | No aplica | No hay vendedores con comisión |
| Auditoría de cambios | Medio | Quién tocó qué. Relevante recién con varios usuarios |

### Que Alpha tiene y StockFlow no

Producción con recetas, órdenes y **trazabilidad por lote**; pedidos desde el
celular con cola offline; cajas cerradas de 12 unidades. Son el corazón del
negocio de la fábrica y no tienen equivalente en StockFlow.

---

## 4. Dependencias del CLIENTE (no las podemos resolver nosotros)

| Qué | Para qué | Sin esto |
|---|---|---|
| **Certificado digital de ARCA** a nombre de su CUIT | Facturar electrónicamente | El motor está probado pero no puede emitir una factura real |
| **Alta del punto de venta** para factura electrónica | Idem | Idem |
| Sus datos fiscales (CUIT, razón social, ingresos brutos) | Configurar el emisor | — |
| Su listado real de artículos, precios, clientes y proveedores | Arrancar con datos propios | Opera sobre datos de demostración |
| Su stock inicial contado | Que los saldos sean reales | Los números no significan nada |

---

## 5. Problemas conocidos y riesgos

### Abiertos

| # | Problema | Impacto | Plan |
|---|---|---|---|
| R1 | **Nunca se ejecutó en Windows** | Alto | Probar antes de presentar (B1) |
| ~~R2~~ | ~~`openssl` externo para firmar ARCA~~ | — | ✅ **RESUELTO en v0.8.0**: la firma la hace node-forge, que viaja dentro de la app. Verificado contra ARCA real |
| R3 | **Sin autenticación** | Medio | Decidir con el cliente (I3) |
| R4 | **El túnel de Cloudflare llegaría como "local"** y saltearía el PIN | Alto si se expone a internet | Endurecer antes de montar el túnel. Documentado en `guardia-pin.ts` |
| R5 | **App de Mac sin firmar** | Bajo | Auto-actualización desactivada en Mac; en Windows funciona |
| R6 | Órdenes viejas sin número de lote | Bajo | Correcto por diseño: el lote nace al ejecutar |

### Resueltos (quedan como referencia)

- **La 1.2.1 moría al abrir en Windows con "error de JavaScript"** (v1.2.2). El
  instalador de Windows se arma en la Mac, y electron-rebuild deja en
  node_modules un bcrypt compilado PARA MAC (`bcrypt/build`, `bcrypt/bin`);
  node-gyp-build prefiere `build/Release` por sobre los prebuilds oficiales, así
  que la app de Windows intentaba cargar un binario Mach-O y moría antes de
  arrancar. La 1.1.0 andaba porque en ese momento esas carpetas no existían.
  Arreglo en `electron-builder.yml`: se excluyen del paquete, y cada plataforma
  carga su prebuild oficial (verificado en Mac ejercitando bcrypt y la base por
  esa misma vía). Además ahora el entry es `dist/main/arranque.js`: cualquier
  error de carga futuro muestra un cartel en español y queda en
  `%APPDATA%\alfajores-erp\errores.log`, en vez del cartel críptico de Electron.

- **Las actualizaciones no llegaban a Windows: "internet disconnected" con internet
  conectado** (v1.2.1). electron-updater descarga usando `electron.net`, que es la
  pila de red de Chromium. En la PC del cliente, Chromium decidía por su cuenta
  que la máquina estaba offline y ni siquiera intentaba la conexión, así que la
  descarga fallaba siempre. La pista que lo delataba: la app **sí detectaba** que
  había versión nueva —esa consulta va por `fetch` de Node— pero nunca la bajaba.
  Se reemplazó la capa de red del actualizador por una sobre `node:https`
  (`src/main/actualizador-red.ts`), que es la misma pila que usa el resto del
  sistema, incluidas las llamadas a ARCA. Verificado contra la release real: baja
  el manifiesto, resuelve el redirect de GitHub al CDN, descarga los 113 MB y el
  sha512 coincide. Se agregaron además reintentos del primer chequeo (15 s, 1 min,
  5 min), porque a los 5 segundos de arrancar Windows suele no tener red todavía.
  **Ojo:** el actualizador roto no puede repararse a sí mismo — la 1.2.1 hay que
  instalarla a mano una vez.

- **TLS de ARCA:** sus servidores usan claves viejas que Node rechazaba. La
  facturación real **nunca habría funcionado**. Corregido con transporte propio.
- **Baja de cliente con deuda:** no se bloqueaba por una consulta duplicada.
- **Releases duplicados** en GitHub por electron-builder.
- **Cola offline duplicaba pedidos** al reintentar.

### Estado del release

⚠️ **GitHub Actions tiene una caída general** desde el 6/8, así que los
instaladores de Windows de v0.7.0 y v0.8.0 todavía no se generaron. Hay un
vigilante que los publica en cuanto se recupere. **El Mac ya tiene v0.8.0.**

---

## 6. Camino sugerido hasta la versión presentable

### ~~v0.8.0 — "Se puede operar de verdad"~~ ✅ ENTREGADA
1. ~~Ajuste manual de stock (B3)~~ ✅
2. ~~ABM de recetas (B4)~~ ✅
3. ~~ABM de listas de precio (I1)~~ ✅
4. ~~Firma de ARCA sin openssl externo (R2)~~ ✅
5. ~~Selector de archivo nativo para el certificado~~ ✅

### ~~v0.9.0 y v0.10.0~~ ✅ ENTREGADAS
6. ~~Impresión de remito y factura con QR de ARCA (B2)~~ ✅
7. ~~Modo "base limpia" para arrancar con datos del cliente (I2)~~ ✅

### v1.0.0 — "Presentable"
8. **Probar todo corriendo en Windows** (B1)
9. Decisión sobre login (I3)
10. Prueba de facturación real con el certificado del cliente
11. Repaso E2E completo sobre datos reales

**Estimación gruesa:** los puntos 6 y 7 son trabajo acotado y conocido. El punto
8 (Windows) es el que puede traer sorpresas, pero mucho menos que antes: se le
sacó la dependencia de `openssl`, que era lo único que podía romper la
facturación entera. Conviene igual hacerlo en paralelo, no al final.

---

## 7. Lo que se le puede mostrar al cliente HOY

Aunque falte lo de arriba, el sistema ya se puede demostrar:

- Cargar un pedido desde el celular y verlo aparecer solo en la pantalla de fábrica.
- Planificar una tanda, ejecutarla (sale el número de lote) y finalizarla viendo
  cómo se descuentan los insumos.
- Consultar la trazabilidad de un lote.
- Registrar una venta con descuento de stock y cuenta corriente.
- Abrir la caja, mover plata, cerrarla y ver la diferencia del arqueo.
- Cargar clientes, proveedores y artículos.
- Mostrar la pantalla de facturación ARCA y explicar qué falta de su lado.
