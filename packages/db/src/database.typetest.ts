import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SqlExecutor } from './database';

/**
 * Compile-time-only regression check: NOT excluded from `tsconfig.json`
 * (unlike `__tests__`, which it does exclude), but excluded from every BUILD
 * tsconfig (`tsconfig.cjs.json`/`tsconfig.esm.json`/`tsconfig.types.json`, via
 * their own `**\/*.typetest.ts` exclude entry) — so it is checked by `bun run
 * --filter @oxyhq/db typescript` but never emitted into `dist/`.
 *
 * It has to live here rather than in `__tests__/database.test.ts` because this
 * package's `tsconfig.json` sets `isolatedModules: true`, and ts-jest reads
 * that exact compiler option to decide whether to run its own diagnostics —
 * `ts-jest/dist/legacy/config/config-set.js`: `this.isolatedModules =
 * this.parsedTsConfig.options.isolatedModules ?? false`. With it true, ts-jest
 * transpiles every test file WITHOUT type-checking it, so a type-only
 * assertion under `__tests__` would compile-error-check nothing and pass
 * unconditionally regardless of what `SqlExecutor` actually says (confirmed
 * empirically: a deliberate `const x: number = 'a string'` inside a test file
 * did not fail `bun run --filter @oxyhq/db test`). `tsc` itself is unaffected
 * by `isolatedModules` in this way — it is a real project-wide type-check
 * either way — which is why relocating here, rather than disabling
 * `isolatedModules`, is the fix: that setting is a separate, deliberately-kept
 * guard against code that would not survive a per-file transpiler, unrelated
 * to whether tests get type-checked.
 *
 * Never called — this function's BODY is the check, so it needs no live
 * database. `TransactionHandle` is extracted purely at the type level from
 * `PostgresJsDatabase['transaction']`'s callback parameter; `.transaction()`
 * is never actually invoked, which is what a real transaction would require.
 */
type TransactionCallback = Parameters<PostgresJsDatabase<Record<string, unknown>>['transaction']>[0];
type TransactionHandle = Parameters<TransactionCallback>[0];

function realHandlesSatisfySqlExecutor(
  db: PostgresJsDatabase<Record<string, unknown>>,
  tx: TransactionHandle
): void {
  // A real pool handle must satisfy SqlExecutor.
  const poolExecutor: SqlExecutor = db;
  void poolExecutor;

  // The handle a real transaction callback receives must satisfy SqlExecutor
  // too — this is the property that lets a sweep or a gate run inside a
  // caller's transaction (see `database.ts`'s `SqlExecutor` doc comment).
  const txExecutor: SqlExecutor = tx;
  void txExecutor;
}
void realHandlesSatisfySqlExecutor;
