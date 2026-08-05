/**
 * Punto unico de registro de rutas HTTP. Todo endpoint nuevo se engancha aca:
 * asi el bootstrap del servidor no crece cada vez que sumamos un modulo.
 */

import type { FastifyInstance } from 'fastify';

import { registrarRutasArticulos } from './articulos.rutas';
import { registrarRutasCuentasCorrientes } from './cuentas-corrientes.rutas';
import { registrarRutasModulos } from './modulos.rutas';
import { registrarRutasPedidos } from './pedidos.rutas';
import { registrarRutasSalud } from './salud.rutas';

export function registrarRutas(app: FastifyInstance): void {
  registrarRutasSalud(app);
  registrarRutasArticulos(app);
  registrarRutasCuentasCorrientes(app);
  registrarRutasModulos(app);
  registrarRutasPedidos(app);
}

export {
  registrarRutasArticulos,
  registrarRutasCuentasCorrientes,
  registrarRutasModulos,
  registrarRutasSalud,
};
