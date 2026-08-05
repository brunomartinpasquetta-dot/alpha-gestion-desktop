/**
 * Entrada CLI del seed de datos de prueba (`npm run db:seed`).
 *
 * NO se ejecuta al arrancar la app: se corre a mano cuando se quiere poblar una
 * instalacion nueva o de demo. Aplica las migraciones primero, asi funciona
 * contra una base que todavia no existe, sin pasos previos.
 *
 * Es idempotente: correrlo dos veces no duplica nada ni falla.
 */

import { cerrarDb, obtenerDb, obtenerRutaDb } from '../server/db/conexion';
import { aplicarMigraciones } from '../server/db/migraciones';
import { CONTRASENA_ADMIN_PRUEBA, USUARIO_ADMIN, VARIABLE_ENTORNO_MOVIMIENTOS } from './datos';
import { demoHabilitado, sembrarDemo, VARIABLE_ENTORNO_DEMO, type ResumenDemo } from './demo';
import { sembrar, type ContadorSeed, type ResumenSeed } from './sembrar';

/** Etiquetas legibles para cada contador del resumen, en orden de impresion. */
const ETIQUETAS: ReadonlyArray<readonly [keyof ResumenSeed, string]> = [
  ['unidades', 'Unidades de medida'],
  ['articulos', 'Articulos'],
  ['recetas', 'Recetas'],
  ['recetaItems', 'Items de receta'],
  ['proveedores', 'Proveedores'],
  ['listasPrecio', 'Listas de precio'],
  ['clientes', 'Clientes'],
  ['precios', 'Precios'],
  ['usuarios', 'Usuarios'],
  ['movimientosStock', 'Movimientos de stock'],
];

function esContador(valor: ResumenSeed[keyof ResumenSeed]): valor is ContadorSeed {
  return typeof valor === 'object' && valor !== null;
}

function describirContador(contador: ContadorSeed): string {
  if (contador.creadas === 0 && contador.existentes === 0) return 'sin datos';
  const partes: string[] = [];
  if (contador.creadas > 0) partes.push(`${contador.creadas} creada(s)`);
  if (contador.existentes > 0) partes.push(`${contador.existentes} ya existente(s)`);
  return partes.join(', ');
}

function imprimirResumen(resumen: ResumenSeed): void {
  const anchoEtiqueta = Math.max(...ETIQUETAS.map(([, etiqueta]) => etiqueta.length));

  console.log('');
  console.log('Resumen del sembrado');
  console.log('--------------------');

  let totalCreadas = 0;
  let totalExistentes = 0;

  for (const [clave, etiqueta] of ETIQUETAS) {
    const contador = resumen[clave];
    if (!esContador(contador)) continue;

    totalCreadas += contador.creadas;
    totalExistentes += contador.existentes;
    console.log(`  ${etiqueta.padEnd(anchoEtiqueta)}  ${describirContador(contador)}`);
  }

  console.log('');
  console.log(`  Total: ${totalCreadas} fila(s) creada(s), ${totalExistentes} ya existente(s).`);

  if (!resumen.movimientosHabilitados) {
    console.log('');
    console.log(
      `  El ledger de stock quedo intacto a proposito: el stock se calcula sumando movimientos, no se inventa.`,
    );
    console.log(
      `  Para cargar movimientos de ejemplo, corre el seed con ${VARIABLE_ENTORNO_MOVIMIENTOS}=1.`,
    );
  }
}

/** Etiquetas del bloque de demostracion, en orden de impresion. */
const ETIQUETAS_DEMO: ReadonlyArray<readonly [keyof ResumenDemo, string]> = [
  ['proveedores', 'Proveedores'],
  ['clientes', 'Clientes'],
  ['listasPrecio', 'Listas de precio'],
  ['articulos', 'Articulos'],
  ['recetas', 'Recetas'],
  ['compras', 'Compras'],
  ['ordenes', 'Ordenes de produccion'],
  ['ventas', 'Ventas'],
  ['pedidos', 'Pedidos'],
  ['cajas', 'Cajas'],
  ['movimientosStock', 'Movimientos de stock'],
  ['movimientosCc', 'Movimientos de cuenta corriente'],
];

function imprimirResumenDemo(resumen: ResumenDemo): void {
  console.log('');
  console.log('Datos de demostracion');
  console.log('---------------------');

  if (resumen.yaExistia) {
    console.log('  Ya estaban sembrados: no se toco nada.');
    return;
  }

  const ancho = Math.max(...ETIQUETAS_DEMO.map(([, etiqueta]) => etiqueta.length));
  for (const [clave, etiqueta] of ETIQUETAS_DEMO) {
    const valor = resumen[clave];
    if (typeof valor !== 'number') continue;
    console.log(`  ${etiqueta.padEnd(ancho)}  ${valor} creada(s)`);
  }
}

function imprimirAvisoCredencial(): void {
  console.log('');
  console.log('*****************************************************************');
  console.log('  ATENCION: CREDENCIAL DE PRUEBA');
  console.log(`  Usuario: ${USUARIO_ADMIN.username}    Contrasena: ${CONTRASENA_ADMIN_PRUEBA}`);
  console.log('  Esta contrasena es publica (esta en el codigo fuente).');
  console.log('  CAMBIALA ANTES DE USAR EL SISTEMA EN PRODUCCION.');
  console.log('*****************************************************************');
}

function principal(): void {
  try {
    console.log('Seed de datos de prueba del ERP de alfajores');
    console.log('Aplicando migraciones pendientes...');

    const migracion = aplicarMigraciones();
    console.log(`  Base de datos: ${migracion.rutaDb}`);
    console.log(`  Migraciones:   ${migracion.carpetaMigraciones}`);

    console.log('Sembrando datos...');
    const resumen = sembrar();

    imprimirResumen(resumen);

    if (demoHabilitado()) {
      console.log('');
      console.log('Sembrando datos de demostracion...');
      imprimirResumenDemo(sembrarDemo(obtenerDb()));
    } else {
      console.log('');
      console.log(
        `  Para llenar los modulos con un negocio en marcha (compras, produccion, ventas,`,
      );
      console.log(`  pedidos, caja y cuentas corrientes), corre el seed con ${VARIABLE_ENTORNO_DEMO}=1.`);
    }

    imprimirAvisoCredencial();

    console.log('');
    console.log(`Listo. Base de datos: ${obtenerRutaDb()}`);
    console.log('El seed es idempotente: podes volver a correrlo sin duplicar nada.');
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    console.error('');
    console.error('El seed fallo y no se aplico ningun cambio (todo corre en una transaccion).');
    console.error(`  Motivo: ${mensaje}`);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    cerrarDb();
  }
}

principal();
