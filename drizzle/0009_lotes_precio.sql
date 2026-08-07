CREATE TABLE `lotes_precio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`descripcion` text NOT NULL,
	`cantidad_articulos` integer DEFAULT 0 NOT NULL,
	`revertido` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `precios` ADD `lote_id` integer REFERENCES lotes_precio(id);--> statement-breakpoint
CREATE INDEX `ix_precios_lote` ON `precios` (`lote_id`);