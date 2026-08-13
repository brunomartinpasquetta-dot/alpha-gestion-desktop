CREATE TABLE `pedido_renglon_componentes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`renglon_id` integer NOT NULL,
	`articulo_id` integer NOT NULL,
	`unidades` real NOT NULL,
	FOREIGN KEY (`renglon_id`) REFERENCES `pedido_renglones`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`articulo_id`) REFERENCES `articulos`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pedido_renglon_componentes_unidades" CHECK("pedido_renglon_componentes"."unidades" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_pedido_renglon_componentes_renglon` ON `pedido_renglon_componentes` (`renglon_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pedido_renglones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pedido_id` integer NOT NULL,
	`presentacion_id` integer,
	`descripcion` text,
	`cantidad` real NOT NULL,
	FOREIGN KEY (`pedido_id`) REFERENCES `pedidos`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`presentacion_id`) REFERENCES `presentaciones`(`id`) ON UPDATE cascade ON DELETE restrict,
	CONSTRAINT "ck_pedido_renglones_cantidad" CHECK("__new_pedido_renglones"."cantidad" > 0),
	CONSTRAINT "ck_pedido_renglones_identidad" CHECK("__new_pedido_renglones"."presentacion_id" IS NOT NULL OR "__new_pedido_renglones"."descripcion" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_pedido_renglones`("id", "pedido_id", "presentacion_id", "descripcion", "cantidad") SELECT "id", "pedido_id", "presentacion_id", NULL, "cantidad" FROM `pedido_renglones`;--> statement-breakpoint
DROP TABLE `pedido_renglones`;--> statement-breakpoint
ALTER TABLE `__new_pedido_renglones` RENAME TO `pedido_renglones`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ix_pedido_renglones_pedido` ON `pedido_renglones` (`pedido_id`);