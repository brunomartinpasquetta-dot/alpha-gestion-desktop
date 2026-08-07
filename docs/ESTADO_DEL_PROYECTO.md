# Estado del proyecto — Alpha Gestión

**Fecha:** 6 de agosto de 2026 · **Versión instalada:** v0.10.0 · **Repositorio:** `brunomartinpasquetta-dot/alpha-gestion-desktop`

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
| **Producción y trazabilidad** | ✅ Operativo | Planificar → ejecutar (nace el lote) → finalizar (consume insumos, ingresa producto) |
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

**B1 · Probar el sistema corriendo en Windows.**
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

**I3 · Login y usuarios.** La tabla existe y la pantalla los lista, pero no hay
autenticación: cualquiera que abra el programa hace todo. Para una fábrica chica
puede ser aceptable al principio, pero hay que decidirlo con el cliente.

**I4 · Editar y anular pedidos.** Se puede cambiar el estado, no corregir un
pedido mal cargado desde el celular.

### 🟢 DESEABLES (no bloquean la presentación)

- **Contabilidad:** la pantalla dice "no implementado". Requiere plan de cuentas,
  asientos y libro IVA — es un módulo entero, no un ajuste.
- **Impresión térmica** (comanda de producción).
- **Acceso desde fuera de la fábrica** (túnel de Cloudflare). Ojo: requiere
  endurecer la seguridad antes, ver §5.
- **Reportes exportables** a Excel/PDF.
- **Backup automático** de la base.

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
