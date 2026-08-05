# Alpha Gestion — Fundación

ERP de escritorio instalable para una fábrica de alfajores.

Estado actual: **fundación completa + todos los módulos en modo lectura.** El modelo de datos
está entero (21 tablas), el motor de stock funciona sobre un ledger, y la interfaz recorre los
catorce módulos mostrando datos reales. Falta la capa de escritura: altas, ediciones y las
operaciones que registran movimientos desde la UI.

## Stack

| Capa | Tecnología |
|---|---|
| Shell de escritorio | Electron 43 |
| Servidor HTTP embebido | Fastify 5 (con pino) |
| Base de datos | SQLite vía better-sqlite3 (síncrono) |
| ORM y migraciones | Drizzle ORM + drizzle-kit |
| Renderer | React 18 + Vite + TypeScript + Tailwind |
| Validación | zod |
| Hash de contraseñas | bcrypt |

No se usa Prisma (problemas conocidos de empaquetado en Electron).

## Decisiones de arquitectura

### 1. Artículo unificado
Insumos y productos finales viven en **una sola tabla** `articulos`, discriminados por `tipo`:

- `materia_prima` + `pre_elaborado` → **Stock de Insumos**
- `producto_terminado` → **Stock de Productos**

La separación entre "stock de insumos" y "stock de productos" es una **vista derivada** (un filtro por `tipo`), nunca tablas distintas. Esto permite que un mismo artículo participe indistintamente de compras, recetas, producción y ventas sin duplicar entidades.

### 2. Ledger único de stock
`movimientos_stock` es la **única fuente de verdad** del inventario. No existe ningún campo `stock` mutable en `articulos`.

```
stock_actual(articulo) = SUM(movimientos_stock.cantidad WHERE articulo_id = ?)
```

Las cantidades llevan signo: `(+)` ingreso, `(-)` egreso, siempre expresadas en la unidad base del artículo. Cada movimiento referencia opcionalmente el documento que lo originó (`documento_tipo` + `documento_id`), lo que da trazabilidad completa hacia atrás.

### 3. Ledger único de cuenta corriente
`cuentas_corrientes` sirve a clientes **y** a proveedores mediante una referencia polimórfica (`entidad_tipo` + `entidad_id`).

```
saldo(entidad) = SUM(monto WHERE tipo_movimiento='debe') - SUM(monto WHERE tipo_movimiento='haber')
```

### 4. Recetas encadenables (BOM)
Cada `pre_elaborado` y cada `producto_terminado` tiene su propia receta. Una receta puede consumir otro pre-elaborado, lo que arma la cadena real de la fábrica:

```
Alfajor de maicena  ──consume──>  Dulce de leche (pre-elaborado)  ──consume──>  Leche (materia prima)
                    └─consume──>  Tapa de alfajor (materia prima comprada)
```

### 5. Dinero en centavos
**Todo importe se persiste como `INTEGER` en centavos.** Nunca `REAL`. La conversión a pesos ocurre exclusivamente en el frontend, al mostrar. Las cantidades sí son `REAL`, pero pasan siempre por `redondearCantidad()` (`src/server/utiles/numeros.ts`) antes de persistirse o compararse, para evitar drift de punto flotante.

### 6. La base vive fuera del bundle
El archivo SQLite se guarda en la carpeta `userData` de Electron, **no** dentro de la app:

| Sistema | Ruta |
|---|---|
| macOS | `~/Library/Application Support/alfajores-erp/alfajores.db` |
| Windows | `%APPDATA%\alfajores-erp\alfajores.db` |
| Linux | `~/.config/alfajores-erp/alfajores.db` |

Así sobrevive a actualizaciones y reinstalaciones. Se puede forzar otra ruta con `ALFAJORES_DB_PATH` (útil para pruebas).

Al abrirse se aplican los PRAGMA `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000` y `synchronous=NORMAL`.

### 7. Same-origin, sin CORS
- **Desarrollo**: Electron carga el dev server de Vite (`:5173`), que proxea `/health` y `/api` al Fastify embebido (`:4600`).
- **Producción**: Fastify sirve el renderer compilado, y Electron carga la URL del propio servidor.

En ambos casos el renderer usa rutas relativas y queda same-origin con la API. El mismo mecanismo de estáticos es el que servirá después la ruta `/pedidos` para el celular.

## Instalación y puesta en marcha

Requisitos: Node.js ≥ 20 y npm. En macOS, las Command Line Tools de Xcode (para compilar los módulos nativos).

```bash
# 1. Entrar al proyecto
cd alfajores-erp

# 2. Instalar dependencias
#    El postinstall corre electron-rebuild automáticamente para los módulos nativos
#    (better-sqlite3 y bcrypt).
npm install

# 3. Generar la migración inicial desde el schema de Drizzle
#    (ya está versionada en drizzle/, este paso solo hace falta si tocás el schema)
npm run db:generar

# 4. Aplicar las migraciones a la base de userData
npm run db:migrar

# 5. Cargar los datos de prueba (idempotente: se puede correr las veces que quieras)
npm run db:seed

# 6. Levantar la app en modo desarrollo
npm run dev
```

El seed base carga solo el catálogo. Para llenar todos los módulos con un negocio en marcha
—compras, producción, ventas, pedidos, caja y cuentas corrientes— usá el flag de demostración:

```bash
ALFAJORES_SEED_DEMO=1 npm run db:seed
```

Los datos de demo son **coherentes con los dos ledgers**: cada compra recibida genera su
movimiento de stock positivo, cada venta uno negativo, cada orden finalizada consume insumos e
ingresa producto terminado, las operaciones de contado impactan en la caja del día y las de cuenta
corriente en el ledger de cuentas corrientes. La línea de tiempo está ordenada para que ningún
artículo pase por stock negativo.

También existe `ALFAJORES_SEED_MOVIMIENTOS=1`, que agrega unos pocos movimientos de stock sueltos
sin el resto del set de demostración.

> El paso 4 es opcional: el proceso main aplica las migraciones automáticamente al arrancar si la base no existe o está desactualizada. Está expuesto como script para poder preparar la base sin levantar Electron.

### Otros comandos

```bash
npm run typecheck      # Chequeo de tipos de main/server/seed y del renderer
npm run build          # Compila main/server/seed (tsc) + renderer (vite)
npm start              # Compila todo y abre la app en modo producción
npm run db:studio      # Explorador visual de la base (Drizzle Studio)
```

## Instalar la app

### macOS (equipo de prueba)

```bash
npm run instalar:mac
```

Compila, empaqueta con electron-builder e instala en `/Applications/Alpha Gestion.app`.
Es también el camino de **actualización**: cada corrida reemplaza la versión instalada por
la recién compilada. Si la app está abierta, la cierra antes de reemplazarla — macOS no
permite pisar un bundle en ejecución.

**La base de datos no se toca.** Vive en `~/Library/Application Support/alfajores-erp/`,
fuera del bundle, así que los datos sobreviven a cualquier reinstalación.

El build local va **sin firmar**. La primera vez macOS puede pedir confirmación; el script
limpia los atributos de cuarentena para evitar el cartel de "aplicación dañada". Para
distribuir de verdad hay que configurar `CSC_LINK` + `CSC_KEY_PASSWORD` y activar
`hardenedRuntime` + notarización en [electron-builder.yml](electron-builder.yml).

### Windows (destino de producción)

```bash
npm run build:win
```

Genera un instalador NSIS x64 en `release/`. **Sin verificar todavía**: construir el
instalador de Windows desde macOS requiere Wine, y lo razonable es correrlo en Windows o
en CI. La configuración está lista en [electron-builder.yml](electron-builder.yml).

### Ícono

```bash
npm run iconos
```

Regenera `build/icon.png`, `build/icon.icns` (macOS) y `build/icon.ico` (Windows) a partir
de [build/icon.svg](build/icon.svg), que es la fuente editable. El SVG se rasteriza con el
propio Electron —una ventana oculta que captura la página— en vez de sumar una dependencia
nativa de imágenes.

### Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `ALFAJORES_PUERTO` | `4600` | Puerto del servidor Fastify embebido |
| `ALFAJORES_HOST` | `127.0.0.1` | Host de escucha |
| `ALFAJORES_DB_PATH` | userData | Fuerza la ruta del archivo SQLite |
| `ALFAJORES_LOG_LEVEL` | `info` / `warn` | Nivel de log de pino |
| `ALFAJORES_SEED_DEMO` | — | `1` para sembrar el set completo de demostración |
| `ALFAJORES_SEED_MOVIMIENTOS` | — | `1` para sembrar solo movimientos de stock de ejemplo |

## API de lectura

Todos los endpoints son `GET` y devuelven `{ "datos": ... }`. Las formas viajan tipadas en
[src/compartido/contratos.ts](src/compartido/contratos.ts), el mismo módulo que compilan el
servidor y el renderer: un desajuste de contrato es un error de compilación, no una sorpresa
en runtime.

| Ruta | Devuelve |
|---|---|
| `/health` | Estado del servidor y de la base (`503` si la base falla) |
| `/api/resumen` | Indicadores del tablero de inicio |
| `/api/articulos` | Artículos con stock calculado desde el ledger |
| `/api/articulos/:id/stock` | Saldo de un artículo |
| `/api/articulos/:id/movimientos` | Ledger del artículo con saldo acumulado |
| `/api/stock?grupo=insumos\|productos` | Saldos agrupados |
| `/api/recetas` | Recetas con sus items |
| `/api/produccion/ordenes` | Órdenes de producción |
| `/api/pedidos` | Pedidos con sus items |
| `/api/ventas` | Ventas |
| `/api/compras` | Compras |
| `/api/caja/cajas` | Aperturas y cierres de caja |
| `/api/caja/movimientos?cajaId=` | Movimientos de una caja |
| `/api/cuentas-corrientes` | Saldos por entidad |
| `/api/clientes` · `/api/proveedores` | Maestros con su saldo de cuenta corriente |
| `/api/listas-precio` | Listas con sus precios |

Los errores devuelven siempre `{ "error": { "codigo": "...", "mensaje": "...", "detalles": ... } }`.

Mapeo de errores de dominio a HTTP ([src/server/dominio/errores.ts](src/server/dominio/errores.ts)):

| Código de dominio | HTTP |
|---|---|
| `VALIDACION` | 400 |
| `ENTIDAD_NO_ENCONTRADA` | 404 |
| `CONFLICTO` | 409 |
| `REGLA_NEGOCIO` | 422 |
| `ERROR_DATOS` | 500 |

## Módulos de la interfaz

La app abre con navegación lateral y catorce pantallas, **todas de solo lectura** en esta etapa
(las altas y operaciones vienen después):

| Grupo | Pantallas |
|---|---|
| General | Inicio (tablero de indicadores) |
| Stock | Insumos · Productos · Artículos |
| Producción | Recetas (expandibles, con su BOM) · Órdenes |
| Comercial | Pedidos (expandibles; los del celular se destacan) · Ventas · Compras |
| Finanzas | Caja (con sus movimientos) · Cuentas corrientes |
| Maestros | Clientes · Proveedores · Precios |

Al hacer clic en una fila de Stock o Artículos se abre el **ledger de ese artículo**, con el saldo
acumulado movimiento a movimiento. Es la pantalla que muestra que el stock se calcula sumando el
ledger y no se lee de un campo guardado.

El ruteo es propio, sin librerías: el módulo activo se refleja en `location.hash`, así que el
refresh y el HMR no pierden la pantalla.

## Modelo de datos

21 tablas. Todos los nombres de tablas y columnas están en español, en `snake_case`.

**Catálogo y stock**
`unidades_medida`, `articulos`, `movimientos_stock` (ledger)

**Producción**
`recetas`, `receta_items`, `ordenes_produccion`, `produccion_consumos`

**Compras y ventas**
`proveedores`, `compras`, `compra_items`, `clientes`, `ventas`, `venta_items`

**Pedidos** (feature estrella, carga desde el celular)
`pedidos`, `pedido_items`

**Finanzas**
`cuentas_corrientes` (ledger), `cajas`, `caja_movimientos`, `listas_precio`, `precios`

**Acceso**
`usuarios`

El schema completo, con sus FKs, índices y constraints `CHECK` sobre los enums, está en [src/server/db/schema.ts](src/server/db/schema.ts).

## Fuera de alcance en esta etapa

Deliberadamente **no** implementados todavía, pero con la arquitectura preparada para recibirlos:

- UI de los módulos de negocio
- PWA `/pedidos` para el celular → el servidor Fastify y el handler de estáticos ya están listos para servirla
- Cloudflare Tunnel → el host de escucha ya es configurable
- Impresión térmica y auto-updater → el preload ya está preparado para colgar canales IPC tipados

## Estructura de carpetas

```
alfajores-erp/
├── tsconfig.json               Base compartida (strict)
├── tsconfig.node.json          main + server + seed  → CommonJS a dist/
├── tsconfig.renderer.json      renderer              → chequeo de tipos, lo emite Vite
├── vite.config.ts              root=src/renderer, proxy /health y /api → :4600
├── tailwind.config.cjs         Sistema de diseño propio (tokens de marca)
├── drizzle/                    Migraciones SQL generadas (versionadas)
├── scripts/dev.mjs             Orquestador de dev: tsc → Vite → Electron
└── src/
    ├── compartido/             Módulos PUROS que usan los tres procesos
    │   ├── config.ts           Constantes (sin acceso a Node)
    │   └── contratos.ts        ★ Tipos de la API: servidor y renderer compilan contra esto
    ├── main/                   Proceso principal de Electron
    │   ├── index.ts            Arranque: migraciones → servidor → ventana
    │   ├── ventana.ts          BrowserWindow endurecida
    │   ├── ciclo-vida.ts       Apagado limpio y guardias de error
    │   └── preload.ts          Puente mínimo (futuros canales IPC)
    ├── server/                 Servidor Fastify embebido
    │   ├── servidor.ts         crearServidor / iniciarServidor
    │   ├── config.ts           Lectura de variables de entorno (solo Node)
    │   ├── db/
    │   │   ├── schema.ts       ★ Schema Drizzle completo (21 tablas)
    │   │   ├── conexion.ts     better-sqlite3 + PRAGMAs + Drizzle
    │   │   ├── migraciones.ts  Aplicación automática al arrancar
    │   │   └── rutas-db.ts     Resolución de userData y migraciones
    │   ├── dominio/            Núcleo desacoplado de Fastify y de Drizzle
    │   │   ├── tipos.ts
    │   │   └── errores.ts      Errores de dominio + mapeo a HTTP
    │   ├── repositorios/       Única capa que conoce Drizzle
    │   │   ├── *.repositorio.ts
    │   │   └── lectura/        Consultas de los módulos (una por área)
    │   ├── servicios/          Regla de negocio
    │   │   ├── stock.servicio.ts             ★ Ledger de stock
    │   │   ├── cuentas-corrientes.servicio.ts
    │   │   └── consultas.servicio.ts         Arma las vistas del contrato
    │   ├── rutas/              Validan con zod, delegan, serializan
    │   ├── plugins/            Manejador de errores · estáticos (base para /pedidos)
    │   └── utiles/numeros.ts   Redondeo centralizado + centavos
    ├── seed/                   Datos de prueba idempotentes
    │   ├── datos.ts · sembrar.ts   Catálogo base
    │   └── demo.ts             Set de demostración coherente con los ledgers
    └── renderer/               React 18 + Vite + Tailwind
        ├── App.tsx             Shell + router propio por hash
        ├── navegacion.ts       Definición tipada de los 14 módulos
        ├── servicios/cliente.ts
        ├── ganchos/usarRecurso.ts   Carga con estados y reintento
        ├── utiles/formato.ts        Moneda, cantidad, fecha
        ├── componentes/        Tabla genérica, barra lateral, panel de ledger, estados
        └── pantallas/          Inicio · Stock · Produccion · Comercial · Finanzas · Maestros
```

## Si algo falla

**`TypeError: Cannot read properties of undefined (reading 'setName')` al arrancar**, o **la app instalada se cierra al instante sin decir nada.**
Las dos cosas son el mismo síntoma: el entorno tiene `ELECTRON_RUN_AS_NODE=1`, lo que hace que Electron corra como Node puro. En desarrollo `require('electron')` no devuelve el módulo nativo; en la app empaquetada el binario arranca sin script y sale con código 0 en silencio. Algunas terminales integradas de editores basados en Electron exportan esa variable a los procesos hijos. `npm run dev` y `npm run instalar:mac` ya la limpian, y abrir la app desde el Finder o el Dock nunca la tiene. Si lanzás el binario a mano desde una terminal así, usá `env -u ELECTRON_RUN_AS_NODE`.

**`No se encontro la carpeta de migraciones`.**
Corré `npm run db:generar` para regenerarlas desde el schema.

**El puerto 4600 está ocupado.**
El servidor reintenta automáticamente con los 10 puertos siguientes. En modo dev el proxy de Vite apunta fijo al 4600, así que si tuvo que correrse verás un aviso en consola: cerrá el proceso que lo ocupa o cambiá `ALFAJORES_PUERTO`.

**La tabla aparece vacía.**
Falta el seed: `npm run db:seed`. Para ver stock distinto de cero, `ALFAJORES_SEED_MOVIMIENTOS=1 npm run db:seed`.

## Credenciales de prueba

El seed crea un usuario `admin` con contraseña `alfajores123`, hasheada con bcrypt.
**Es una credencial de prueba: cambiala antes de cualquier uso real.**
