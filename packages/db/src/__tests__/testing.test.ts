/**
 * `createTestDatabase` / `dropTestDatabase` — the parts checkable WITHOUT a
 * live Postgres, plus control-flow checks on a faked driver.
 *
 * The full round trip (a real `CREATE DATABASE`, a real `DROP DATABASE`, and
 * the ledger functions this harness exists to make testable) needs an actual
 * server and lives in `liveDatabase.test.ts`, gated on `OXYDB_TEST_ADMIN_URL`.
 */

import { createTestDatabase, dropTestDatabase } from '../testing';

describe('createTestDatabase', () => {
  // The brief's own mandated test asserted only `.rejects.toThrow()` (no
  // message check). Mutation-tested against a version reading
  // `options.adminUrl || 'postgres://unreachable.invalid/db'` instead of
  // refusing outright: `''` is falsy, so `||` invents exactly the fallback
  // this test's own name says must not happen — and the mutated code still
  // rejects (the invented host cannot resolve, ~500ms later), so the
  // unstrengthened assertion passed against it. Strengthened to assert the
  // rejection is OUR OWN guard's message, which an invented-URL connection
  // failure can never produce, rather than "rejected for any reason".
  it('fails loudly when no admin URL is configured, rather than inventing one', async () => {
    await expect(createTestDatabase({ adminUrl: '' })).rejects.toThrow(/adminUrl/);
  });

  it('fails the same way when adminUrl is omitted from the options object', async () => {
    await expect(createTestDatabase({})).rejects.toThrow(/adminUrl/);
  });

  it('fails the same way when no options object is passed at all', async () => {
    await expect(createTestDatabase()).rejects.toThrow(/adminUrl/);
  });

  describe('name generation and URL construction (faked driver, no live Postgres)', () => {
    beforeEach(() => {
      // `testing.ts`, and the `postgres` module it imports, are already
      // cached from this file's own static top-level import (unmocked). A
      // `jest.doMock` registered after that point only takes effect for a
      // module required AFTER the registry forgets the cached copy — so the
      // reset must run BEFORE `doMock`, not just after the previous test.
      jest.resetModules();
    });

    afterEach(() => {
      jest.resetModules();
      jest.restoreAllMocks();
      jest.dontMock('postgres');
    });

    it('creates the database on the maintenance URL, names it to the throwaway pattern, and returns a URL built from adminUrl', async () => {
      const created: string[] = [];
      let endCalls = 0;
      let constructedWith: string | undefined;

      jest.doMock('postgres', () => {
        const factory = jest.fn((connectionUrl: string) => {
          constructedWith = connectionUrl;
          return Object.assign(jest.fn(), {
            unsafe: jest.fn((statement: string) => {
              created.push(statement);
              return Promise.resolve([]);
            }),
            end: jest.fn(() => {
              endCalls += 1;
              return Promise.resolve(undefined);
            }),
          });
        });
        return { __esModule: true, default: factory };
      });

      const { createTestDatabase: createTestDatabaseUnderMock } = await import('../testing');

      const url = await createTestDatabaseUnderMock({
        adminUrl: 'postgres://user:pass@db.example.com:5432/oxy_dev?sslmode=require',
      });

      // The admin connection was opened against the `postgres` maintenance
      // database on the SAME server, not the throwaway name and not the
      // caller's own `oxy_dev` database — CREATE DATABASE cannot run from
      // inside the database it targets.
      expect(constructedWith).toBe(
        'postgres://user:pass@db.example.com:5432/postgres?sslmode=require'
      );

      // Exactly one CREATE DATABASE, naming something matching the pattern
      // dropTestDatabase is willing to drop.
      expect(created).toHaveLength(1);
      const match = /^create database "(oxydb_test_[0-9a-f]{16})"$/.exec(created[0]);
      expect(match).not.toBeNull();
      const name = match?.[1];

      // The returned URL is `adminUrl` with ONLY its path replaced — host,
      // port, credentials and query string all survive untouched.
      expect(url).toBe(`postgres://user:pass@db.example.com:5432/${name}?sslmode=require`);

      // The admin connection is closed once the database is created, not
      // left open for the lifetime of the throwaway database.
      expect(endCalls).toBe(1);
    });

    it('closes the admin connection even when CREATE DATABASE fails', async () => {
      let endCalls = 0;

      jest.doMock('postgres', () => {
        const factory = jest.fn(() =>
          Object.assign(jest.fn(), {
            unsafe: jest.fn(() => Promise.reject(new Error('simulated create failure'))),
            end: jest.fn(() => {
              endCalls += 1;
              return Promise.resolve(undefined);
            }),
          })
        );
        return { __esModule: true, default: factory };
      });

      const { createTestDatabase: createTestDatabaseUnderMock } = await import('../testing');

      await expect(
        createTestDatabaseUnderMock({ adminUrl: 'postgres://db.example.com/oxy_dev' })
      ).rejects.toThrow('simulated create failure');

      expect(endCalls).toBe(1);
    });
  });
});

describe('dropTestDatabase', () => {
  // `.invalid` is RFC 2606 — guaranteed never to resolve. No mock is needed
  // for THIS test: if the implementation opened a connection before checking
  // the name, the promise would hang or reject with a network/DNS error
  // instead of the refusal message below (the same connection-avoidance
  // idiom `extensions.test.ts` uses for `ensureExtensions`).
  it('refuses a URL that does not name a throwaway database, without opening a connection', async () => {
    await expect(
      dropTestDatabase('postgres://unreachable.invalid/some_real_database')
    ).rejects.toThrow(/Refusing to drop/);
    await expect(
      dropTestDatabase('postgres://unreachable.invalid/oxydb_test_shorthex')
    ).rejects.toThrow(/Refusing to drop/);
    await expect(
      dropTestDatabase('postgres://unreachable.invalid/mention_test_0123456789abcdef')
    ).rejects.toThrow(/Refusing to drop/);
  });

  describe('against a faked driver, no live Postgres', () => {
    beforeEach(() => {
      jest.resetModules();
    });

    afterEach(() => {
      jest.resetModules();
      jest.restoreAllMocks();
      jest.dontMock('postgres');
    });

    it('never constructs a connection at all for a name it refuses', async () => {
      const factory = jest.fn();
      jest.doMock('postgres', () => ({ __esModule: true, default: factory }));

      const { dropTestDatabase: dropTestDatabaseUnderMock } = await import('../testing');

      await expect(
        dropTestDatabaseUnderMock('postgres://db.example.com/not_a_throwaway')
      ).rejects.toThrow(/Refusing to drop/);
      expect(factory).not.toHaveBeenCalled();
    });

    it('drops a name matching the throwaway pattern, on the maintenance URL, with FORCE, and closes the connection', async () => {
      const statements: string[] = [];
      let endCalls = 0;
      let constructedWith: string | undefined;

      jest.doMock('postgres', () => {
        const factory = jest.fn((connectionUrl: string) => {
          constructedWith = connectionUrl;
          return Object.assign(jest.fn(), {
            unsafe: jest.fn((statement: string) => {
              statements.push(statement);
              return Promise.resolve([]);
            }),
            end: jest.fn(() => {
              endCalls += 1;
              return Promise.resolve(undefined);
            }),
          });
        });
        return { __esModule: true, default: factory };
      });

      const { dropTestDatabase: dropTestDatabaseUnderMock } = await import('../testing');

      await dropTestDatabaseUnderMock(
        'postgres://user:pass@db.example.com:5432/oxydb_test_0123456789abcdef?sslmode=require'
      );

      expect(constructedWith).toBe(
        'postgres://user:pass@db.example.com:5432/postgres?sslmode=require'
      );
      expect(statements).toEqual([
        'drop database if exists "oxydb_test_0123456789abcdef" with (force)',
      ]);
      expect(endCalls).toBe(1);
    });
  });
});
