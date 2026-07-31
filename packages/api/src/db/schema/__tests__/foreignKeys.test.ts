/**
 * Foreign-key coverage gate.
 *
 * The migration lands table by table, so some foreign keys cannot be declared
 * yet — their parent table does not exist. `deferredForeignKeys.ts` records each
 * one as data; this file turns that record into a gate with two properties:
 *
 *   1. A deferred foreign key becomes MANDATORY the moment its parent table
 *      appears in the schema barrel. Whoever lands `users` gets a red test
 *      naming every column that must now reference it — the FK cannot be
 *      quietly forgotten, and the ledger empties itself as the port completes.
 *   2. A NEW id-shaped column cannot arrive unclassified. It must have a real
 *      constraint, or be in one of the two ledgers with a reason.
 *
 * These assertions read the drizzle schema objects, not the database, so they
 * hold even before a migration is applied.
 */

import { is, type Column } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '../../casing';
import * as schema from '../index';
import {
  DEFERRED_FOREIGN_KEYS,
  ID_COLUMNS_WITHOUT_FOREIGN_KEY,
} from '../deferredForeignKeys';

/**
 * Vacuity floor. If the barrel traversal below ever breaks, it would find zero
 * tables and every assertion in this file would pass by examining nothing.
 */
const MINIMUM_TABLES = 8;

const tables = Object.values(schema).filter((value): value is PgTable =>
  is(value, PgTable)
);

/**
 * `blocks.user_id` — the identity used in every failure message here.
 *
 * The SQL name via `sqlColumnName`, never `column.name`: the latter is the
 * TypeScript property (`userId`), so an `endsWith('_id')` test against it
 * matches nothing and passes vacuously.
 */
function describeColumn(table: PgTable, column: Column): string {
  return `${getTableConfig(table).name}.${sqlColumnName(column)}`;
}

describe('schema foreign keys', () => {
  it('finds the schema barrel (guards against a vacuous pass)', () => {
    expect(tables.length).toBeGreaterThanOrEqual(MINIMUM_TABLES);
  });

  it('declares a real foreign key as soon as the parent table exists', () => {
    const present = new Set(tables.map((table) => getTableConfig(table).name));

    const owed = DEFERRED_FOREIGN_KEYS.filter((fk) => present.has(fk.parentTable)).map(
      (fk) =>
        `${describeColumn(fk.table, fk.column)} -> ${fk.parentTable}.${fk.parentColumn} ` +
        `(on delete ${fk.onDelete})`
    );

    // Reads as: "`users` is in the schema now, so these columns must reference
    // it — declare them with .references(), then delete their DEFERRED entries."
    expect(owed).toEqual([]);
  });

  it('classifies every id-shaped column', () => {
    const declared = new Set<string>();
    for (const table of tables) {
      for (const fk of getTableConfig(table).foreignKeys) {
        for (const column of fk.reference().columns) {
          declared.add(describeColumn(table, column));
        }
      }
    }

    const deferred = new Set(
      DEFERRED_FOREIGN_KEYS.map((fk) => describeColumn(fk.table, fk.column))
    );
    const exempt = new Set(
      ID_COLUMNS_WITHOUT_FOREIGN_KEY.map((entry) =>
        describeColumn(entry.table, entry.column)
      )
    );

    const unclassified: string[] = [];
    for (const table of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.primary || !sqlColumnName(column).endsWith('_id')) continue;
        const id = describeColumn(table, column);
        if (declared.has(id) || deferred.has(id) || exempt.has(id)) continue;
        unclassified.push(id);
      }
    }

    // Reads as: "this column looks like a relation and nobody decided about it —
    // give it .references(), or add it to DEFERRED_FOREIGN_KEYS /
    // ID_COLUMNS_WITHOUT_FOREIGN_KEY with a reason."
    expect(unclassified).toEqual([]);
  });

  it('does not carry a stale ledger entry', () => {
    const columns = new Set<string>();
    for (const table of tables) {
      for (const column of getTableConfig(table).columns) {
        columns.add(describeColumn(table, column));
      }
    }

    const ledger = [
      ...DEFERRED_FOREIGN_KEYS.map((fk) => describeColumn(fk.table, fk.column)),
      ...ID_COLUMNS_WITHOUT_FOREIGN_KEY.map((entry) =>
        describeColumn(entry.table, entry.column)
      ),
    ];

    expect(ledger.filter((id) => !columns.has(id))).toEqual([]);
  });

  it('states an ON DELETE and a reason for every deferred foreign key', () => {
    const incomplete = DEFERRED_FOREIGN_KEYS.filter(
      (fk) => fk.reason.trim() === '' || fk.parentColumn.trim() === ''
    ).map((fk) => describeColumn(fk.table, fk.column));

    expect(incomplete).toEqual([]);
    // `onDelete` is a closed union, so tsc already refuses an unset one; the
    // list being non-empty is what proves this ran against real entries.
    expect(DEFERRED_FOREIGN_KEYS.length).toBeGreaterThan(0);
  });
});
