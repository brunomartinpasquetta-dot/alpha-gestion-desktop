--> Promociones: una presentacion con precio propio + ventana de vigencia.
--> Columnas nuevas con default, asi que ALTER TABLE alcanza y no hay que
--> recrear nada (a diferencia de 0019, que tocaba un CHECK).
ALTER TABLE `presentaciones` ADD `es_promocion` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `presentaciones` ADD `vigencia_desde` text;
--> statement-breakpoint
ALTER TABLE `presentaciones` ADD `vigencia_hasta` text;
