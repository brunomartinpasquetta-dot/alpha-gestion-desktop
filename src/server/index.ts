/**
 * API publico del servidor. El proceso main de Electron (y cualquier script de
 * prueba) importa desde aca y no desde los modulos internos.
 */

export { crearServidor, iniciarServidor } from './servidor';
export type { OpcionesServidor, ServidorEnMarcha } from './servidor';

export { registrarRutas } from './rutas';
export { registrarManejadorErrores } from './plugins/manejador-errores';
export type { CuerpoError, DetalleValidacion } from './plugins/manejador-errores';
export { registrarEstaticos } from './plugins/estaticos';
export type { RespuestaSalud } from '../compartido/contratos';
