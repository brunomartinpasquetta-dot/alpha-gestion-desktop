CREATE TABLE `comprobantes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`codigo_arca` integer NOT NULL,
	`letra` text NOT NULL,
	`punto_venta` integer NOT NULL,
	`numero` integer NOT NULL,
	`fecha` text NOT NULL,
	`doc_tipo` integer NOT NULL,
	`doc_numero` text NOT NULL,
	`receptor_nombre` text NOT NULL,
	`neto` integer NOT NULL,
	`iva` integer NOT NULL,
	`total` integer NOT NULL,
	`cae` text NOT NULL,
	`cae_vencimiento` text,
	`observaciones` text,
	`url_qr` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE cascade ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_comprobantes_numeracion` ON `comprobantes` (`codigo_arca`,`punto_venta`,`numero`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_comprobantes_venta` ON `comprobantes` (`venta_id`);--> statement-breakpoint
CREATE TABLE `configuracion_fiscal` (
	`id` text PRIMARY KEY NOT NULL,
	`entorno` text DEFAULT 'homologacion' NOT NULL,
	`cuit` text DEFAULT '' NOT NULL,
	`razon_social` text,
	`direccion` text,
	`condicion_iva` text DEFAULT 'RI' NOT NULL,
	`iibb` text,
	`ruta_certificado` text,
	`ruta_clave` text,
	`punto_venta` integer DEFAULT 1 NOT NULL,
	`habilitada` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
