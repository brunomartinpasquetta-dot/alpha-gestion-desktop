CREATE TABLE `vendedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`telefono` text,
	`notas` text,
	`activo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendedores_nombre_unique` ON `vendedores` (`nombre`);--> statement-breakpoint
CREATE INDEX `ix_vendedores_nombre` ON `vendedores` (`nombre`);--> statement-breakpoint
ALTER TABLE `clientes` ADD `vendedor_id` integer REFERENCES vendedores(id);--> statement-breakpoint
ALTER TABLE `pedidos` ADD `vendedor_id` integer REFERENCES vendedores(id);--> statement-breakpoint
ALTER TABLE `pedidos` ADD `lista_precio_id` integer REFERENCES listas_precio(id);