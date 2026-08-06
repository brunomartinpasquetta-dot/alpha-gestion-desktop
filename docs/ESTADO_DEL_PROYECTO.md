# Estado del proyecto — Alpha Gestión

**Fecha:** 6 de agosto de 2026 · **Versión instalada:** v0.7.0 · **Repositorio:** `brunomartinpasquetta-dot/alpha-gestion-desktop`

Este documento dice qué está terminado, qué falta y en qué orden conviene hacerlo
para llegar a una versión presentable al cliente. Se actualiza en cada entrega.

---

## 1. Resumen en una línea

El sistema **ya opera**: se puede vender, comprar, producir, cobrar, pagar y
facturar electrónicamente. Lo que falta para presentarlo es **cerrar tres huecos
funcionales** (recetas, ajustes de stock, listas de precio), **imprimir los
comprobantes** y **probarlo en Windows**, que es donde va a correr.

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
el runtime no se ejercitó. Riesgo concreto: rutas de archivos, el `openssl` que
usa la firma de ARCA (en Windows puede no estar en el PATH), y los permisos de
red. **Es el mayor riesgo abierto del proyecto.**

**B2 · Imprimir comprobantes.**
Hoy la venta se registra y obtiene el CAE, pero no hay forma de entregarle al
cliente un papel. Falta el remito/factura imprimible con el QR de ARCA. Sin esto
la fábrica no puede operar de verdad.

**B3 · Ajuste manual de stock.**
No hay forma de corregir un stock sin inventar una compra o una venta. Es
imprescindible: roturas, mermas, recuentos, y la carga inicial del stock real
cuando el cliente arranque.

**B4 · ABM de recetas.**
Las recetas son el corazón de la producción y hoy solo se leen: vienen del seed.
El cliente no puede cargar sus propias fórmulas, así que no puede producir nada
suyo.

### 🟡 IMPORTANTES antes de que opere en serio

**I1 · ABM de listas de precio.** Se ven pero no se editan. Sin esto no puede
actualizar precios, que en Argentina es semanal.

**I2 · Carga inicial de datos del cliente.** Hoy la base tiene datos de
demostración. Hace falta una forma de arrancar limpio y cargar sus artículos,
clientes y proveedores reales.

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
| R2 | **`openssl` externo para firmar ARCA** | Alto en Windows | Verificar que exista o empaquetarlo |
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

### Estado del release v0.7.0

⚠️ El tag está pusheado pero **GitHub Actions tiene una caída general** desde el
6/8, así que el instalador de Windows de esta versión todavía no se generó. Hay
un vigilante que lo publica en cuanto se recupere. **El Mac ya tiene v0.7.0.**

---

## 6. Camino sugerido hasta la versión presentable

### v0.8.0 — "Se puede operar de verdad"
1. Ajuste manual de stock (B3)
2. ABM de recetas (B4)
3. ABM de listas de precio (I1)

### v0.9.0 — "Se puede entregar el papel"
4. Impresión de remito y factura con QR de ARCA (B2)
5. Modo "base limpia" para arrancar con datos del cliente (I2)

### v1.0.0 — "Presentable"
6. **Probar todo corriendo en Windows** (B1, R2)
7. Decisión sobre login (I3)
8. Prueba de facturación real con el certificado del cliente
9. Repaso E2E completo sobre datos reales

**Estimación gruesa:** los puntos 1 a 5 son trabajo acotado y conocido. El punto
6 es el que puede traer sorpresas, porque es la primera vez que el sistema toca
Windows. Conviene hacerlo **antes** de lo que dice la lista, en paralelo, para no
descubrir un problema grande al final.

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
