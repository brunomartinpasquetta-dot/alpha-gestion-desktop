CREATE TABLE `cheques` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`formato` text DEFAULT 'fisico' NOT NULL,
	`numero` text NOT NULL,
	`banco` text,
	`cuit_emisor` text,
	`contraparte` text NOT NULL,
	`entidad_tipo` text,
	`entidad_id` integer,
	`importe` integer NOT NULL,
	`fecha_emision` text NOT NULL,
	`fecha_pago` text NOT NULL,
	`estado` text NOT NULL,
	`documento_tipo` text,
	`documento_id` integer,
	`notas` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "ck_cheques_tipo" CHECK("cheques"."tipo" IN ('recibido','emitido')),
	CONSTRAINT "ck_cheques_formato" CHECK("cheques"."formato" IN ('fisico','echeq')),
	CONSTRAINT "ck_cheques_estado" CHECK("cheques"."estado" IN ('en_cartera','depositado','acreditado','rechazado','endosado','entregado','anulado')),
	CONSTRAINT "ck_cheques_importe" CHECK("cheques"."importe" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_cheques_tipo_estado` ON `cheques` (`tipo`,`estado`);--> statement-breakpoint
CREATE INDEX `ix_cheques_fecha_pago` ON `cheques` (`fecha_pago`);--> statement-breakpoint
ALTER TABLE `ordenes_produccion` ADD `numero_lote` text;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_ordenes_produccion_numero_lote` ON `ordenes_produccion` (`numero_lote`);