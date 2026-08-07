/**
 * Preparacion de la base para arrancar con los datos reales del cliente.
 *
 * El sistema se instala con datos de demostracion: sirven para mostrarlo y para
 * probar, pero el dia que la fabrica empieza a operar hay que sacarlos, porque
 * un stock inventado y unas ventas de mentira contaminan todos los numeros.
 *
 * Esta operacion BORRA. Por eso, tres recaudos:
 *  1. Hace una copia de la base antes de tocar nada, con fecha en el nombre.
 *  2. Exige que el usuario escriba una confirmacion exacta.
 *  3. Conserva lo que es catalogo y no dato: unidades de medida, usuarios y la
 *     configuracion fiscal, que costo cargar y no tiene nada de demostracion.
 */

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import { sembrarDemo } from '../../seed/demo';
import { obtenerDb, obtenerRutaDb, obtenerSqlite } from '../db/conexion';
import { ErrorReglaNegocio, ErrorValidacion, ejecutarSeguro } from '../dominio/errores';
import { emitir } from '../eventos';

/** El usuario tiene que escribir esto exacto. Sin esto no se borra nada. */
export const CONFIRMACION_REQUERIDA = 'EMPEZAR DE CERO';

/**
 * Orden de borrado: primero lo que referencia, despues lo referenciado. Con las
 * claves foraneas activas, invertir este orden falla — que es justamente la red
 * de seguridad que confirma que no queda nada colgando.
 */
const TABLAS_A_VACIAR: readonly string[] = [
  'comprobantes',
  'venta_items',
  'ventas',
  'compra_items',
  'compras',
  'pedido_items',
  'pedidos',
  'produccion_consumos',
  'ordenes_produccion',
  'receta_items',
  'recetas',
  'movimientos_stock',
  'cuentas_corrientes',
  'caja_movimientos',
  'cajas',
  'cheques',
  'precios',
  'clientes',
  'proveedores',
  'articulos',
];

export interface ResultadoInicializacion {
  rutaCopiaSeguridad: string;
  filasBorradas: number;
  detalle: { tabla: string; filas: number }[];
}

export const inicializacionServicio = {
  /**
   * Llena el sistema con una fabrica de ejemplo: insumos, recetas, productos,
   * clientes, proveedores, precios y un historial de operaciones.
   *
   * Existe como boton y no solo como comando de terminal porque quien tiene que
   * probar el sistema no tiene una terminal a mano, y sin datos no hay nada que
   * mirar: todas las pantallas se ven vacias y no se entiende que hace cada una.
   */
  cargarDemostracion(): { creados: number; detalle: string } {
    return ejecutarSeguro('cargar los datos de demostracion', () => {
      const sqlite = obtenerSqlite();
      const contar = (): number =>
        TABLAS_A_VACIAR.reduce((suma, tabla) => {
          const fila = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number };
          return suma + fila.n;
        }, 0);

      // Se cuenta antes y despues en vez de leer el resumen del seed: asi el
      // numero refleja lo que efectivamente quedo en la base, que es lo que el
      // usuario va a ver en las pantallas.
      const antes = contar();
      sembrarDemo(obtenerDb());
      const creados = contar() - antes;

      emitir('maestros:cambio');
      emitir('ventas:cambio');
      emitir('pedidos:cambio');
      emitir('caja:cambio');
      emitir('cc:cambio');
      emitir('ordenes:cambio');

      return {
        creados,
        detalle: 'Se cargo una fabrica de ejemplo con insumos, recetas, productos, clientes y operaciones.',
      };
    });
  },

  /** Cuantas filas hay hoy en lo que se borraria. Para avisar antes. */
  contarDatosExistentes(): { tabla: string; filas: number }[] {
    const sqlite = obtenerSqlite();
    return TABLAS_A_VACIAR.map((tabla) => {
      const fila = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number };
      return { tabla, filas: fila.n };
    }).filter((t) => t.filas > 0);
  },

  /**
   * Deja la base vacia de datos operativos, conservando el catalogo. Devuelve
   * donde quedo la copia de seguridad por si hubo que volver atras.
   */
  empezarDeCero(confirmacion: string): ResultadoInicializacion {
    if (confirmacion !== CONFIRMACION_REQUERIDA) {
      throw new ErrorValidacion(
        `Para vaciar la base hay que escribir exactamente "${CONFIRMACION_REQUERIDA}".`,
      );
    }

    const rutaDb = obtenerRutaDb();
    const carpetaCopias = path.join(path.dirname(rutaDb), 'copias');
    const marca = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rutaCopia = path.join(carpetaCopias, `alfajores-antes-de-empezar-${marca}.db`);

    return ejecutarSeguro('preparar la base para el arranque', () => {
      const sqlite = obtenerSqlite();

      // La copia va ANTES de tocar nada. Si esto falla, no se borra.
      try {
        mkdirSync(carpetaCopias, { recursive: true });
        // WAL: hay que consolidar el diario o la copia sale incompleta.
        sqlite.pragma('wal_checkpoint(TRUNCATE)');
        copyFileSync(rutaDb, rutaCopia);
      } catch (error) {
        throw new ErrorReglaNegocio(
          'No se pudo hacer la copia de seguridad, asi que no se borro nada. ' +
            `Detalle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!existsSync(rutaCopia)) {
        throw new ErrorReglaNegocio('La copia de seguridad no quedo escrita: no se borro nada.');
      }

      const detalle: { tabla: string; filas: number }[] = [];
      const vaciar = sqlite.transaction(() => {
        for (const tabla of TABLAS_A_VACIAR) {
          const antes = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get() as { n: number };
          if (antes.n > 0) {
            sqlite.prepare(`DELETE FROM ${tabla}`).run();
            detalle.push({ tabla, filas: antes.n });
          }
          // Los contadores autoincrementales vuelven a 1: la primera venta real
          // del cliente tiene que ser la venta #1, no la #47 de la demostracion.
          sqlite.prepare(`DELETE FROM sqlite_sequence WHERE name = ?`).run(tabla);
        }
      });
      vaciar();

      // Recuperar el espacio de lo borrado; la base queda chica de nuevo.
      sqlite.pragma('wal_checkpoint(TRUNCATE)');
      sqlite.exec('VACUUM');

      emitir('maestros:cambio');
      emitir('ventas:cambio');
      emitir('caja:cambio');
      emitir('cc:cambio');

      return {
        rutaCopiaSeguridad: rutaCopia,
        filasBorradas: detalle.reduce((suma, d) => suma + d.filas, 0),
        detalle,
      };
    });
  },
};
