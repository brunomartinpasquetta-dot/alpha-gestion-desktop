CREATE TABLE `pedido_renglones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pedido_id` integer NOT NULL,
	`presentacion_id` integer NOT NULL,
	`cantidad` real NOT NULL,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`presentacion_id`) REFERENCES `presentaciones`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pedido_renglones_cantidad" CHECK("pedido_renglones"."cantidad" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_pedido_renglones_pedido` ON `pedido_renglones` (`pedido_id`);