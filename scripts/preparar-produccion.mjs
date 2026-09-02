/**
 * Deja la base LISTA PARA LA FABRICA.
 *
 * El problema que resuelve: la base de trabajo tiene mezclados los datos REALES
 * de Anyulin (los 51 clientes del Excel, los vendedores, las 37 presentaciones
 * del talonario, los articulos y sus precios) con los de la DEMOSTRACION
 * (pedidos, ventas, cajas, deudas y articulos de ejemplo). "Empezar de cero"
 * no sirve para esto: borra todo, incluido lo real.
 *
 * Esto borra SOLO lo que no debe existir el primer dia:
 *   - Todo lo transaccional: pedidos, ventas, compras, cajas, cuentas
 *     corrientes, cheques, movimientos de stock, ordenes y reservas.
 *   - Los articulos de ejemplo y sus recetas.
 *   - Los proveedores de ejemplo.
 *
 * Y CONSERVA lo que la fabrica necesita desde el minuto uno:
 *   - Clientes, vendedores, listas de precio y precios.
 *   - Presentaciones del talonario con su composicion.
 *   - Articulos reales (alfajores, cubanitos, almendras, envase) y sus insumos.
 *   - Recetas reales, usuarios y medios de pago.
 *
 * Uso:  node scripts/preparar-produccion.mjs [--aplicar]
 * Sin --aplicar solo INFORMA que haria. Siempre deja una copia antes de tocar.
 */

import Database from 'better-sqlite3';
import { copyFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APLICAR = process.argv.includes('--aplicar');

const RUTA_DB =
  process.env.ALFAJORES_DB ??
  path.join(os.homedir(), 'Library', 'Application Support', 'alfajores-erp', 'alfajores.db');

/** Codigos que son de la demostracion y no van a la fabrica. */
const ARTICULOS_DEMO = [
  'PT-ALF-CHO',
  'PT-ALF-MAI',
  'PT-ALF-TRI',
  'MP-CHO-001',
  'MP-COC-001',
  'MP-HAR-0000',
  'MP-LEC-001',
];

/**
 * Tablas transaccionales, en orden de borrado (hijos antes que padres).
 * Nada de esto debe existir el primer dia: son las operaciones de prueba.
 */
const TRANSACCIONAL = [
  'comprobantes',
  'venta_pagos',
  'venta_items',
  'reservas_stock',
  'ventas',
  'compra_items',
  'compras',
  'pedido_renglon_componentes',
  'pedido_renglones',
  'pedido_items',
  'pedidos',
  'produccion_consumos',
  'ordenes_produccion',
  'cuentas_corrientes',
  'caja_movimientos',
  'cajas',
  'caja_general_movimientos',
  'caja_general',
  'cheques',
  'movimientos_stock',
];

if (!existsSync(RUTA_DB)) {
  console.error(`No encuentro la base en ${RUTA_DB}`);
  process.exit(1);
}

const db = new Database(RUTA_DB);
const contar = (tabla) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${tabla}`).get().c;
  } catch {
    return 0;
  }
};

console.log(`Base: ${RUTA_DB}`);
console.log(APLICAR ? '\nMODO APLICAR: se van a borrar datos.\n' : '\nSimulacion (agrega --aplicar para hacerlo de verdad).\n');

/* ------------------------------ Que se borra ------------------------------ */

console.log('SE BORRA (operaciones de prueba):');
let totalBorrado = 0;
for (const tabla of TRANSACCIONAL) {
  const n = contar(tabla);
  if (n > 0) {
    console.log(`  ${tabla.padEnd(28)} ${String(n).padStart(4)}`);
    totalBorrado += n;
  }
}

const idsDemo = ARTICULOS_DEMO.map((codigo) =>
  db.prepare('SELECT id, codigo, nombre FROM articulos WHERE codigo = ?').get(codigo),
).filter(Boolean);

if (idsDemo.length > 0) {
  console.log('\n  articulos de ejemplo:');
  for (const a of idsDemo) console.log(`    ${a.codigo.padEnd(14)} ${a.nombre}`);
}

const proveedoresDemo = db
  .prepare(
    `SELECT id, nombre FROM proveedores
     WHERE nombre IN ('Almacen Mayorista El Puente','Chocolates del Sur SA','Distribuidora La Espiga')`,
  )
  .all();
if (proveedoresDemo.length > 0) {
  console.log('\n  proveedores de ejemplo:');
  for (const p of proveedoresDemo) console.log(`    ${p.nombre}`);
}

/* ----------------------------- Que se conserva ---------------------------- */

console.log('\nSE CONSERVA (lo que la fabrica necesita):');
for (const tabla of [
  'clientes',
  'vendedores',
  'listas_precio',
  'precios',
  'presentaciones',
  'presentacion_componentes',
  'precios_presentacion',
  'usuarios',
  'medios_pago',
  'unidades_medida',
]) {
  console.log(`  ${tabla.padEnd(28)} ${String(contar(tabla)).padStart(4)}`);
}
const articulosQuedan = contar('articulos') - idsDemo.length;
console.log(`  ${'articulos'.padEnd(28)} ${String(articulosQuedan).padStart(4)} (de ${contar('articulos')})`);

if (!APLICAR) {
  console.log(`\nTotal de filas transaccionales a borrar: ${totalBorrado}`);
  console.log('Nada se toco. Corre con --aplicar cuando quieras hacerlo.');
  db.close();
  process.exit(0);
}

/* -------------------------------- Aplicar --------------------------------- */

// Copia antes de tocar nada, con el WAL volcado para que sea consistente.
db.pragma('wal_checkpoint(TRUNCATE)');
const sello = new Date().toISOString().replace(/[:.]/g, '-');
const resguardo = `${RUTA_DB}.antes-de-produccion-${sello}`;
copyFileSync(RUTA_DB, resguardo);
console.log(`\nCopia de seguridad: ${resguardo}`);

db.pragma('foreign_keys = OFF');
const limpiar = db.transaction(() => {
  for (const tabla of TRANSACCIONAL) {
    try {
      db.prepare(`DELETE FROM ${tabla}`).run();
      db.prepare('DELETE FROM sqlite_sequence WHERE name = ?').run(tabla);
    } catch (causa) {
      console.warn(`  aviso: ${tabla} -> ${causa.message}`);
    }
  }

  // Los articulos de ejemplo, con sus recetas: primero lo que los referencia.
  for (const a of idsDemo) {
    for (const receta of db.prepare('SELECT id FROM recetas WHERE articulo_producido_id = ?').all(a.id)) {
      db.prepare('DELETE FROM receta_items WHERE receta_id = ?').run(receta.id);
      db.prepare('DELETE FROM recetas WHERE id = ?').run(receta.id);
    }
    db.prepare('DELETE FROM receta_items WHERE articulo_insumo_id = ?').run(a.id);
    db.prepare('DELETE FROM precios WHERE articulo_id = ?').run(a.id);
    db.prepare('DELETE FROM articulos WHERE id = ?').run(a.id);
  }

  for (const p of proveedoresDemo) {
    db.prepare('UPDATE articulos SET proveedor_habitual_id = NULL WHERE proveedor_habitual_id = ?').run(p.id);
    db.prepare('DELETE FROM proveedores WHERE id = ?').run(p.id);
  }

  // Una receta sin insumos quedo huerfana de la limpieza: no sirve para nada.
  for (const r of db.prepare('SELECT id FROM recetas').all()) {
    const n = db.prepare('SELECT COUNT(*) AS c FROM receta_items WHERE receta_id = ?').get(r.id).c;
    if (n === 0) db.prepare('DELETE FROM recetas WHERE id = ?').run(r.id);
  }
});
limpiar();

const huerfanos = db.pragma('foreign_key_check');
db.pragma('foreign_keys = ON');

console.log('\nRESULTADO:');
console.log(`  integridad: ${db.pragma('integrity_check', { simple: true })}`);
console.log(`  claves foraneas: ${huerfanos.length === 0 ? 'sin violaciones' : `${huerfanos.length} VIOLACIONES`}`);
console.log(`  clientes: ${contar('clientes')} · vendedores: ${contar('vendedores')} · presentaciones: ${contar('presentaciones')}`);
console.log(`  articulos: ${contar('articulos')} · recetas: ${contar('recetas')} · precios: ${contar('precios')}`);
console.log(`  pedidos: ${contar('pedidos')} · ventas: ${contar('ventas')} · movimientos de stock: ${contar('movimientos_stock')}`);

if (huerfanos.length > 0) {
  console.error('\nHay filas huerfanas: restaura la copia y avisa antes de seguir.');
  process.exit(1);
}
console.log('\nBase lista para la fabrica.');
db.close();
