/**
 * Emptying the target — the one destructive path, against a REAL Postgres.
 *
 * It exists because `ON CONFLICT DO NOTHING` gives idempotence and NOT
 * convergence: a copy over a partially-populated target leaves every
 * already-present row exactly as an earlier run wrote it, so the result is a
 * mixture of two points in time. The production rehearsal proved it on eleven
 * `reputation_rules` rows carrying an earlier attempt's `updated_at`.
 *
 * So this file establishes four things, and each one is the reason a specific
 * mistake cannot be made:
 *
 * 1. **The stale row is real, and the reset is what fixes it.** A row written by
 *    an "earlier run" survives an ordinary re-copy and is replaced after a
 *    reset. Without this the whole flag is a story.
 * 2. **It covers exactly the tables the plans write.** Not the schema, not a
 *    hand-written list — and the applied-migration LEDGER survives, because a
 *    reset that took it would make the next run re-apply every migration.
 * 3. **It cannot happen by accident.** The copy path without the flag destroys
 *    nothing, it is refused outright in the two modes that touch nothing by
 *    contract, and no module of the library can reach it at all.
 * 4. **It proves its own work.** A truncate that left rows behind, or that
 *    disturbed the ledger, refuses rather than reporting success.
 *
 * ## It is deliberately CHEAP, and that is not tidiness
 *
 * Every `runBackfill` pays a full audit of every collection the source holds,
 * and this suite also owns a throwaway database (create + migrate + drop).
 * Measured: with nine copies over the whole fixture set,
 * `utils/__tests__/dbConnection.test.ts` — whose discriminating case drops a
 * database out from under a live pool inside a 20s budget — timed out on the
 * added contention, on two full runs in three; the same suite is green with
 * this file removed. Its budget was already marginal (20.7s for that file even
 * when the whole backfill directory runs alone), so a sixth heavy neighbour is
 * what tips it.
 *
 * Two things follow, and both are properties of the tests rather than
 * concessions. A case that only needs "the target has rows" INSERTS them
 * directly instead of copying. A case that genuinely needs a COPY seeds the
 * smallest source that is still a WHOLE run — which is not the same as the
 * smallest source: a source whose tables declare no foreign key at all is
 * refused by the referential audit's vacuity floor, so `users` rides along to
 * give the graph something real to derive.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import { MIGRATIONS_SCHEMA, MIGRATIONS_TABLE } from '@oxyhq/db/migrate';
import { reputationRules, users } from '../../schema';
import { cleanFixtures, type FixtureSet } from '../backfillFixtures';
import { COLLECTION_PLANS } from '../collectionMap';
import { createMongoTestDatabase, type MongoTestDatabase } from '../mongoTestSource';
import { POSTGRES_NATIVE_TABLES } from '../collectionMap';
import { planTables, tableName } from '../plan';
import {
  assertResetIsAllowed,
  planReset,
  ResetLedgerError,
  ResetNotAllowedError,
  resetTableNames,
  resetToEmpty,
} from '../reset';
import { runBackfill } from '../runner';

jest.setTimeout(300_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

beforeAll(async () => {
  sharedDatabaseUrl = process.env.DATABASE_URL;
  ownDatabaseUrl = await createTestDatabase();
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
  await dropTestDatabase(ownDatabaseUrl);
  process.env.DATABASE_URL = sharedDatabaseUrl;
});

async function seed(fixtures: FixtureSet): Promise<MongoTestDatabase> {
  const mongo = await createMongoTestDatabase();
  for (const [collection, documents] of Object.entries(fixtures)) {
    await mongo.seed(collection, documents);
  }
  return mongo;
}

/**
 * Every message in an error's `cause` chain.
 *
 * The driver wraps a Postgres error in one whose `toString` quotes only the
 * failing statement, so an assertion on the outer message cannot tell one
 * failure of that query from another — the "check that answers a narrower
 * question" shape.
 */
function errorChain(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join(' | ');
}

async function ledgerRows(): Promise<number> {
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}`
  );
  return row?.count ?? 0;
}

/** A few rows of the target, inserted directly — no copy, because none is needed. */
async function insertUsers(count: number): Promise<void> {
  await db.insert(users).values(
    Array.from({ length: count }, (_unused, index) => ({
      id: `68b000000000000000000${index.toString().padStart(3, '0')}`,
      username: `resident${index}`,
      email: `resident${index}@example.com`,
    }))
  );
}

/** Empty the target between cases, without going through the code under test. */
async function truncateAll(): Promise<void> {
  await db.execute(
    sql.raw(
      `truncate table ${resetTableNames(COLLECTION_PLANS)
        .map((name) => `"${name}"`)
        .join(', ')}`
    )
  );
}

// ---------------------------------------------------------------------------
// 1. the gap it closes
// ---------------------------------------------------------------------------

describe('a row from an earlier run', () => {
  it('SURVIVES an ordinary re-copy, and is replaced after a reset', async () => {
    // `reputationrules` for the stale row, `users` because a source whose
    // tables declare NO foreign key is refused by the referential audit's own
    // vacuity floor — a clean report from a check with nothing to check is
    // exactly what that floor exists to reject. Two collections, so the run is
    // whole rather than a subset that happens to work.
    const fixtures = cleanFixtures();
    const mongo = await seed({
      users: fixtures.users ?? [],
      reputationrules: fixtures.reputationrules ?? [],
    });
    try {
      await runBackfill({ db, source: mongo.source, batchSize: 5 });

      // An earlier attempt's value, exactly the shape the rehearsal found: the
      // row is present and stale, and the source says something else.
      const stale = new Date('2026-08-01T13:33:35.000Z');
      const [seeded] = await db.select().from(reputationRules).limit(1);
      expect(seeded).toBeDefined();
      if (seeded === undefined) throw new Error('unreachable');
      await db
        .update(reputationRules)
        .set({ updatedAt: stale })
        .where(eq(reputationRules.id, seeded.id));

      // A re-run does not fix it. `ON CONFLICT DO NOTHING` is idempotent — it
      // never duplicates and never fails — but it never REFRESHES either, and
      // that difference is the whole reason the reset exists.
      await runBackfill({ db, source: mongo.source, batchSize: 5 });
      const [afterRerun] = await db
        .select()
        .from(reputationRules)
        .where(eq(reputationRules.id, seeded.id));
      expect(afterRerun?.updatedAt).toEqual(stale);

      // Start from empty, and the same copy converges.
      const plan = await planReset(db, COLLECTION_PLANS);
      await resetToEmpty(db, COLLECTION_PLANS, plan);
      await runBackfill({ db, source: mongo.source, batchSize: 5 });
      const [afterReset] = await db
        .select()
        .from(reputationRules)
        .where(eq(reputationRules.id, seeded.id));
      expect(afterReset).toBeDefined();
      expect(afterReset?.updatedAt).not.toEqual(stale);
      expect(afterReset?.updatedAt).toEqual(seeded.updatedAt);
    } finally {
      await mongo.drop();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. exactly the plans' tables, and the ledger survives
// ---------------------------------------------------------------------------

describe('what a reset covers', () => {
  afterEach(async () => {
    await truncateAll();
  });

  it('is the tables the plans write PLUS the Postgres-native ones, derived rather than listed', () => {
    const covered = resetTableNames(COLLECTION_PLANS);
    const written = new Set<string>();
    for (const plan of COLLECTION_PLANS) {
      for (const table of planTables(plan)) written.add(tableName(table));
    }
    // The native tables are here because they REFERENCE backfilled ones — every
    // `follow_*` table points at `users` — and this truncate deliberately has
    // no `CASCADE`, so a statement naming only the plan tables fails outright.
    // Listing them keeps the property that matters: the statement names
    // everything it touches, and nothing is reached into implicitly.
    for (const entry of POSTGRES_NATIVE_TABLES) written.add(entry.table);
    expect(covered).toEqual([...written].sort());
    // A floor, so a derivation that found nothing cannot pass the equality
    // above by matching an equally empty set.
    expect(covered.length).toBeGreaterThanOrEqual(70);

    // And the ledger is NOT among them — it is the one piece of state whose
    // loss would be invisible until the next run re-applied every migration.
    expect(covered).not.toContain(MIGRATIONS_TABLE);
  });

  it('empties the data and leaves the migration ledger untouched', async () => {
    await insertUsers(3);
    const before = await ledgerRows();
    // Precondition: there IS a ledger to lose. Asserting "unchanged" against
    // zero rows would pass against a reset that dropped the whole schema.
    expect(before).toBeGreaterThan(0);

    const plan = await planReset(db, COLLECTION_PLANS);
    expect(plan.ledgerRows).toBe(before);
    await resetToEmpty(db, COLLECTION_PLANS, plan);

    expect(await ledgerRows()).toBe(before);
    // …and the data really did go, so this is not passing because nothing ran.
    expect(await db.select().from(users)).toEqual([]);
  });

  it('counts what it will destroy BEFORE destroying it', async () => {
    await insertUsers(4);

    const plan = await planReset(db, COLLECTION_PLANS);
    // The census is the number an operator authorises, so it has to be real:
    // exact counts, and the rows still there when it is read.
    const usersCensus = plan.tables.find((entry) => entry.table === 'users');
    expect(usersCensus?.rows).toBe(4);
    expect(plan.totalRows).toBe(4);
    expect(plan.tables.length).toBe(resetTableNames(COLLECTION_PLANS).length);

    // Reading the plan destroyed nothing.
    expect((await db.select().from(users)).length).toBe(4);
  });

  it('cannot reach outside its own list — no CASCADE, so Postgres refuses', async () => {
    await insertUsers(2);

    // A reset told to cover only SOME plans would have to cascade into the
    // tables referencing them, and it deliberately cannot: the truncate carries
    // no CASCADE, so Postgres refuses and NAMES the table that would have been
    // swept up. Reaching into data nobody listed is the silent over-reach this
    // flag must never be.
    const partial = COLLECTION_PLANS.filter((plan) => plan.collection === 'users');
    const plan = await planReset(db, COLLECTION_PLANS);
    let caught: unknown;
    try {
      await resetToEmpty(db, partial, plan);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    // Postgres's own words, reached through the driver's wrapper — the
    // wrapper's `toString` quotes only the statement, so asserting on that
    // would pass for ANY failure of this query and prove nothing about WHY.
    expect(errorChain(caught)).toContain('foreign key constraint');

    // …and nothing was destroyed by the attempt.
    expect((await db.select().from(users)).length).toBe(2);
  });

  it('refuses when the ledger moved under it', async () => {
    await insertUsers(1);
    const plan = await planReset(db, COLLECTION_PLANS);
    // A census that disagrees with the database is exactly what a reset
    // reaching the ledger would look like from here, and it must refuse rather
    // than report success.
    await expect(
      resetToEmpty(db, COLLECTION_PLANS, { ...plan, ledgerRows: plan.ledgerRows + 1 })
    ).rejects.toBeInstanceOf(ResetLedgerError);
  });
});

// ---------------------------------------------------------------------------
// 3. it cannot happen by accident
// ---------------------------------------------------------------------------

describe('the copy path never destroys anything on its own', () => {
  it('refuses --start-from-empty in the two modes that touch nothing', () => {
    // The contract those modes rest on is that it holds without reading the
    // code, so combining them with the one destructive flag is refused rather
    // than resolved into a precedence.
    expect(() => {
      assertResetIsAllowed({ startFromEmpty: true, auditOnly: true, verifyOnly: false });
    }).toThrow(ResetNotAllowedError);
    expect(() => {
      assertResetIsAllowed({ startFromEmpty: true, auditOnly: false, verifyOnly: true });
    }).toThrow(/--verify-only/);

    // …and it is not a blanket refusal: the ordinary copy path is allowed, and
    // so is every read-only mode WITHOUT the flag. A guard that refused
    // everything would pass the two assertions above and be useless.
    expect(() => {
      assertResetIsAllowed({ startFromEmpty: true, auditOnly: false, verifyOnly: false });
    }).not.toThrow();
    expect(() => {
      assertResetIsAllowed({ startFromEmpty: false, auditOnly: true, verifyOnly: true });
    }).not.toThrow();
  });

  it('is reachable only from the CLI, never as a side effect of a copy', () => {
    // The reset is operator-initiated by construction: no module of the
    // backfill library calls it, so no code path can empty the target while
    // doing something else. Checked by walking the directory rather than
    // asserted in prose, and the full matched line is what a failure prints.
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(path);
          continue;
        }
        if (!entry.name.endsWith('.ts') || entry.name === 'reset.ts') continue;
        scanned += 1;
        for (const line of readFileSync(path, 'utf8').split('\n')) {
          if (/resetToEmpty\s*\(/.test(line)) offenders.push(`${path}: ${line.trim()}`);
        }
      }
    };
    walk(root);

    // Vacuity floor: a traversal that found nothing would pass silently.
    expect(scanned).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
    // …and the pattern does match somewhere, so this is not green because it
    // matches nothing anywhere.
    expect(readFileSync(join(root, 'reset.ts'), 'utf8')).toContain(
      'export async function resetToEmpty'
    );
  });

  it('leaves an unrelated row alone across a full run', async () => {
    // `users` alone: its foreign keys are to itself, which the copy defers to a
    // second pass — so the relation graph is non-empty and the run is complete.
    const mongo = await seed({ users: cleanFixtures().users ?? [] });
    try {
      // A row no plan produces — what an earlier attempt's leftovers look like.
      // The ordinary path must not touch it: `runBackfill` inserts, and that is
      // all it does. This is the assertion a "reset unconditionally" mutation
      // breaks.
      await db.insert(users).values({
        id: '68b0000000000000000000a1',
        username: 'survivor',
        email: 'survivor@example.com',
      });

      await runBackfill({ db, source: mongo.source, batchSize: 5 });

      const [row] = await db
        .select()
        .from(users)
        .where(eq(users.id, '68b0000000000000000000a1'));
      expect(row?.username).toBe('survivor');
    } finally {
      await mongo.drop();
    }
  });
});
