/**
 * Driver-Error Translation
 *
 * The Mongo port replaced `error.code === 11000` at a dozen call sites with a
 * SQLSTATE check, and a SQLSTATE check is easy to get wrong in a way that
 * silently passes: **drizzle wraps the driver failure in its own error**, so
 * `code` and `constraint_name` live on `cause`, not on the error you catch. A
 * predicate that reads `error.code` directly matches NOTHING — and the call
 * sites that use it are all `catch` blocks that then rethrow, so the failure
 * looks like an unrelated 500 rather than a broken guard.
 *
 * Walking the `cause` chain once, here, is what keeps every "the unique index
 * rejected a concurrent duplicate" branch honest. `schema/__tests__` uses the
 * same shape for its assertions, deliberately: a constraint the schema tests
 * prove exists and a call site that reacts to it must agree on how the error is
 * read.
 *
 * `constraintName` is what makes a reaction SPECIFIC. `isUniqueViolation(error)`
 * alone cannot tell "this juror already voted" from "an unrelated unique index
 * fired", so a handler that maps a duplicate onto a friendly answer must name
 * the constraint it is answering for — otherwise a future index on the same
 * table quietly starts returning the wrong verdict.
 */

/** Postgres `unique_violation`. */
export const UNIQUE_VIOLATION = '23505';
/** Postgres `foreign_key_violation`. */
export const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Depth ceiling on the `cause` walk. A cyclic chain is not something any driver
 * produces, but an unbounded walk turns one into a hang inside a `catch`.
 */
const MAX_CAUSE_DEPTH = 8;

/**
 * Read a string field off the driver error underneath drizzle's wrapper.
 *
 * `cause` is reached through `Reflect.get` rather than `error.cause`: this
 * package targets `es6`, whose `Error` type has no `cause` property, and the
 * point of this module is to survive exactly that kind of mismatch rather than
 * be silenced with a cast.
 *
 * Returns `undefined` when no error in the chain carries the field, so a caller
 * can never mistake "not a driver error" for a particular SQLSTATE.
 */
function driverField(error: unknown, field: string): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current instanceof Error && depth < MAX_CAUSE_DEPTH; depth += 1) {
    const value: unknown = Reflect.get(current, field);
    if (typeof value === 'string') {
      return value;
    }
    current = Reflect.get(current, 'cause');
  }
  return undefined;
}

/** The SQLSTATE of a driver error, or `undefined` when it is not one. */
export function sqlStateOf(error: unknown): string | undefined {
  return driverField(error, 'code');
}

/**
 * The name of the constraint a driver error names, or `undefined`.
 *
 * postgres.js exposes it as `constraint_name` (the wire field), not `constraint`.
 */
export function constraintNameOf(error: unknown): string | undefined {
  return driverField(error, 'constraint_name');
}

/** True when `error` is a unique-index violation, optionally on a NAMED index. */
export function isUniqueViolation(error: unknown, constraintName?: string): boolean {
  if (sqlStateOf(error) !== UNIQUE_VIOLATION) {
    return false;
  }
  return constraintName === undefined || constraintNameOf(error) === constraintName;
}

/** True when `error` is a foreign-key violation, optionally on a NAMED constraint. */
export function isForeignKeyViolation(error: unknown, constraintName?: string): boolean {
  if (sqlStateOf(error) !== FOREIGN_KEY_VIOLATION) {
    return false;
  }
  return constraintName === undefined || constraintNameOf(error) === constraintName;
}
