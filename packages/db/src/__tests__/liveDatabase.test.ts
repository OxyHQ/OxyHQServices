/**
 * Live-Postgres coverage for the ephemeral-database harness itself, and for
 * the four migration-ledger functions Task 5 shipped with NO coverage at
 * all: `assertMigrationTarget`, `readAppliedMillis`, `readLastAppliedMillis`,
 * `assertPostgresMigrationsCurrent`. Each needs a real `postgres.Sql` — a
 * stub would only prove the comparison agrees with itself, the same reasoning
 * `targetDatabase.test.ts` and `extensions.test.ts` already give for leaving
 * them out — and this package had no live-database harness until this task
 * built `createTestDatabase`/`dropTestDatabase`.
 *
 * Skipped entirely when `OXYDB_TEST_ADMIN_URL` is unset: this package's own
 * CI does not yet run a Postgres service (wiring one is a separate task), so
 * a checkout with no server to reach must not fail here. Point it at any
 * Postgres this process may create and drop databases on, e.g.:
 *
 *   OXYDB_TEST_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres \
 *     bun run --filter @oxyhq/db test -- liveDatabase.test.ts
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres from 'postgres';
import { assertPostgresMigrationsCurrent, readAppliedMillis, readLastAppliedMillis, type JournalEntry } from '../migrate/ledger';
import { runMigrations } from '../migrate/runner';
import { WrongMigrationTargetError, assertMigrationTarget } from '../migrate/targetDatabase';
import { createTestDatabase, dropTestDatabase } from '../testing';

const ADMIN_URL = process.env.OXYDB_TEST_ADMIN_URL;
const describeLive = ADMIN_URL ? describe : describe.skip;

const noopLogger = { info: () => {}, debug: () => {} };

/** Two trivial, real migrations — enough to produce genuine ledger rows. */
const FIXTURE_FILES: Array<{ tag: string; when: number; sql: string }> = [
  { tag: '0000_first', when: 1_000, sql: '-- oxy:deploy-phase=pre\nselect 1;\n' },
  { tag: '0001_second', when: 2_000, sql: '-- oxy:deploy-phase=pre\nselect 2;\n' },
];
const FIXTURE_ENTRIES: JournalEntry[] = FIXTURE_FILES.map(({ tag, when }) => ({ tag, when }));

/** A throwaway `drizzle/` directory holding {@link FIXTURE_FILES}. Caller removes it. */
function migrationsFixture(): string {
  const folder = mkdtempSync(join(tmpdir(), 'oxydb-live-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries: FIXTURE_ENTRIES })
  );
  for (const file of FIXTURE_FILES) {
    writeFileSync(join(folder, `${file.tag}.sql`), file.sql);
  }
  return folder;
}

function bareDatabaseName(databaseUrl: string): string {
  return new URL(databaseUrl).pathname.replace(/^\//, '');
}

/**
 * Narrows a `beforeAll`-assigned `T | undefined` to `T`, with a real runtime
 * check rather than a `!`/`as` type-only assertion — `beforeAll` always runs
 * before the `it()`s below read these, but TypeScript has no way to know
 * that from the types alone.
 */
function assertAssigned<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`${name} was not assigned — beforeAll must run before this is read.`);
  }
  return value;
}

describeLive('createTestDatabase / dropTestDatabase (live Postgres)', () => {
  it('creates a connectable, uniquely-named database, and drop actually removes it', async () => {
    const url = await createTestDatabase({ adminUrl: ADMIN_URL });
    const name = bareDatabaseName(url);

    const client = postgres(url, { max: 1 });
    try {
      const rows = await client<{ current_database: string }[]>`select current_database()`;
      expect(rows[0]?.current_database).toBe(name);
    } finally {
      await client.end({ timeout: 5 });
    }

    await dropTestDatabase(url);

    // Confirmed via a SEPARATE admin connection, not by re-using `client`
    // (already closed above) or by trusting `dropTestDatabase` resolving
    // without error — this is the actual evidence the database is gone.
    const admin = postgres(assertAssigned(ADMIN_URL, 'ADMIN_URL'), { max: 1 });
    try {
      const rows = await admin<{ present: boolean }[]>`
        select exists(select 1 from pg_database where datname = ${name}) as present
      `;
      expect(rows[0]?.present).toBe(false);
    } finally {
      await admin.end({ timeout: 5 });
    }
  });
});

describeLive('migration-ledger functions against a real Postgres', () => {
  let freshUrl: string | undefined;
  let freshClient: postgres.Sql | undefined;
  let migratedUrl: string | undefined;
  let migratedClient: postgres.Sql | undefined;
  let migratedName: string;
  let fixtureFolder: string | undefined;

  beforeAll(async () => {
    // A database no migration has ever touched — for the "nothing recorded
    // yet" branch of readAppliedMillis/readLastAppliedMillis.
    freshUrl = await createTestDatabase({ adminUrl: ADMIN_URL });
    freshClient = postgres(freshUrl, { max: 1 });

    // A second database, actually migrated through the SAME runMigrations
    // this package ships — so the ledger rows these tests read are exactly
    // what a real migration run produces, not a hand-written fixture.
    migratedUrl = await createTestDatabase({ adminUrl: ADMIN_URL });
    migratedName = bareDatabaseName(migratedUrl);
    fixtureFolder = migrationsFixture();
    await runMigrations({
      databaseUrl: migratedUrl,
      migrationsFolder: fixtureFolder,
      extensions: [],
      run: 'all',
      expectedDatabase: migratedName,
      dryRun: false,
      logger: noopLogger,
    });
    migratedClient = postgres(migratedUrl, { max: 1 });
  });

  afterAll(async () => {
    await freshClient?.end({ timeout: 5 });
    await migratedClient?.end({ timeout: 5 });
    if (fixtureFolder) rmSync(fixtureFolder, { recursive: true, force: true });
    if (freshUrl) await dropTestDatabase(freshUrl);
    if (migratedUrl) await dropTestDatabase(migratedUrl);
  });

  describe('assertMigrationTarget', () => {
    it('resolves when the connection really is pointed at the named database', async () => {
      const client = assertAssigned(migratedClient, 'migratedClient');
      await expect(assertMigrationTarget(client, migratedName)).resolves.toBeUndefined();
    });

    it('rejects, naming both sides, when it is not', async () => {
      const client = assertAssigned(migratedClient, 'migratedClient');
      await expect(assertMigrationTarget(client, 'definitely_not_this_database')).rejects.toThrow(
        WrongMigrationTargetError
      );
      await expect(assertMigrationTarget(client, 'definitely_not_this_database')).rejects.toThrow(
        new RegExp(migratedName)
      );
    });
  });

  describe('readAppliedMillis / readLastAppliedMillis', () => {
    it('return [] / null against a database no migration has ever touched', async () => {
      const client = assertAssigned(freshClient, 'freshClient');
      await expect(readAppliedMillis(client)).resolves.toEqual([]);
      await expect(readLastAppliedMillis(client)).resolves.toBeNull();
    });

    it('return the real applied millis, correctly coerced from Postgres, once migrations have run', async () => {
      const client = assertAssigned(migratedClient, 'migratedClient');
      // Order-independent: `readAppliedMillis` runs no ORDER BY (see its own
      // comment in ledger.ts).
      await expect(readAppliedMillis(client)).resolves.toEqual(
        expect.arrayContaining([1_000, 2_000])
      );
      await expect(readLastAppliedMillis(client)).resolves.toBe(2_000);
    });
  });

  describe('assertPostgresMigrationsCurrent', () => {
    it('resolves when the ledger covers every shipped journal entry', async () => {
      const client = assertAssigned(migratedClient, 'migratedClient');
      await expect(
        assertPostgresMigrationsCurrent(client, FIXTURE_ENTRIES)
      ).resolves.toBeUndefined();
    });

    it('rejects and names the tag when the image ships a migration the database has not applied', async () => {
      const client = assertAssigned(migratedClient, 'migratedClient');
      const aheadEntries: JournalEntry[] = [...FIXTURE_ENTRIES, { tag: '0002_third', when: 3_000 }];
      await expect(assertPostgresMigrationsCurrent(client, aheadEntries)).rejects.toThrow(
        /0002_third/
      );
    });
  });
});
