/**
 * Which database is this migration allowed to write DDL to — asserted, not
 * assumed.
 *
 * ## Why this guard exists
 *
 * Pointed at the wrong database, a bulk data copy usually hits a missing table
 * and dies loudly. Pointed at the wrong database, a migrator instead finds an
 * empty journal ledger, applies the whole journal, logs `Applied N Postgres
 * migration(s)` and exits 0 — leaving the real database untouched while the
 * operator reads a success line. Whatever runs next then acts against a schema
 * that does not exist. There is no error to notice and nothing to roll back,
 * because nothing failed.
 *
 * ## An affirmative, not a denylist
 *
 * An explicit AFFIRMATIVE (`--target-database=<name>`) checked against
 * `current_database()`, not a denylist. A denylist answers only the mistakes
 * somebody thought of; an affirmative fails closed on a stale probe URL, on
 * another environment, on a database recreated under a different name. The
 * operator states where they believe they are pointing, and being wrong is the
 * case this catches. The message names BOTH sides for the same reason: "wrong
 * database" says you are wrong, `expected foo, got foo_audit_probe` says which
 * end to fix.
 */

import type { Sql } from 'postgres';

/** Raised when the connected database is not the one the operator named. */
export class WrongMigrationTargetError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string
  ) {
    super(
      `Refusing to migrate: --target-database=${JSON.stringify(expected)} but \
DATABASE_URL is connected to ${JSON.stringify(actual)}.
One of those two is wrong, and this tool cannot tell which. Fix the \
flag if you named the wrong target; fix the DATABASE_URL secret on the \
task definition if you are pointed somewhere unintended. No DDL has \
been applied and the migration ledger has not been touched.`
    );
    this.name = 'WrongMigrationTargetError';
  }
}

/** Raised when a run did not say where it believes it is pointing. */
export class MissingMigrationTargetError extends Error {
  constructor() {
    super(
      'Refusing to migrate: --target-database=<name> is REQUIRED, including ' +
        'for DRY_RUN. The database this connects to is decided entirely by the ' +
        'DATABASE_URL secret, so a run that does not state its intended target ' +
        'cannot be checked against it — and a migration aimed at the wrong ' +
        'database does not fail, it reports success over an untouched one. ' +
        'Example: `--target-database=my_app_audit_probe` for a rehearsal, ' +
        '`--target-database=my_app` for the cutover.'
    );
    this.name = 'MissingMigrationTargetError';
  }
}

/**
 * Read `--target-database=<name>` out of an argument list. No connection needed.
 *
 * Split from {@link assertMigrationTarget} so a mistyped flag is caught BEFORE
 * anything opens a socket — and so the refusal can be tested without a database.
 *
 * @throws {MissingMigrationTargetError} When no target was named.
 */
export function readTargetDatabase(argv: readonly string[]): string {
  const prefix = '--target-database=';
  const flag = argv.find((arg) => arg.startsWith(prefix));
  const target = flag?.slice(prefix.length).trim();
  if (target === undefined || target.length === 0) throw new MissingMigrationTargetError();
  return target;
}

/**
 * Check the named target against the database actually connected.
 *
 * MUST be the first statement issued on the connection: everything this
 * protects — extension setup, the ledger read, the DDL itself — is a write or
 * a precondition for one, so an assertion placed after any of them is checking
 * a database it has already begun changing.
 *
 * @throws {WrongMigrationTargetError} When they differ.
 */
export async function assertMigrationTarget(client: Sql, expected: string): Promise<void> {
  const rows = await client<{ current_database: string }[]>`select current_database()`;
  const actual = rows[0]?.current_database;
  if (actual !== expected) throw new WrongMigrationTargetError(expected, actual ?? '(unknown)');
}
