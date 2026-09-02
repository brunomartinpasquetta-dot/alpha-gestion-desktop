--> El CHECK de documento_tipo no aceptaba 'cheque'. Ahora un cheque rechazado
--> o endosado asienta en la cuenta corriente, y ese asiento tiene que poder
--> decir de que documento viene. SQLite no altera un CHECK: hay que recrear.
--> Se escribe a mano y NO con drizzle-kit: el SELECT que genera drizzle copia
--> las columnas del schema NUEVO desde la tabla VIEJA y rompe.
PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `cuentas_corrientes_nueva` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entidad_tipo` text NOT NULL,
	`entidad_id` integer NOT NULL,
	`tipo_movimiento` text NOT NULL,
	`monto` integer NOT NULL,
	`documento_tipo` text NOT NULL,
	`documento_id` integer,
	`fecha` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`notas` text,
	CONSTRAINT "ck_cuentas_corrientes_entidad_tipo" CHECK(`entidad_tipo` IN ('cliente','proveedor')),
	CONSTRAINT "ck_cuentas_corrientes_tipo_movimiento" CHECK(`tipo_movimiento` IN ('debe','haber')),
	CONSTRAINT "ck_cuentas_corrientes_documento_tipo" CHECK(`documento_tipo` IN ('venta','compra','cobro','pago','cheque')),
	CONSTRAINT "ck_cuentas_corrientes_monto" CHECK(`monto` >= 0)
);
--> statement-breakpoint
INSERT INTO `cuentas_corrientes_nueva` (`id`, `entidad_tipo`, `entidad_id`, `tipo_movimiento`, `monto`, `documento_tipo`, `documento_id`, `fecha`, `notas`)
SELECT `id`, `entidad_tipo`, `entidad_id`, `tipo_movimiento`, `monto`, `documento_tipo`, `documento_id`, `fecha`, `notas` FROM `cuentas_corrientes`;
--> statement-breakpoint
DROP TABLE `cuentas_corrientes`;
--> statement-breakpoint
ALTER TABLE `cuentas_corrientes_nueva` RENAME TO `cuentas_corrientes`;
--> statement-breakpoint
CREATE INDEX `ix_cuentas_corrientes_entidad_fecha` ON `cuentas_corrientes` (`entidad_tipo`,`entidad_id`,`fecha`);
--> statement-breakpoint
CREATE INDEX `ix_cuentas_corrientes_documento` ON `cuentas_corrientes` (`documento_tipo`,`documento_id`);
--> statement-breakpoint
PRAGMA foreign_keys=ON;
