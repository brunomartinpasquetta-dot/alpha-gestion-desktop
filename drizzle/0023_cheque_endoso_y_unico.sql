--> Endoso rastreable y numero unico por tipo.
--> La columna nueva va con ALTER (no recrea nada). El indice unico se crea
--> DESPUES de limpiar los duplicados que pudiera haber, para que no falle en
--> una base que ya los tenga.
ALTER TABLE `cheques` ADD `endosado_a_id` integer;
--> statement-breakpoint
DELETE FROM `cheques` WHERE `id` NOT IN (
  SELECT MIN(`id`) FROM `cheques` GROUP BY `tipo`, `numero`
) AND `id` IN (
  SELECT c.`id` FROM `cheques` c
  JOIN (SELECT `tipo`, `numero` FROM `cheques` GROUP BY `tipo`, `numero` HAVING COUNT(*) > 1) d
    ON c.`tipo` = d.`tipo` AND c.`numero` = d.`numero`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_cheques_tipo_numero` ON `cheques` (`tipo`,`numero`);
