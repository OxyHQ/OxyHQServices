/**
 * Jest global setup — Postgres.
 *
 * Creates ONE throwaway, fully-migrated database for the whole run and points
 * `DATABASE_URL` at it. Jest forks its workers after this resolves, so every
 * test file inherits that env var and `connectPostgres()` opens against the
 * throwaway database rather than a developer's real one.
 *
 * This runs for EVERY `bun run test`, so a reachable Postgres is a hard
 * prerequisite of the suite — deliberately, since the alternative (skipping
 * silently when the database is absent) is a check that cannot tell success
 * from failure. Start one with:
 *   docker compose -f docker-compose.dev.yml up -d postgres
 *
 * The Mongo side is untouched: `jest.setup.cjs` still mocks mongoose wholesale.
 */

import { createTestDatabase } from './src/db/testDatabase';

export default async function globalSetup(): Promise<void> {
  await createTestDatabase();
}
