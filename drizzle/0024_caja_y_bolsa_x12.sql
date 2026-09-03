-- Datos, no esquema: renombra las presentaciones "Docena ..." a "Caja x12 ..."
-- y agrega las "Bolsa x12" en bases que ya existian antes del cambio de seed
-- (la fabrica Anyulin). Idempotente: sobre una base que ya tiene todo, no toca nada.
-- Los articulos se buscan por codigo; si alguno no existe, ese INSERT no inserta filas.
UPDATE presentaciones SET nombre = 'Caja x12 ' || substr(nombre, 8) WHERE nombre LIKE 'Docena %';--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 ALF DdL-BLANCO', 'BOL12-ALF-B', 0, 1, 40
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-ALF-B')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-B')) = 1;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 ALF DdL-NEGRO', 'BOL12-ALF-N', 0, 1, 41
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-ALF-N')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-N')) = 1;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 ALF FRUTILLA-BLANCO', 'BOL12-ALF-FB', 0, 1, 42
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-ALF-FB')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-FB')) = 1;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 ALF FRUTILLA-NEGRO', 'BOL12-ALF-FN', 0, 1, 43
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-ALF-FN')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-FN')) = 1;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 surtida B-N-FB', 'BOL12-BNFB', 0, 1, 53
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-BNFB')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-B', 'ALF-N', 'ALF-FB')) = 3;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 surtida B-N-FN', 'BOL12-BNFN', 0, 1, 58
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-BNFN')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-B', 'ALF-N', 'ALF-FN')) = 3;--> statement-breakpoint
INSERT INTO presentaciones (nombre, codigo, precio_propio, activo, orden)
SELECT 'Bolsa x12 surtida FN-FB', 'BOL12-FNFB', 0, 1, 68
WHERE NOT EXISTS (SELECT 1 FROM presentaciones WHERE codigo = 'BOL12-FNFB')
  AND (SELECT COUNT(*) FROM articulos WHERE codigo IN ('ALF-FB', 'ALF-FN')) = 2;--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 12 FROM presentaciones p JOIN articulos a ON a.codigo = 'ALF-B'
WHERE p.codigo = 'BOL12-ALF-B'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 12 FROM presentaciones p JOIN articulos a ON a.codigo = 'ALF-N'
WHERE p.codigo = 'BOL12-ALF-N'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 12 FROM presentaciones p JOIN articulos a ON a.codigo = 'ALF-FB'
WHERE p.codigo = 'BOL12-ALF-FB'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 12 FROM presentaciones p JOIN articulos a ON a.codigo = 'ALF-FN'
WHERE p.codigo = 'BOL12-ALF-FN'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 4 FROM presentaciones p JOIN articulos a ON a.codigo IN ('ALF-B', 'ALF-N', 'ALF-FB')
WHERE p.codigo = 'BOL12-BNFB'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 4 FROM presentaciones p JOIN articulos a ON a.codigo IN ('ALF-B', 'ALF-N', 'ALF-FN')
WHERE p.codigo = 'BOL12-BNFN'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);--> statement-breakpoint
INSERT INTO presentacion_componentes (presentacion_id, articulo_id, unidades)
SELECT p.id, a.id, 6 FROM presentaciones p JOIN articulos a ON a.codigo IN ('ALF-FB', 'ALF-FN')
WHERE p.codigo = 'BOL12-FNFB'
  AND NOT EXISTS (SELECT 1 FROM presentacion_componentes pc WHERE pc.presentacion_id = p.id AND pc.articulo_id = a.id);
