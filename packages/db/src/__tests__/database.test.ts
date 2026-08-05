import net from 'node:net';
import { sql } from 'drizzle-orm';
import { pgTable, text } from 'drizzle-orm/pg-core';
import type postgres from 'postgres';
import { createDatabase, type SqlExecutor } from '../database';

describe('SqlExecutor', () => {
  it('is satisfied by anything that can run a drizzle SQL chunk', async () => {
    const calls: string[] = [];
    const fake: SqlExecutor = {
      execute: async <T>(query: Parameters<SqlExecutor['execute']>[0]): Promise<T[]> => {
        calls.push(query.queryChunks.length > 0 ? 'chunked' : 'empty');
        return [] as T[];
      },
    };

    await fake.execute(sql`select 1`);

    expect(calls).toEqual(['chunked']);
  });
});

describe('createDatabase', () => {
  // A throwaway table with a column left in TypeScript camelCase and no
  // explicit SQL name. It only renders snake_case if `createDatabase` actually
  // wires `DATABASE_CASING` into the drizzle handle — the module's entire
  // reason to exist, per the brief.
  const schema = { widgets: pgTable('widgets', { someValue: text() }) };

  function build(clientOptions?: postgres.Options<Record<string, never>>) {
    return createDatabase({
      url: 'postgres://user:pass@127.0.0.1:5432/oxy_test',
      schema,
      client: clientOptions,
    });
  }

  // postgres.js connects lazily — `postgres(url, options)` only builds the
  // pool's bookkeeping; it never touches `net.Socket` until a query is
  // actually consumed (confirmed by reading `postgres/src/connection.js` and
  // `query.js`: `Connection()`'s constructor pushes onto an idle queue and
  // returns; a tagged-template call builds an inert `Query` `Promise`
  // subclass that dispatches to the connection only from its own overridden
  // `.then()`/`.catch()`/`.execute()`, one microtask later). So this waits out
  // a macrotask before asserting, rather than reading an un-awaited call as
  // proof — checked immediately after `build()` returns, this assertion is
  // satisfied by both a lazy client AND one that fires an un-awaited startup
  // query, because that query's own connect only lands on a later tick.
  // Spying on the constructor a real connection attempt would call proves the
  // lazy behaviour at RUNTIME instead of assuming it, and doubles as a
  // regression gate: if a future `postgres` version — or a later edit here —
  // started connecting eagerly, every other test in this file would start
  // needing a live database, and this is the one that would say so.
  it('opens no socket while building the handle — connecting is deferred to the first query', async () => {
    const connectSpy = jest.spyOn(net.Socket.prototype, 'connect');
    try {
      const { client } = build();
      // A fire-and-forget query's own dispatch is scheduled via `setTimeout`
      // deep inside postgres.js (`reconnect()`), a MACROTASK in the timers
      // phase — a same-phase `setImmediate` is not guaranteed to run after it
      // (empirically, it sometimes ran first, hiding the very call this test
      // exists to catch). A real delay clears that ambiguity outright.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(connectSpy).not.toHaveBeenCalled();
      await client.end({ timeout: 0 });
    } finally {
      connectSpy.mockRestore();
    }
  });

  it('renders an undeclared column name in snake_case, proving DATABASE_CASING reached the handle', () => {
    const { db, client } = build();
    try {
      const { sql: rendered } = db.select().from(schema.widgets).toSQL();
      expect(rendered).toContain('"some_value"');
      expect(rendered).not.toContain('"someValue"');
    } finally {
      client.end({ timeout: 0 });
    }
  });

  it("passes the caller's schema object through by reference, not a copy", () => {
    const { db, client } = build();
    try {
      // `db._` is drizzle's own internal-but-public escape hatch; `fullSchema`
      // is the exact object `createDatabase` was given, so this fails if the
      // schema is dropped, cloned, or replaced on the way to `drizzle(...)`.
      expect(db._.fullSchema).toBe(schema);
    } finally {
      client.end({ timeout: 0 });
    }
  });

  it('forwards pool options to the underlying postgres.js client', () => {
    const { client } = build({ max: 7 });
    try {
      expect(client.options.max).toBe(7);
    } finally {
      client.end({ timeout: 0 });
    }
  });

  it('returns the client the handle actually wraps, not a second instance', () => {
    const { db, client } = build();
    try {
      expect(db.$client).toBe(client);
    } finally {
      client.end({ timeout: 0 });
    }
  });
});
