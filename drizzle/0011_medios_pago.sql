CREATE TABLE `medios_pago` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nombre` text NOT NULL,
	`tipo` text NOT NULL,
	`es_efectivo_fisico` integer DEFAULT false NOT NULL,
	`comision_pct` real DEFAULT 0 NOT NULL,
	`activo` integer DEFAULT true NOT NULL,
	`orden` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ck_medios_pago_tipo" CHECK("medios_pago"."tipo" IN ('efectivo','transferencia','tarjeta_debito','tarjeta_credito','cheque','otro')),
	CONSTRAINT "ck_medios_pago_comision" CHECK("medios_pago"."comision_pct" >= 0 AND "medios_pago"."comision_pct" <= 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_medios_pago_nombre` ON `medios_pago` (`nombre`);--> statement-breakpoint
CREATE TABLE `venta_pagos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`venta_id` integer NOT NULL,
	`medio_pago_id` integer NOT NULL,
	`importe` integer NOT NULL,
	`referencia` text,
	`comision_pct` real DEFAULT 0 NOT NULL,
	`comision_importe` integer DEFAULT 0 NOT NULL,
	`neto_importe` integer DEFAULT 0 NOT NULL,
	`cheque_id` integer,
	FOREIGN KEY (`venta_id`) REFERENCES `ventas`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`medio_pago_id`) REFERENCES `medios_pago`(`id`) ON UPDATE cascade ON DELETE restrict,
	FOREIGN KEY (`cheque_id`) REFERENCES `cheques`(`id`) ON UPDATE cascade ON DELETE set null,
	CONSTRAINT "ck_venta_pagos_importe" CHECK("venta_pagos"."importe" > 0)
);
--> statement-breakpoint
CREATE INDEX `ix_venta_pagos_venta` ON `venta_pagos` (`venta_id`);--> statement-breakpoint
ALTER TABLE `caja_movimientos` ADD `medio_pago_id` integer REFERENCES medios_pago(id);--> statement-breakpoint
INSERT INTO `medios_pago` (`nombre`, `tipo`, `es_efectivo_fisico`, `comision_pct`, `activo`, `orden`) VALUES
  ('Efectivo', 'efectivo', 1, 0, 1, 1),
  ('Transferencia', 'transferencia', 0, 0, 1, 2),
  ('Tarjeta de Credito', 'tarjeta_credito', 0, 0, 1, 3),
  ('Tarjeta de Debito', 'tarjeta_debito', 0, 0, 1, 4),
  ('Cheque', 'cheque', 0, 0, 1, 5);
