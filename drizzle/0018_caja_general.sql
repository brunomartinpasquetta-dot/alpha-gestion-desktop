CREATE TABLE `caja_general` (
	`id` integer PRIMARY KEY NOT NULL,
	`saldo_total` integer DEFAULT 0 NOT NULL,
	`saldo_efectivo` integer DEFAULT 0 NOT NULL,
	`saldo_electronico` integer DEFAULT 0 NOT NULL,
	`actualizado_en` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `caja_general_movimientos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tipo` text NOT NULL,
	`monto` integer NOT NULL,
	`concepto` text NOT NULL,
	`categoria` text,
	`es_efectivo` integer DEFAULT true NOT NULL,
	`saldo_total_despues` integer NOT NULL,
	`saldo_efectivo_despues` integer NOT NULL,
	`saldo_electronico_despues` integer NOT NULL,
	`documento_tipo` text,
	`documento_id` integer,
	`usuario` text,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	CONSTRAINT "ck_caja_general_mov_monto" CHECK("caja_general_movimientos"."monto" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_caja_general_mov_fecha` ON `caja_general_movimientos` (`fecha`);--> statement-breakpoint
CREATE INDEX `ix_caja_general_mov_tipo` ON `caja_general_movimientos` (`tipo`);