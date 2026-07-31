/**
 * Schema-wide invariants, asserted against the MIGRATED database.
 *
 * These are the conventions in `CONVENTIONS.md` that a single table can violate
 * on its own without anything else noticing — so they are checked here across
 * every table at once, on the DDL that actually landed rather than on the
 * TypeScript that was meant to produce it.
 *
 * Every check carries a vacuity floor: a broken catalogue query would otherwise
 * return zero rows and pass by examining nothing.
 */

import { sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, getDb } from '../../../config/postgres';

/** Tables landed so far. A traversal returning fewer than this is broken. */
const MINIMUM_TABLES = 27;
/** Columns across those tables. Same purpose. */
const MINIMUM_COLUMNS = 356;

beforeAll(async () => {
  await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/** Application tables — drizzle's own bookkeeping lives in the `drizzle` schema. */
async function applicationTables(): Promise<string[]> {
  const rows = await getDb().execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  return rows.map((row) => row.table_name);
}

describe('schema invariants', () => {
  it('has the expected tables (guards against a vacuous pass)', async () => {
    const tables = await applicationTables();
    expect(tables.length).toBeGreaterThanOrEqual(MINIMUM_TABLES);
  });

  it('names every table in snake_case', async () => {
    const tables = await applicationTables();
    expect(tables.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))).toEqual([]);
  });

  it('names every column in snake_case', async () => {
    const rows = await getDb().execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
    `);

    expect(rows.length).toBeGreaterThanOrEqual(MINIMUM_COLUMNS);
    expect(
      rows
        .filter((row) => !/^[a-z][a-z0-9_]*$/.test(row.column_name))
        .map((row) => `${row.table_name}.${row.column_name}`)
    ).toEqual([]);
  });

  it('stores every timestamp WITH a time zone', async () => {
    // `timestamp without time zone` reinterprets the value in the session's
    // TimeZone on read, silently changing what a Mongo `Date` meant.
    const rows = await getDb().execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and data_type = 'timestamp without time zone'
    `);

    expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([]);
  });

  it('never defaults a column to the empty string', async () => {
    // Mongo's sparse-unique indexes collide on nulls, so two models use
    // `default: undefined` to dodge it. Postgres treats NULLs as distinct, so
    // that workaround must not travel — and it must NOT be "fixed" by
    // substituting `''`, which is a VALUE and therefore collides for real.
    const rows = await getDb().execute<{
      table_name: string;
      column_name: string;
      column_default: string;
    }>(sql`
      select table_name, column_name, column_default
      from information_schema.columns
      where table_schema = 'public' and column_default ~ ${"^''::"}
    `);

    expect(
      rows.map((row) => `${row.table_name}.${row.column_name} = ${row.column_default}`)
    ).toEqual([]);
  });

  it('gives every table a primary key', async () => {
    const rows = await getDb().execute<{ table_name: string }>(sql`
      select t.table_name
      from information_schema.tables t
      where t.table_schema = 'public' and t.table_type = 'BASE TABLE'
        and not exists (
          select 1 from information_schema.table_constraints c
          where c.table_schema = t.table_schema
            and c.table_name = t.table_name
            and c.constraint_type = 'PRIMARY KEY'
        )
    `);

    expect(rows.map((row) => row.table_name)).toEqual([]);
  });

  it('carries no Mongoose artifacts', async () => {
    const rows = await getDb().execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public' and column_name in ('__v', '_id')
    `);

    expect(rows.map((row) => `${row.table_name}.${row.column_name}`)).toEqual([]);
  });
});
