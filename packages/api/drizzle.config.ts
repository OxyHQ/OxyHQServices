import { defineConfig } from 'drizzle-kit';
import { DATABASE_CASING } from './src/db/casing';

/**
 * drizzle-kit configuration.
 *
 * - `bun run db:generate` diffs `schema` against `out/` and writes a new SQL
 *   migration. It never opens a database.
 * - `bun run db:migrate` applies pending migrations from `out/` to
 *   `DATABASE_URL`. This is the ONLY way migrations are applied anywhere: dev,
 *   CI, and the jest harness all shell out to this same command, so tests
 *   exercise the tool production uses rather than a parallel runner.
 *
 * `casing` decides what the DDL CREATES; the same value passed to `drizzle()` in
 * `src/config/postgres.ts` decides what queries REFERENCE. Both read it from
 * `src/db/casing.ts` so they cannot drift apart.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is required by drizzle-kit. Start a local Postgres with:\n' +
    '  docker compose -f ../../docker-compose.dev.yml up -d postgres\n' +
    'then set DATABASE_URL in packages/api/.env (see .env.example).'
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: DATABASE_CASING,
  strict: true,
  verbose: true,
  dbCredentials: { url },
});
