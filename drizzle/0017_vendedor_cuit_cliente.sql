ALTER TABLE `vendedores` ADD `cuit` text;--> statement-breakpoint
ALTER TABLE `vendedores` ADD `cliente_id` integer REFERENCES clientes(id);