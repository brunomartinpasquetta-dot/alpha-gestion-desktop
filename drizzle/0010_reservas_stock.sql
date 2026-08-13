CREATE TABLE `reservas_stock` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`articulo_id` integer NOT NULL,
	`pedido_id` integer NOT NULL,
	`cliente_id` integer,
	`cantidad` real NOT NULL,
	`origen` text NOT NULL,
	`orden_id` integer,
	`numero_lote` text,
	`estado` text DEFAULT 'activa' NOT NULL,
	`venta_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`notas` text,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`orden_id`) REFERENCES `ordenes_produccion`(`id`) ON UPDATE cascade ON DELETE set null,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_reservas_stock_cantidad" CHECK("reservas_stock"."cantidad" > 0),
	CONSTRAINT "ck_reservas_stock_origen" CHECK("reservas_stock"."origen" IN ('produccion','stock')),
	CONSTRAINT "ck_reservas_stock_estado" CHECK("reservas_stock"."estado" IN ('activa','entregada','liberada'))
);
--> statement-breakpoint
CREATE INDEX `ix_reservas_stock_articulo_estado` ON `reservas_stock` (`articulo_id`,`estado`);--> statement-breakpoint
CREATE INDEX `ix_reservas_stock_pedido` ON `reservas_stock` (`pedido_id`);--> statement-breakpoint
CREATE INDEX `ix_reservas_stock_orden` ON `reservas_stock` (`orden_id`);