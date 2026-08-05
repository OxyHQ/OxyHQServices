import type { SQL } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { DATABASE_CASING } from './casing';

/**
 * The narrowest thing a mechanism in this package needs: something that can run
 * a drizzle SQL chunk and hand back rows.
 *
 * Declared structurally rather than as `PostgresJsDatabase<typeof schema>`,
 * because that type names the CONSUMER's schema and nothing in a shared package
 * may. A transaction handle satisfies it as readily as a pool does, which is
 * what lets a sweep or a gate run inside one.
 */
export interface SqlExecutor {
  execute<T>(query: SQL): Promise<T[]>;
}

/** A drizzle handle over the consumer's own schema. */
export type OxyDatabase<TSchema extends Record<string, unknown>> = PostgresJsDatabase<TSchema>;

export interface CreateDatabaseOptions<TSchema extends Record<string, unknown>> {
  readonly url: string;
  readonly schema: TSchema;
  /** postgres.js pool options. The caller owns pool sizing and timeouts. */
  readonly client?: postgres.Options<Record<string, never>>;
}

/**
 * Build a drizzle handle and the client underneath it.
 *
 * Deliberately NOT a singleton: process lifecycle, health checks and shutdown
 * ordering differ per application, so each one keeps its own. What this
 * guarantees is the part that must NOT differ — that the handle is built with
 * `DATABASE_CASING`, so the SQL queries reference matches the SQL migrations
 * created.
 */
export function createDatabase<TSchema extends Record<string, unknown>>(
  options: CreateDatabaseOptions<TSchema>
): { db: OxyDatabase<TSchema>; client: postgres.Sql } {
  const client = postgres(options.url, options.client);
  return {
    db: drizzle(client, { schema: options.schema, casing: DATABASE_CASING }),
    client,
  };
}
