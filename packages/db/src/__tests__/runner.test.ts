/**
 * What `runMigrations` can be checked on WITHOUT a live database:
 *
 * - `materializeJournalPrefix`, the mechanism that lets a `pre`-phase run
 *   stop before a `post` migration: pure filesystem manipulation, no
 *   connection involved at all.
 * - That the filesystem preconditions (a readable journal, every pending
 *   migration declaring a deploy phase) run and fail BEFORE any connection
 *   is opened. Proven the same way `extensions.test.ts` proves its
 *   connection-avoidance claim: point `databaseUrl` at a host `.invalid`
 *   guarantees can never resolve (RFC 2606) and assert the rejection carries
 *   the filesystem check's own message, not a network error.
 *
 * Everything past that point — `assertMigrationTarget` actually comparing
 * against a real `current_database()`, the ledger read, `ensureExtensions`,
 * `migrate()` itself, and the post-apply re-verification — needs a real
 * Postgres and is left for the ephemeral-database harness landing in a later
 * task, the same boundary `targetDatabase.test.ts` already draws for
 * `assertMigrationTarget`.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JournalEntry } from '../migrate/ledger';
import { materializeJournalPrefix, runMigrations } from '../migrate/runner';

const noopLogger = { info: () => {}, debug: () => {} };

function migrationsFixture(entries: Array<{ tag: string; when: number; sql: string }>): string {
  const folder = mkdtempSync(join(tmpdir(), 'oxydb-runner-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({
      version: '7',
      dialect: 'postgresql',
      entries: entries.map(({ tag, when }) => ({ tag, when })),
    })
  );
  for (const entry of entries) {
    writeFileSync(join(folder, `${entry.tag}.sql`), entry.sql);
  }
  return folder;
}

describe('materializeJournalPrefix', () => {
  const folder = migrationsFixture([
    { tag: '0000_a', when: 1000, sql: '-- oxy:deploy-phase=pre\nselect 1;\n' },
    { tag: '0001_b', when: 2000, sql: '-- oxy:deploy-phase=post\nselect 2;\n' },
    { tag: '0002_c', when: 3000, sql: '-- oxy:deploy-phase=pre\nselect 3;\n' },
  ]);
  const entries: JournalEntry[] = JSON.parse(
    readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')
  ).entries;

  it('keeps only the first `count` journal entries', () => {
    const prefixFolder = materializeJournalPrefix(entries, 2, folder);
    const prefixJournal = JSON.parse(readFileSync(join(prefixFolder, 'meta', '_journal.json'), 'utf8'));
    expect(prefixJournal.entries.map((entry: JournalEntry) => entry.tag)).toEqual([
      '0000_a',
      '0001_b',
    ]);
  });

  it('copies only the retained `.sql` files, and leaves the excluded ones out entirely', () => {
    const prefixFolder = materializeJournalPrefix(entries, 2, folder);
    expect(existsSync(join(prefixFolder, '0000_a.sql'))).toBe(true);
    expect(existsSync(join(prefixFolder, '0001_b.sql'))).toBe(true);
    expect(existsSync(join(prefixFolder, '0002_c.sql'))).toBe(false);
  });

  it('copies each `.sql` file byte for byte, so drizzle records the same hash a full-folder run would', () => {
    const prefixFolder = materializeJournalPrefix(entries, 1, folder);
    expect(readFileSync(join(prefixFolder, '0000_a.sql'), 'utf8')).toBe(
      readFileSync(join(folder, '0000_a.sql'), 'utf8')
    );
  });

  it('preserves the journal file\'s other top-level fields', () => {
    const prefixFolder = materializeJournalPrefix(entries, 1, folder);
    const prefixJournal = JSON.parse(readFileSync(join(prefixFolder, 'meta', '_journal.json'), 'utf8'));
    expect(prefixJournal.version).toBe('7');
    expect(prefixJournal.dialect).toBe('postgresql');
  });

  it('takes a PREFIX, not an arbitrary subset — count=0 keeps nothing', () => {
    const prefixFolder = materializeJournalPrefix(entries, 0, folder);
    const prefixJournal = JSON.parse(readFileSync(join(prefixFolder, 'meta', '_journal.json'), 'utf8'));
    expect(prefixJournal.entries).toEqual([]);
    expect(existsSync(join(prefixFolder, '0000_a.sql'))).toBe(false);
  });
});

describe('runMigrations — filesystem preconditions run before any connection is opened', () => {
  // `.invalid` is reserved by RFC 2606 to never resolve, so any of these
  // tests reaching an actual connection attempt would fail on a DNS lookup
  // rather than on the message asserted below — the two are not confusable.
  const unreachableUrl = 'postgres://unreachable.invalid/db';

  it('refuses a migrations folder whose journal cannot be read', async () => {
    await expect(
      runMigrations({
        databaseUrl: unreachableUrl,
        migrationsFolder: join(tmpdir(), 'oxydb-runner-does-not-exist'),
        extensions: [],
        run: 'all',
        expectedDatabase: 'irrelevant',
        dryRun: false,
        logger: noopLogger,
      })
    ).rejects.toThrow(/Cannot read the migration journal/);
  });

  it('refuses a pending migration with no deploy-phase marker', async () => {
    const folder = migrationsFixture([{ tag: '0000_a', when: 1000, sql: 'select 1;\n' }]);

    await expect(
      runMigrations({
        databaseUrl: unreachableUrl,
        migrationsFolder: folder,
        extensions: [],
        run: 'all',
        expectedDatabase: 'irrelevant',
        dryRun: false,
        logger: noopLogger,
      })
    ).rejects.toThrow(/do not declare which side of a deploy they belong on/);
  });

  it('names the offending tag, not just the count', async () => {
    const folder = migrationsFixture([
      { tag: '0000_a', when: 1000, sql: '-- oxy:deploy-phase=pre\nselect 1;\n' },
      { tag: '0001_bad', when: 2000, sql: 'select 2;\n' },
    ]);

    await expect(
      runMigrations({
        databaseUrl: unreachableUrl,
        migrationsFolder: folder,
        extensions: [],
        run: 'all',
        expectedDatabase: 'irrelevant',
        dryRun: false,
        logger: noopLogger,
      })
    ).rejects.toThrow(/0001_bad/);
  });
});
