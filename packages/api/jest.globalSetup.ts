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

/**
 * Connections one worker's pool may open. Deliberately tiny, and NOT a tuning
 * knob — it is the only thing keeping the run under the server's ceiling.
 *
 * The runtime default is 20, sized for a long-lived API process. Jest forks one
 * worker per core minus one (31 on this machine) and each opens its OWN pool
 * against the same server, so the default asks for up to 620 connections
 * against a `max_connections` of 100.
 *
 * 8 is a FLOOR, not a preference: the backfill copies collections with
 * `DEFAULT_CONCURRENCY = 8`, so a smaller pool starves it against itself.
 * Measured at 2, the three backfill suites did not merely slow down — they ran
 * 67–74s and timed out, consistently, all three. Anything below the copier's
 * own concurrency trades a random flake for a deterministic hang.
 * `maxWorkers` in `jest.config.js` is the other half: 8 × 31 workers is still
 * far past the ceiling, so the two numbers only work together.
 *
 * That does not fail where the fault is. The server refuses whichever worker
 * happens to ask while it is saturated, so a DIFFERENT, entirely innocent suite
 * goes red on each run — measured here across five consecutive runs:
 * `deviceTransfer`, `dbConnection`, `platformStats`, `nodeRegistry`,
 * `reputation.leaderboard`, every one of them passing in isolation. The cost is
 * not the flake itself but that it makes a real regression indistinguishable
 * from noise, which is the state a suite is least useful in.
 *
 * Set BEFORE jest forks, so every worker inherits it; an explicit
 * `PG_MAX_POOL_SIZE` in the environment still wins, for anyone deliberately
 * measuring pool behaviour.
 */
const TEST_MAX_POOL_SIZE = '8';

export default async function globalSetup(): Promise<void> {
  process.env.PG_MAX_POOL_SIZE ??= TEST_MAX_POOL_SIZE;
  await createTestDatabase();
}
