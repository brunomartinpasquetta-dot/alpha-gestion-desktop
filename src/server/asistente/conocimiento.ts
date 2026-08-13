/**
 * Carga en RUNTIME los JSON de conocimiento del asistente (intents + manual).
 *
 * Regla heredada de StockFlow (gotcha kbLoader): los JSON grandes NUNCA se
 * importan estaticamente. Aca ademas tsc no los copiaria a dist, asi que viajan
 * como extraResources (igual que las migraciones de drizzle) y se leen de
 * process.resourcesPath; en desarrollo se leen del fuente.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

function cargarJson(nombre: string): unknown {
  const candidatas = [
    // Empaquetado: electron-builder los deja en resources/conocimiento.
    path.join(process.resourcesPath ?? '', 'conocimiento', nombre),
    // Desarrollo: el fuente, relativo a la raiz del proyecto.
    path.join(process.cwd(), 'src', 'server', 'asistente', 'conocimiento', nombre),
    // Fallback: junto al compilado (por si alguien los copia a dist).
    path.join(__dirname, 'conocimiento', nombre),
  ];
  for (const ruta of candidatas) {
    try {
      return JSON.parse(readFileSync(ruta, 'utf8'));
    } catch {
      // probar la siguiente
    }
  }
  throw new Error(`[asistente] no pude cargar ${nombre} de ninguna ruta conocida`);
}

export const datosIntents: unknown = cargarJson('intents.json');
export const datosManual: unknown = cargarJson('manual.json');
