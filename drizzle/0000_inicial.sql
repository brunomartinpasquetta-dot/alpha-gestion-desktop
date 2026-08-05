CREATE TABLE `articulos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`codigo` text NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text NOT NULL,
	`unidad_base_id` integer NOT NULL,
	`stock_min` real,
	`costo_actual` integer,
	`activo` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`unidad_base_id`) REFERENCES `unidades_medida`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_articulos_tipo" CHECK("articulos"."tipo" IN ('materia_prima','pre_elaborado','producto_terminado')),
	CONSTRAINT "ck_articulos_stock_min" CHECK("articulos"."stock_min" IS NULL OR "articulos"."stock_min" >= 0),
	CONSTRAINT "ck_articulos_costo_actual" CHECK("articulos"."costo_actual" IS NULL OR "articulos"."costo_actual" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_articulos_codigo` ON `articulos` (`codigo`);--> statement-breakpoint
CREATE INDEX `ix_articulos_tipo` ON `articulos` (`tipo`);--> statement-breakpoint
CREATE INDEX `ix_articulos_activo` ON `articulos` (`activo`);--> statement-breakpoint
CREATE TABLE `caja_movimientos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`caja_id` integer,
	`tipo` text NOT NULL,
	`concepto` text NOT NULL,
	`monto` integer NOT NULL,
	`documento_tipo` text,
	`documento_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`usuario` text,
	`notas` text,
	FOREIGN KEY (`caja_id`) REFERENCES `cajas`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_caja_movimientos_tipo" CHECK("caja_movimientos"."tipo" IN ('ingreso','egreso')),
	CONSTRAINT "ck_caja_movimientos_monto" CHECK("caja_movimientos"."monto" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_caja_movimientos_caja_fecha` ON `caja_movimientos` (`caja_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `ix_caja_movimientos_documento` ON `caja_movimientos` (`documento_tipo`,`documento_id`);--> statement-breakpoint
CREATE TABLE `cajas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha_apertura` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`fecha_cierre` text,
	`monto_apertura` integer DEFAULT 0 NOT NULL,
	`monto_cierre_teorico` integer,
	`monto_cierre_real` integer,
	`diferencia` integer,
	`estado` text DEFAULT 'abierta' NOT NULL,
	`usuario` text,
	CONSTRAINT "ck_cajas_estado" CHECK("cajas"."estado" IN ('abierta','cerrada'))
);
--> statement-breakpoint
CREATE INDEX `ix_cajas_estado` ON `cajas` (`estado`);--> statement-breakpoint
CREATE INDEX `ix_cajas_fecha_apertura` ON `cajas` (`fecha_apertura`);--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`cuit` text,
	`telefono` text,
	`email` text,
	`direccion` text,
	`tipo` text DEFAULT 'mostrador' NOT NULL,
	`lista_precio_id` integer,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`lista_precio_id`) REFERENCES `listas_precio`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_clientes_tipo" CHECK("clientes"."tipo" IN ('mostrador','mayorista','distribuidor'))
);
--> statement-breakpoint
CREATE INDEX `ix_clientes_nombre` ON `clientes` (`nombre`);--> statement-breakpoint
CREATE INDEX `ix_clientes_tipo` ON `clientes` (`tipo`);--> statement-breakpoint
CREATE TABLE `compra_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`compra_id` integer NOT NULL,
	`articulo_id` integer NOT NULL,
	`cantidad_compra` real NOT NULL,
	`unidad_compra_id` integer NOT NULL,
	`factor_conversion` real DEFAULT 1 NOT NULL,
	`cantidad_base` real NOT NULL,
	`costo_unitario` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`compra_id`) REFERENCES `compras`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`unidad_compra_id`) REFERENCES `unidades_medida`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_compra_items_cantidad_compra" CHECK("compra_items"."cantidad_compra" > 0),
	CONSTRAINT "ck_compra_items_factor" CHECK("compra_items"."factor_conversion" > 0),
	CONSTRAINT "ck_compra_items_cantidad_base" CHECK("compra_items"."cantidad_base" > 0),
	CONSTRAINT "ck_compra_items_costo" CHECK("compra_items"."costo_unitario" >= 0),
	CONSTRAINT "ck_compra_items_subtotal" CHECK("compra_items"."subtotal" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_compra_items_compra` ON `compra_items` (`compra_id`);--> statement-breakpoint
CREATE INDEX `ix_compra_items_articulo` ON `compra_items` (`articulo_id`);--> statement-breakpoint
CREATE TABLE `compras` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`proveedor_id` integer NOT NULL,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`forma_pago` text DEFAULT 'contado' NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`notas` text,
	FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_compras_forma_pago" CHECK("compras"."forma_pago" IN ('contado','cuenta_corriente')),
	CONSTRAINT "ck_compras_estado" CHECK("compras"."estado" IN ('pendiente','recibida')),
	CONSTRAINT "ck_compras_total" CHECK("compras"."total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_compras_proveedor_fecha` ON `compras` (`proveedor_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `ix_compras_estado` ON `compras` (`estado`);--> statement-breakpoint
CREATE TABLE `cuentas_corrientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entidad_tipo` text NOT NULL,
	`entidad_id` integer NOT NULL,
	`tipo_movimiento` text NOT NULL,
	`monto` integer NOT NULL,
	`documento_tipo` text NOT NULL,
	`documento_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`notas` text,
	CONSTRAINT "ck_cuentas_corrientes_entidad_tipo" CHECK("cuentas_corrientes"."entidad_tipo" IN ('cliente','proveedor')),
	CONSTRAINT "ck_cuentas_corrientes_tipo_movimiento" CHECK("cuentas_corrientes"."tipo_movimiento" IN ('debe','haber')),
	CONSTRAINT "ck_cuentas_corrientes_documento_tipo" CHECK("cuentas_corrientes"."documento_tipo" IN ('venta','compra','cobro','pago')),
	CONSTRAINT "ck_cuentas_corrientes_monto" CHECK("cuentas_corrientes"."monto" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_cuentas_corrientes_entidad_fecha` ON `cuentas_corrientes` (`entidad_tipo`,`entidad_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `ix_cuentas_corrientes_documento` ON `cuentas_corrientes` (`documento_tipo`,`documento_id`);--> statement-breakpoint
CREATE TABLE `listas_precio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`activa` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_listas_precio_nombre` ON `listas_precio` (`nombre`);--> statement-breakpoint
CREATE TABLE `movimientos_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`articulo_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`cantidad` real NOT NULL,
	`costo_unitario` integer,
	`documento_tipo` text,
	`documento_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`notas` text,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_movimientos_stock_tipo" CHECK("movimientos_stock"."tipo" IN ('compra','venta','consumo_produccion','ingreso_produccion','merma','ajuste')),
	CONSTRAINT "ck_movimientos_stock_documento_tipo" CHECK("movimientos_stock"."documento_tipo" IS NULL OR "movimientos_stock"."documento_tipo" IN ('compra','venta','orden_produccion','ajuste')),
	CONSTRAINT "ck_movimientos_stock_cantidad" CHECK("movimientos_stock"."cantidad" <> 0),
	CONSTRAINT "ck_movimientos_stock_costo" CHECK("movimientos_stock"."costo_unitario" IS NULL OR "movimientos_stock"."costo_unitario" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_movimientos_stock_articulo_fecha` ON `movimientos_stock` (`articulo_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `ix_movimientos_stock_documento` ON `movimientos_stock` (`documento_tipo`,`documento_id`);--> statement-breakpoint
CREATE INDEX `ix_movimientos_stock_tipo` ON `movimientos_stock` (`tipo`);--> statement-breakpoint
CREATE TABLE `ordenes_produccion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receta_id` integer NOT NULL,
	`articulo_producido_id` integer NOT NULL,
	`cantidad_planificada` real NOT NULL,
	`factor_escala` real DEFAULT 1 NOT NULL,
	`estado` text DEFAULT 'planificada' NOT NULL,
	`pedido_id` integer,
	`rinde_real` real,
	`fecha_planificada` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`fecha_inicio` text,
	`fecha_fin` text,
	`notas` text,
	FOREIGN KEY (`receta_id`) REFERENCES `recetas`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`articulo_producido_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_ordenes_produccion_estado" CHECK("ordenes_produccion"."estado" IN ('planificada','en_proceso','finalizada','cancelada')),
	CONSTRAINT "ck_ordenes_produccion_cantidad" CHECK("ordenes_produccion"."cantidad_planificada" > 0),
	CONSTRAINT "ck_ordenes_produccion_factor" CHECK("ordenes_produccion"."factor_escala" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_estado_fecha` ON `ordenes_produccion` (`estado`,`fecha_planificada`);--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_articulo` ON `ordenes_produccion` (`articulo_producido_id`);--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_pedido` ON `ordenes_produccion` (`pedido_id`);--> statement-breakpoint
CREATE TABLE `pedido_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pedido_id` integer NOT NULL,
	`articulo_id` integer NOT NULL,
	`cantidad` real NOT NULL,
	`notas` text,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pedido_items_cantidad" CHECK("pedido_items"."cantidad" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_pedido_items_pedido` ON `pedido_items` (`pedido_id`);--> statement-breakpoint
CREATE TABLE `pedidos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer,
	`origen` text DEFAULT 'sistema' NOT NULL,
	`estado` text DEFAULT 'pendiente' NOT NULL,
	`fecha_pedido` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`fecha_entrega_estimada` text,
	`cargado_por` text,
	`notas` text,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_pedidos_origen" CHECK("pedidos"."origen" IN ('celular','mostrador','sistema')),
	CONSTRAINT "ck_pedidos_estado" CHECK("pedidos"."estado" IN ('pendiente','confirmado','en_produccion','listo','entregado','cancelado'))
);
--> statement-breakpoint
CREATE INDEX `ix_pedidos_estado_fecha` ON `pedidos` (`estado`,`fecha_pedido`);--> statement-breakpoint
CREATE INDEX `ix_pedidos_cliente` ON `pedidos` (`cliente_id`);--> statement-breakpoint
CREATE TABLE `precios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`articulo_id` integer NOT NULL,
	`lista_precio_id` integer NOT NULL,
	`precio` integer NOT NULL,
	`vigente_desde` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`lista_precio_id`) REFERENCES `listas_precio`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "ck_precios_precio" CHECK("precios"."precio" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_precios_articulo_lista` ON `precios` (`articulo_id`,`lista_precio_id`,`vigente_desde`);--> statement-breakpoint
CREATE TABLE `produccion_consumos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`orden_id` integer NOT NULL,
	`articulo_insumo_id` integer NOT NULL,
	`cantidad_teorica` real NOT NULL,
	`cantidad_real` real,
	FOREIGN KEY (`orden_id`) REFERENCES `ordenes_produccion`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_insumo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_produccion_consumos_teorica" CHECK("produccion_consumos"."cantidad_teorica" >= 0),
	CONSTRAINT "ck_produccion_consumos_real" CHECK("produccion_consumos"."cantidad_real" IS NULL OR "produccion_consumos"."cantidad_real" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_produccion_consumos_orden` ON `produccion_consumos` (`orden_id`);--> statement-breakpoint
CREATE INDEX `ix_produccion_consumos_insumo` ON `produccion_consumos` (`articulo_insumo_id`);--> statement-breakpoint
CREATE TABLE `proveedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`cuit` text,
	`telefono` text,
	`email` text,
	`direccion` text,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_proveedores_nombre` ON `proveedores` (`nombre`);--> statement-breakpoint
CREATE TABLE `receta_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receta_id` integer NOT NULL,
	`articulo_insumo_id` integer NOT NULL,
	`cantidad` real NOT NULL,
	`merma_esperada_pct` real DEFAULT 0 NOT NULL,
	FOREIGN KEY (`receta_id`) REFERENCES `recetas`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_insumo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_receta_items_cantidad" CHECK("receta_items"."cantidad" > 0),
	CONSTRAINT "ck_receta_items_merma" CHECK("receta_items"."merma_esperada_pct" >= 0 AND "receta_items"."merma_esperada_pct" <= 100)
);
--> statement-breakpoint
CREATE INDEX `ix_receta_items_receta` ON `receta_items` (`receta_id`);--> statement-breakpoint
CREATE INDEX `ix_receta_items_insumo` ON `receta_items` (`articulo_insumo_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_receta_items_receta_insumo` ON `receta_items` (`receta_id`,`articulo_insumo_id`);--> statement-breakpoint
CREATE TABLE `recetas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`articulo_producido_id` integer NOT NULL,
	`rinde_cantidad` real NOT NULL,
	`rinde_unidad_id` integer NOT NULL,
	`activa` integer DEFAULT true NOT NULL,
	`notas` text,
	FOREIGN KEY (`articulo_producido_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`rinde_unidad_id`) REFERENCES `unidades_medida`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_recetas_rinde_cantidad" CHECK("recetas"."rinde_cantidad" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_recetas_articulo_producido` ON `recetas` (`articulo_producido_id`);--> statement-breakpoint
CREATE TABLE `unidades_medida` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`abreviatura` text NOT NULL,
	`tipo_magnitud` text NOT NULL,
	CONSTRAINT "ck_unidades_medida_tipo_magnitud" CHECK("unidades_medida"."tipo_magnitud" IN ('peso','volumen','unidad'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_unidades_medida_abreviatura` ON `unidades_medida` (`abreviatura`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`rol` text DEFAULT 'empleado' NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	CONSTRAINT "ck_usuarios_rol" CHECK("usuarios"."rol" IN ('admin','empleado'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_usuarios_username` ON `usuarios` (`username`);--> statement-breakpoint
CREATE TABLE `venta_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`articulo_id` integer NOT NULL,
	`cantidad` real NOT NULL,
	`precio_unitario` integer DEFAULT 0 NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_venta_items_cantidad" CHECK("venta_items"."cantidad" > 0),
	CONSTRAINT "ck_venta_items_precio" CHECK("venta_items"."precio_unitario" >= 0),
	CONSTRAINT "ck_venta_items_subtotal" CHECK("venta_items"."subtotal" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_venta_items_venta` ON `venta_items` (`venta_id`);--> statement-breakpoint
CREATE INDEX `ix_venta_items_articulo` ON `venta_items` (`articulo_id`);--> statement-breakpoint
CREATE TABLE `ventas` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cliente_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`forma_pago` text DEFAULT 'contado' NOT NULL,
	`pedido_id` integer,
	`estado` text DEFAULT 'entregada' NOT NULL,
	`notas` text,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_ventas_forma_pago" CHECK("ventas"."forma_pago" IN ('contado','cuenta_corriente')),
	CONSTRAINT "ck_ventas_estado" CHECK("ventas"."estado" IN ('pendiente','entregada','anulada')),
	CONSTRAINT "ck_ventas_total" CHECK("ventas"."total" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_ventas_fecha` ON `ventas` (`fecha`);--> statement-breakpoint
CREATE INDEX `ix_ventas_cliente_fecha` ON `ventas` (`cliente_id`,`fecha`);--> statement-breakpoint
CREATE INDEX `ix_ventas_pedido` ON `ventas` (`pedido_id`);