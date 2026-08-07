CREATE TABLE `familias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`padre_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_familias_nombre` ON `familias` (`nombre`);--> statement-breakpoint
ALTER TABLE `articulos` ADD `stock_ideal` real;--> statement-breakpoint
ALTER TABLE `articulos` ADD `codigo_barras` text;--> statement-breakpoint
ALTER TABLE `articulos` ADD `marca` text;--> statement-breakpoint
ALTER TABLE `articulos` ADD `familia_id` integer REFERENCES familias(id);--> statement-breakpoint
ALTER TABLE `articulos` ADD `proveedor_habitual_id` integer REFERENCES proveedores(id);--> statement-breakpoint
ALTER TABLE `articulos` ADD `alicuota_iva` real DEFAULT 21 NOT NULL;--> statement-breakpoint
ALTER TABLE `articulos` ADD `por_peso` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `articulos` ADD `notas` text;--> statement-breakpoint
CREATE INDEX `ix_articulos_familia` ON `articulos` (`familia_id`);--> statement-breakpoint
CREATE INDEX `ix_articulos_proveedor` ON `articulos` (`proveedor_habitual_id`);--> statement-breakpoint
CREATE INDEX `ix_articulos_codigo_barras` ON `articulos` (`codigo_barras`);