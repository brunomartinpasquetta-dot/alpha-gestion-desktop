CREATE TABLE `precios_presentacion` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`presentacion_id` integer NOT NULL,
	`lista_precio_id` integer NOT NULL,
	`precio` integer NOT NULL,
	`vigente_desde` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`presentacion_id`) REFERENCES `presentaciones`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`lista_precio_id`) REFERENCES `listas_precio`(`id`) ON UPDATE cascade ON DELETE cascade,
	CONSTRAINT "ck_precios_presentacion_precio" CHECK("precios_presentacion"."precio" >= 0)
);
--> statement-breakpoint
CREATE INDEX `ix_precios_presentacion_lista` ON `precios_presentacion` (`presentacion_id`,`lista_precio_id`,`vigente_desde`);--> statement-breakpoint
CREATE TABLE `presentacion_componentes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`presentacion_id` integer NOT NULL,
	`articulo_id` integer NOT NULL,
	`unidades` real NOT NULL,
	FOREIGN KEY (`presentacion_id`) REFERENCES `presentaciones`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_presentacion_componentes_unidades" CHECK("presentacion_componentes"."unidades" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_presentacion_componentes_presentacion` ON `presentacion_componentes` (`presentacion_id`);--> statement-breakpoint
CREATE TABLE `presentaciones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`codigo` text NOT NULL,
	`precio_propio` integer DEFAULT false NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_presentaciones_codigo` ON `presentaciones` (`codigo`);--> statement-breakpoint
ALTER TABLE `listas_precio` ADD `base_lista_id` integer;--> statement-breakpoint
ALTER TABLE `listas_precio` ADD `recargo_pct` real;