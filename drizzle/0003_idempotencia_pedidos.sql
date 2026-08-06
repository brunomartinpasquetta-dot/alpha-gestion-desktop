ALTER TABLE `pedidos` ADD `clave_idempotencia` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pedidos_clave_idempotencia` ON `pedidos` (`clave_idempotencia`);