-- Unidades por caja cerrada (ej: 12 alfajores por caja). Los clientes piden por
-- cajas; el stock y el ledger siguen SIEMPRE en unidad base.
--
-- NOTA: drizzle-kit genero el patron de recrear la tabla (para sumar el CHECK),
-- pero ese patron necesita PRAGMA foreign_keys=OFF, que dentro de la
-- transaccion del migrador es un no-op: el DROP TABLE choca con las FKs de
-- recetas/movimientos/pedidos. Un ALTER ADD COLUMN alcanza y no toca nada
-- existente; la validacion `> 0` la garantiza el servicio.
ALTER TABLE `articulos` ADD COLUMN `unidades_por_caja` integer;--> statement-breakpoint
-- Los productos terminados existentes pasan a comercializarse por caja de 12:
-- es el estandar de la fabrica (alfajores). Las instalaciones ya desplegadas
-- reciben el valor sin reseedear; los articulos nuevos lo definen en el alta.
UPDATE `articulos` SET `unidades_por_caja` = 12 WHERE `tipo` = 'producto_terminado';
