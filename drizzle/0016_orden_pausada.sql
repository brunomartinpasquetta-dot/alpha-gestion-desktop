PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ordenes_produccion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`receta_id` integer NOT NULL,
	`articulo_producido_id` integer NOT NULL,
	`cantidad_planificada` real NOT NULL,
	`factor_escala` real DEFAULT 1 NOT NULL,
	`estado` text DEFAULT 'planificada' NOT NULL,
	`numero_lote` text,
	`pedido_id` integer,
	`rinde_real` real,
	`fecha_planificada` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`fecha_inicio` text,
	`fecha_fin` text,
	`notas` text,
	FOREIGN KEY (`receta_id`) REFERENCES `recetas`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`articulo_producido_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_ordenes_produccion_estado" CHECK("__new_ordenes_produccion"."estado" IN ('planificada','en_proceso','pausada','finalizada','cancelada')),
	CONSTRAINT "ck_ordenes_produccion_cantidad" CHECK("__new_ordenes_produccion"."cantidad_planificada" > 0),
	CONSTRAINT "ck_ordenes_produccion_factor" CHECK("__new_ordenes_produccion"."factor_escala" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_ordenes_produccion`("id", "receta_id", "articulo_producido_id", "cantidad_planificada", "factor_escala", "estado", "numero_lote", "pedido_id", "rinde_real", "fecha_planificada", "fecha_inicio", "fecha_fin", "notas") SELECT "id", "receta_id", "articulo_producido_id", "cantidad_planificada", "factor_escala", "estado", "numero_lote", "pedido_id", "rinde_real", "fecha_planificada", "fecha_inicio", "fecha_fin", "notas" FROM `ordenes_produccion`;--> statement-breakpoint
DROP TABLE `ordenes_produccion`;--> statement-breakpoint
ALTER TABLE `__new_ordenes_produccion` RENAME TO `ordenes_produccion`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_estado_fecha` ON `ordenes_produccion` (`estado`,`fecha_planificada`);--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_articulo` ON `ordenes_produccion` (`articulo_producido_id`);--> statement-breakpoint
CREATE INDEX `ix_ordenes_produccion_pedido` ON `ordenes_produccion` (`pedido_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_ordenes_produccion_numero_lote` ON `ordenes_produccion` (`numero_lote`);