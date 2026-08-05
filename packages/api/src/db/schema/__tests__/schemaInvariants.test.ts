/**
 * Schema-wide invariants, asserted against the MIGRATED database.
 *
 * These are the conventions in `CONVENTIONS.md` that a single table can violate
 * on its own without anything else noticing — so they are checked here across
 * every table at once, on the DDL that actually landed rather than on the
 * TypeScript that was meant to produce it. The gate itself (`findSchemaInvariantViolations`)
 * lives in `@oxyhq/db/assert`; the floors below are this schema's own data.
 */

import { findSchemaInvariantViolations } from '@oxyhq/db/assert';
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

it('holds every schema invariant', async () => {
  const violations = await findSchemaInvariantViolations(getDb(), {
    minimumTables: MINIMUM_TABLES,
    minimumColumns: MINIMUM_COLUMNS,
  });

  expect(violations).toEqual([]);
});
