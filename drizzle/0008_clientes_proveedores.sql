ALTER TABLE `clientes` ADD `tipo_documento` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `numero_documento` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `condicion_iva` integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE `clientes` ADD `celular` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `localidad` text;--> statement-breakpoint
ALTER TABLE `clientes` ADD `limite_credito` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `proveedores` ADD `codigo` text;--> statement-breakpoint
ALTER TABLE `proveedores` ADD `iibb` text;--> statement-breakpoint
ALTER TABLE `proveedores` ADD `celular` text;--> statement-breakpoint
ALTER TABLE `proveedores` ADD `localidad` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_proveedores_codigo` ON `proveedores` (`codigo`);