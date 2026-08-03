/**
 * The migration journal on disk and the applied-migration ledger in the
 * database — the two things `db/migrate.ts` compares to decide what is pending.
 *
 * Split out from the entrypoint so this logic can be tested without importing a
 * module whose top level connects to a database and exits the process.
 */

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type postgres from 'postgres';
import { ConfigurationError } from '../config/env';

/**
 * Where the applied-migration ledger lives. These are drizzle's own defaults,
 * restated as constants and passed EXPLICITLY to `migrate()` so the pending
 * report and the apply path can never read different tables.
 */
export const MIGRATIONS_SCHEMA = 'drizzle';
export const MIGRATIONS_TABLE = '__drizzle_migrations';

/**
 * `packages/api/drizzle`, resolved from this module rather than the working
 * directory. `src/db/` and `dist/db/` are both exactly two levels below the
 * package root, so the same expression is correct whether this file runs as
 * TypeScript under bun/ts-jest or as the compiled `dist/db/` output in the
 * container.
 */
export const MIGRATIONS_FOLDER = join(__dirname, '..', '..', 'drizzle');

/** One `drizzle/meta/_journal.json` entry: a migration file and when it was generated. */
export interface JournalEntry {
  tag: string;
  when: number;
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.tag === 'string' && typeof entry.when === 'number';
}

/**
 * The migration journal, in generation order.
 *
 * @throws {ConfigurationError} When the journal is missing, unparseable, or
 *   holds no entries. An empty read must never be mistaken for "nothing to do":
 *   that is exactly how an image shipped without `drizzle/` would report a
 *   clean no-op run while applying nothing.
 */
export function readJournal(folder: string = MIGRATIONS_FOLDER): JournalEntry[] {
  const path = join(folder, 'meta', '_journal.json');

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigurationError(
      `Cannot read the migration journal at ${path}: ` +
      `${error instanceof Error ? error.message : String(error)}. ` +
      'The drizzle/ directory must ship next to the compiled migrator — see the ' +
      'production stage of the Dockerfile.'
    );
  }

  const entries =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>).entries
      : undefined;

  if (!Array.isArray(entries) || entries.length === 0 || !entries.every(isJournalEntry)) {
    throw new ConfigurationError(
      `The migration journal at ${path} holds no usable entries. Refusing to ` +
      'report a clean run against a journal that could not be read.'
    );
  }

  return entries;
}

/**
 * Journal entries the ledger has not recorded.
 *
 * Mirrors drizzle's own rule exactly (`drizzle-orm/pg-core/dialect` `migrate`):
 * a migration runs when there is no ledger row at all, or when its journal
 * timestamp is strictly newer than the newest recorded one. Deliberately NOT a
 * per-hash set comparison — that would answer a different question than the
 * apply path does, and a report that disagrees with the action is worse than no
 * report.
 */
export function pendingEntries(
  entries: JournalEntry[],
  lastAppliedMillis: number | null
): JournalEntry[] {
  if (lastAppliedMillis === null) return [...entries];
  return entries.filter((entry) => lastAppliedMillis < entry.when);
}

/**
 * A throwaway migrations folder holding only the first `count` journal entries
 * and their `.sql` files.
 *
 * WHY THIS EXISTS. drizzle's migrator reads its own folder
 * (`readMigrationFiles`) and applies every entry newer than the newest one the
 * ledger records; there is no public way to hand it a subset. A pre-deploy run
 * that must stop before a `post` migration therefore points the migrator at a
 * folder that ends there. The `.sql` files are copied byte for byte, so the
 * `hash` drizzle records is identical to the one a full-folder run would have
 * recorded — a later full run cannot tell the difference.
 *
 * Deliberately NOT `db.dialect.migrate(subset, ...)`, which would reach past
 * the public `migrate()` helper: drizzle marks `dialect` and `session`
 * `@internal` and does not declare them on `PgDatabase`, so reaching them needs
 * a cast this repository does not permit.
 *
 * @returns The temporary folder. The caller owns it and must remove it.
 */
export function materializeJournalPrefix(
  count: number,
  sourceFolder: string = MIGRATIONS_FOLDER
): string {
  const journalPath = join(sourceFolder, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: JournalEntry[] };
  const retained = journal.entries.slice(0, count);

  if (retained.length !== count) {
    throw new ConfigurationError(
      `Cannot take the first ${count} entries of a journal holding ${journal.entries.length}.`
    );
  }

  const folder = mkdtempSync(join(tmpdir(), 'oxy-migrate-prefix-'));
  mkdirSync(join(folder, 'meta'), { recursive: true });
  writeFileSync(
    join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: retained })
  );
  for (const entry of retained) {
    copyFileSync(join(sourceFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }

  return folder;
}

/**
 * The newest `created_at` in the ledger, or `null` when the ledger table does
 * not exist yet (a database no migration has ever touched).
 *
 * Reads only — calling it against a fresh database creates nothing, which is
 * what lets the dry run stay genuinely read-only.
 */
export async function readLastAppliedMillis(client: postgres.Sql): Promise<number | null> {
  const [ledger] = await client<{ present: boolean }[]>`
    select to_regclass(${`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`}) is not null as present
  `;
  if (!ledger?.present) return null;

  const rows = await client<{ created_at: string | null }[]>`
    select created_at
    from ${client(MIGRATIONS_SCHEMA)}.${client(MIGRATIONS_TABLE)}
    order by created_at desc
    limit 1
  `;

  const createdAt = rows[0]?.created_at;
  // `bigint` arrives as a string from postgres.js; an empty ledger table reads
  // as no row at all.
  return createdAt === undefined || createdAt === null ? null : Number(createdAt);
}
