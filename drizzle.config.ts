import { defineConfig } from 'drizzle-kit';

/**
 * Configuracion de drizzle-kit (solo generacion de migraciones).
 * `dbCredentials.url` apunta a una base local de trabajo: la base real vive en
 * userData y la resuelve el runtime, no drizzle-kit.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.ALFAJORES_DB_PATH ?? './.drizzle-local/alfajores.db',
  },
  verbose: true,
  strict: true,
});
