/**
 * Apply the SQL migrations in `drizzle/` to `DATABASE_URL`.
 *
 * This is the ONE migration mechanism in this package. `bun run db:migrate`
 * runs it, the jest harness (`src/db/testDatabase.ts`) shells out to that same
 * script, CI runs the same script, and production runs its COMPILED form
 * (`dist/db/migrate.js`) as a one-shot ECS task — twice per deploy at most, on
 * either side of the rollout (`.github/scripts/deploy-ecs-image.sh`), plus the
 * manual escape hatch (`.github/workflows/run-postgres-migrations.yml`).
 * Nothing applies a migration by any other route.
 *
 * `--phase` IS REQUIRED, and says which side of a deployment this run stands
 * on. `src/db/migrationPhases.ts` explains the marker each migration carries
 * and the incident that put it there; the short version:
 *
 *   --phase=pre    the PREVIOUS image is still serving. Applies additive
 *                  migrations only, and stops at the first destructive one.
 *   --phase=post   the NEW image is live. Applies what `pre` deferred.
 *   --phase=all    nothing to protect — a developer's database, the jest
 *                  harness, the manual dispatch. Applies everything pending.
 *
 * There is no default. A run that does not say which side it is on would have
 * to guess, and guessing "pre" silently strands a drop while guessing "all"
 * silently runs one against a live previous image.
 *
 * WHY NOT `drizzle-kit migrate`
 *
 * drizzle-kit is a CLI that cannot reach production. `Dockerfile` builds the
 * runtime image with `bun install --production`, and that flag is exactly what
 * keeps `esbuild` OUT of the shipped image — `esbuild`'s arm64/alpine
 * postinstall is a known hard failure for this image (PR #261).
 * `drizzle-kit@0.31.10` declares `esbuild: ^0.25.4` as a direct dependency, so
 * promoting drizzle-kit to `dependencies` to make migrations reachable would
 * drag esbuild straight back in. A separate migration image would sidestep
 * that, but then migrations would be applied by different bytes than the
 * service runs.
 *
 * `drizzle-orm` — already a runtime dependency — ships the migrator itself. So
 * the migrator compiles into the SAME image the service runs, adds no
 * dependency at all, and the one-shot ECS task can reuse the LIVE task
 * definition with only `command` overridden (the pattern
 * `.github/workflows/run-user-text-backfill.yml` established).
 *
 * drizzle-kit stays a devDependency for `db:generate`, which only ever runs on
 * a developer's machine and never opens a database.
 *
 * BOTH TOOLS SHARE ONE LEDGER. `drizzle-kit migrate` and `drizzle-orm`'s
 * `migrate()` read the same `meta/_journal.json`, write the same
 * `drizzle.__drizzle_migrations` rows, and apply the same "everything newer
 * than the newest recorded `created_at`" rule — so a database migrated by
 * either is understood by the other.
 *
 * ONE MIGRATOR AT A TIME. drizzle's migrator takes no lock of any kind: it
 * reads the newest ledger row OUTSIDE its transaction, then opens one and
 * replays everything newer. Two of them against one database both read the same
 * high-water mark and both replay the same DDL, so the loser fails on an
 * already-applied statement — after the winner has committed, and with a
 * duplicate ledger row left behind. Verified against a real Postgres 17. This
 * matters more now than it used to: a deploy runs the migrator on its own, so a
 * deploy and a manual dispatch can overlap, and their two workflows sit in
 * different GitHub concurrency groups and cannot see each other. Hence the
 * session advisory lock below, which is the only interlock both paths share.
 *
 * DRY RUN. `DRY_RUN=true` reports what this phase WOULD apply and writes
 * nothing — not even the ledger table.
 */

import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { ConfigurationError } from '../config/env';
import { ensureExtensions } from './extensions';
import { logger } from '../utils/logger';
import {
  MIGRATIONS_FOLDER,
  MIGRATIONS_SCHEMA,
  MIGRATIONS_TABLE,
  materializeJournalPrefix,
  pendingEntries,
  readJournal,
  readLastAppliedMillis,
} from './migrationLedger';
import {
  MIGRATION_RUNS,
  type MigrationRun,
  planMigrationRun,
  readMigrationPhases,
} from './migrationPhases';

/** Seconds to wait for in-flight queries before forcing the socket shut. */
const CLOSE_TIMEOUT_SECONDS = 5;

/**
 * The advisory-lock namespace. Hashed into a key rather than written as a magic
 * number so the value cannot be mistyped and the string says what it protects.
 */
const MIGRATION_LOCK_NAMESPACE = 'oxy-api:drizzle-migrations';

/**
 * How long to wait for another migrator to finish before giving up. A deploy's
 * pre-rollout task and a manual dispatch legitimately overlap; a real migration
 * against this database takes seconds, so a wait this long means the other
 * holder is stuck rather than busy, and failing is better than a one-shot task
 * that never stops.
 */
const LOCK_WAIT_MS = 10 * 60 * 1000;

/** How often to retry the lock while waiting. */
const LOCK_POLL_MS = 2_000;

/** Whether `DRY_RUN` asks for a report instead of an apply. */
function isDryRun(): boolean {
  const value = (process.env.DRY_RUN ?? '').trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

/** The `--phase=<run>` argument. */
function readRun(argv: readonly string[]): MigrationRun {
  const flags = argv.filter((argument) => argument.startsWith('--phase='));

  if (flags.length === 0) {
    throw new ConfigurationError(
      `--phase is required. Use one of: ${MIGRATION_RUNS.map((run) => `--phase=${run}`).join(', ')}. ` +
      'See the header of src/db/migrate.ts for which one a given caller wants; ' +
      '`--phase=all` is the right answer for a developer database or a manual dispatch.'
    );
  }
  if (flags.length > 1) {
    throw new ConfigurationError(`--phase was given ${flags.length} times: ${flags.join(' ')}.`);
  }

  const value = flags[0].slice('--phase='.length);
  if (!(MIGRATION_RUNS as readonly string[]).includes(value)) {
    throw new ConfigurationError(
      `Unrecognised --phase=${value}. Use one of: ${MIGRATION_RUNS.join(', ')}.`
    );
  }
  return value as MigrationRun;
}

/** A stable signed 64-bit advisory-lock key for `name`. */
function advisoryLockKey(name: string): bigint {
  return createHash('sha256').update(name).digest().readBigInt64BE(0);
}

/**
 * Hold the migration advisory lock for the life of `client`'s session.
 *
 * The lock lives on its OWN connection, not on the pool drizzle migrates
 * through: a session-level advisory lock belongs to the connection that took
 * it, so sharing one with the migrator would silently drop the lock if
 * postgres.js ever reconnected mid-run. Released when the session ends, which
 * `main`'s `finally` guarantees even when the process is killed.
 */
async function acquireMigrationLock(client: postgres.Sql): Promise<void> {
  const key = advisoryLockKey(MIGRATION_LOCK_NAMESPACE).toString();
  const deadline = Date.now() + LOCK_WAIT_MS;
  let waited = false;

  for (;;) {
    const [row] = await client<{ locked: boolean }[]>`
      select pg_try_advisory_lock(${key}::bigint) as locked
    `;
    if (row?.locked) {
      if (waited) logger.info('Acquired the migration lock');
      return;
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `Another migration has held the ${MIGRATION_LOCK_NAMESPACE} advisory lock for ` +
        `${Math.round(LOCK_WAIT_MS / 1000)}s. Refusing to migrate alongside it: drizzle's ` +
        'migrator takes no lock of its own, so two concurrent runs replay the same DDL. ' +
        'Find the other run before retrying.'
      );
    }

    if (!waited) {
      waited = true;
      logger.warn('Another migration holds the migration lock; waiting', {
        waitSeconds: Math.round(LOCK_WAIT_MS / 1000),
      });
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
  }
}

async function main(): Promise<void> {
  // Argument validation first, and before DATABASE_URL: it is the cheapest and
  // most local failure, and it lets the deploy workflow prove an image
  // understands `--phase` without handing it a database
  // (`run-postgres-migrations.yml`, "Assert the image can actually migrate").
  const run = readRun(process.argv.slice(2));

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ConfigurationError(
      'DATABASE_URL is not set. See packages/api/.env.example, or start a local ' +
      'Postgres with: docker compose -f docker-compose.dev.yml up -d postgres'
    );
  }

  const entries = readJournal();
  const dryRun = isDryRun();

  const { phases, problems } = readMigrationPhases(
    entries.map((entry) => entry.tag),
    MIGRATIONS_FOLDER
  );
  if (problems.length > 0) {
    throw new ConfigurationError(
      `${problems.length} migration(s) do not declare which side of a deploy they belong on:\n` +
      problems.map((problem) => `  - ${problem}`).join('\n')
    );
  }

  // The lock's own connection. Taken before anything is read, so the pending
  // calculation below cannot be invalidated by another migrator between the
  // read and the apply.
  const lockClient = postgres(url, { max: 1 });
  // `max: 1` — migrations are one serial stream of DDL; a pool would buy
  // nothing and would let statements interleave across connections.
  const client = postgres(url, {
    max: 1,
    onnotice: (notice) => logger.debug('Postgres notice', { notice: notice.message }),
  });
  let prefixFolder: string | null = null;

  try {
    await acquireMigrationLock(lockClient);

    const pending = pendingEntries(entries, await readLastAppliedMillis(client));
    const plan = planMigrationRun(pending, phases, run);

    if (plan.blocked) {
      throw new Error(plan.blocked);
    }

    if (plan.deferred.length > 0) {
      logger.info(
        `Leaving ${plan.deferred.length} migration(s) for a later phase`,
        { phase: run, deferred: plan.deferred.map((entry) => entry.tag) }
      );
    }

    if (plan.apply.length === 0) {
      logger.info('No migrations to apply', {
        phase: run,
        journalEntries: entries.length,
        pending: pending.map((entry) => entry.tag),
      });
      return;
    }

    const tags = plan.apply.map((entry) => entry.tag);

    if (dryRun) {
      logger.info(
        `DRY RUN — ${plan.apply.length} migration(s) would be applied; nothing was written`,
        { phase: run, pending: tags, journalEntries: entries.length }
      );
      return;
    }

    // Extensions first, and inside this script rather than chained in the
    // `db:migrate` npm script: production applies migrations by running the
    // COMPILED form of this file directly as a one-shot ECS task, so anything
    // chained in package.json would silently not run there. A migration that
    // creates a `geography` column fails at table 39 of 45 without it.
    await ensureExtensions(url);

    logger.info(`Applying ${plan.apply.length} migration(s)`, { phase: run, pending: tags });

    // A phase that stops short points the migrator at a folder ending where it
    // stops; a phase applying everything pending uses the real one, so the
    // common path is byte for byte what it always was.
    let migrationsFolder = MIGRATIONS_FOLDER;
    if (plan.deferred.length > 0) {
      const last = plan.apply[plan.apply.length - 1];
      prefixFolder = materializeJournalPrefix(
        entries.findIndex((entry) => entry.tag === last.tag) + 1,
        MIGRATIONS_FOLDER
      );
      migrationsFolder = prefixFolder;
    }

    // No `schema`/`casing` here on purpose: `migrate()` only executes the raw
    // SQL text of the migration files, so it never builds a query from the
    // schema definitions and the compiled migrator stays independent of them.
    await migrate(drizzle(client), {
      migrationsFolder,
      migrationsSchema: MIGRATIONS_SCHEMA,
      migrationsTable: MIGRATIONS_TABLE,
    });

    // A migrator that reports success while leaving work pending is worse than
    // one that fails, so re-read the ledger rather than trusting the call.
    // Measured against what this PHASE undertook — anything it deliberately
    // deferred is still pending on purpose.
    const stillPending = pendingEntries(entries, await readLastAppliedMillis(client));
    const remaining = plan.apply.filter((entry) =>
      stillPending.some((pendingEntry) => pendingEntry.tag === entry.tag)
    );
    if (remaining.length > 0) {
      throw new Error(
        `Migration reported success but ${remaining.length} migration(s) are still ` +
        `pending: ${remaining.map((entry) => entry.tag).join(', ')}`
      );
    }

    logger.info(`Applied ${plan.apply.length} migration(s)`, { phase: run, applied: tags });
  } finally {
    if (prefixFolder) rmSync(prefixFolder, { recursive: true, force: true });
    await client.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    // Ends the lock's session, which is what releases the advisory lock.
    await lockClient.end({ timeout: CLOSE_TIMEOUT_SECONDS });
  }
}

main().catch((error: unknown) => {
  logger.error('Migration failed', error);
  // Not `process.exit`: the pino transport used in development writes from a
  // worker thread, and exiting here would truncate the very message that says
  // what went wrong. The event loop is already free once the pool is closed.
  process.exitCode = 1;
});
