/**
 * Differential test: the COPY encoder must agree with drizzle's parameter
 * binding, value for value.
 *
 * Hand-rolling Postgres' `COPY` text format is the one genuinely dangerous part
 * of using COPY for a data migration. A wrong escape does not crash — it stores
 * something subtly different, which is the exact failure mode this whole
 * migration exists to avoid.
 *
 * So neither path is trusted on its own. The same row is loaded twice, once
 * through `copyRowsInto` and once through `db.insert(...).values(...)` (whose
 * binding is correct by construction, since the driver owns it), and the two
 * stored rows are compared column by column. A divergence names the column.
 *
 * The values are chosen to be hostile: every character `COPY` reserves, a
 * PostGIS-adjacent float pair, a `bytea`, a `text[]` whose elements contain
 * commas, quotes, braces and the literal word NULL, a `jsonb` holding nested
 * structure and unicode, and a `numeric(38,8)`.
 */

import { eq } from 'drizzle-orm';
import { closePostgres, connectPostgres, getPostgresClient, type Database } from '../../../config/postgres';
import { createTestDatabase, dropTestDatabase } from '../../testDatabase';
import { files, users, wallets, webauthnCredentials } from '../../schema';
import {
  copyRowsInto,
  encodeCopyValue,
  groupByColumnSet,
  peekNextStagingName,
} from '../bulkLoad';
import { buildRow } from '../rowBuilder';

jest.setTimeout(180_000);

let db: Database;
let sharedDatabaseUrl: string | undefined;
let ownDatabaseUrl: string;

// This suite TRUNCATES `users cascade`, so it owns its own throwaway database
// rather than sharing the run-wide one — the same reason
// `transparency.service.test.ts` does. Jest runs suites in parallel against one
// database by default, and a truncate is not something a neighbour survives.
beforeAll(async () => {
  sharedDatabaseUrl = process.env.DATABASE_URL;
  ownDatabaseUrl = await createTestDatabase();
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
  await dropTestDatabase(ownDatabaseUrl);
  // Leaving DATABASE_URL pointed at a dropped database would fail whatever jest
  // schedules next in this worker, for a reason that has nothing to do with it.
  process.env.DATABASE_URL = sharedDatabaseUrl;
});

/** Characters `COPY`'s text format reserves, plus friends. */
const HOSTILE_TEXT = 'tab\there\nnewline\r\ncarriage\\backslash "quoted" \'single\' , { } NULL';

function userRow(id: string): Record<string, unknown> {
  return buildRow(
    users,
    {
      id,
      username: `user_${id.slice(-6)}`,
      email: `${id.slice(-6)}@example.com`,
      bio: HOSTILE_TEXT,
      // `text[]` with elements that would break a naive array literal.
      links: ['https://a.example', 'has,comma', 'has"quote', 'has{brace}', 'NULL'],
      languages: ['en-US'],
      color: 'oxy',
      kind: 'personal',
      accountStatus: 'active',
      type: 'local',
      nameFirst: 'Ná\tte',
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      updatedAt: new Date('2026-01-02T03:04:05.678Z'),
    },
    id
  );
}

function fileRow(id: string, ownerUserId: string, sha: string): Record<string, unknown> {
  return buildRow(
    files,
    {
      id,
      sha256: sha,
      size: 9_007_199_254_740_991,
      mime: 'image/png',
      ext: 'png',
      ownerUserId,
      systemOwner: null,
      status: 'active',
      visibility: 'private',
      purpose: 'user',
      storageKey: 'assets/x',
      originalName: HOSTILE_TEXT,
      // `jsonb` with nesting, unicode and reserved characters inside strings.
      metadata: {
        width: 100,
        nested: { deep: ['a\tb', 'c\nd', '中文', '"q"'] },
        nullable: null,
        flag: true,
      },
      createdAt: new Date('2026-01-02T03:04:05.678Z'),
      updatedAt: new Date('2026-01-02T03:04:05.678Z'),
    },
    id
  );
}

describe('the COPY encoder agrees with drizzle parameter binding', () => {
  const COPY_USER = '68c1000000000000000000a1';
  const BIND_USER = '68c1000000000000000000a2';

  beforeAll(async () => {
    const client = getPostgresClient();
    await client.unsafe('truncate table users cascade');

    // Path A — COPY.
    await copyRowsInto(client, users, [userRow(COPY_USER)]);
    // Path B — drizzle's own binding, the reference implementation.
    await db.insert(users).values(userRow(BIND_USER)).onConflictDoNothing();
  });

  it('stores identical values for every column except the id and identifiers', async () => {
    const [copied] = await db.select().from(users).where(eq(users.id, COPY_USER));
    const [bound] = await db.select().from(users).where(eq(users.id, BIND_USER));
    expect(copied).toBeDefined();
    expect(bound).toBeDefined();
    if (!copied || !bound) throw new Error('unreachable');

    const ignored = new Set(['id', 'username', 'email', 'hashedEmail', 'hashedPhone']);
    let compared = 0;
    for (const key of Object.keys(bound)) {
      if (ignored.has(key)) continue;
      compared += 1;
      // Naming the column is the point: a divergence has to be actionable.
      expect({ [key]: copied[key as keyof typeof copied] }).toEqual({
        [key]: bound[key as keyof typeof bound],
      });
    }
    // Vacuity floor — a loop over zero keys would pass silently.
    expect(compared).toBeGreaterThan(70);
  });

  it('round-trips the hostile text exactly, not merely equally', async () => {
    const [copied] = await db.select().from(users).where(eq(users.id, COPY_USER));
    expect(copied?.bio).toBe(HOSTILE_TEXT);
    expect(copied?.nameFirst).toBe('Ná\tte');
  });

  it('round-trips a text[] whose elements contain commas, quotes and braces', async () => {
    const [copied] = await db.select().from(users).where(eq(users.id, COPY_USER));
    expect(copied?.links).toEqual([
      'https://a.example',
      'has,comma',
      'has"quote',
      'has{brace}',
      // The literal string "NULL", NOT a SQL NULL — quoting is what keeps them
      // distinguishable in an array literal.
      'NULL',
    ]);
  });
});

describe('jsonb, bigint and numeric survive COPY', () => {
  const OWNER = '68c2000000000000000000a1';
  const COPY_FILE = '68c2000000000000000000b1';
  const BIND_FILE = '68c2000000000000000000b2';

  beforeAll(async () => {
    const client = getPostgresClient();
    await client.unsafe('truncate table users cascade');
    await copyRowsInto(client, users, [userRow(OWNER)]);
    await copyRowsInto(client, files, [fileRow(COPY_FILE, OWNER, 'a'.repeat(64))]);
    await db.insert(files).values(fileRow(BIND_FILE, OWNER, 'b'.repeat(64))).onConflictDoNothing();
  });

  it('stores the same jsonb structure by both paths', async () => {
    const [copied] = await db.select().from(files).where(eq(files.id, COPY_FILE));
    const [bound] = await db.select().from(files).where(eq(files.id, BIND_FILE));
    expect(copied?.metadata).toEqual(bound?.metadata);
    expect(copied?.metadata).toEqual({
      width: 100,
      nested: { deep: ['a\tb', 'c\nd', '中文', '"q"'] },
      nullable: null,
      flag: true,
    });
  });

  it('keeps a bigint at the top of the safe-integer range', async () => {
    const [copied] = await db.select().from(files).where(eq(files.id, COPY_FILE));
    expect(copied?.size).toBe(9_007_199_254_740_991);
  });

  it('keeps a numeric(38,8) balance exact', async () => {
    const client = getPostgresClient();
    const walletRow = buildRow(
      wallets,
      {
        id: '68c2000000000000000000c1',
        userId: OWNER,
        balance: '12345678901234567890.12345678',
        address: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
      '68c2000000000000000000c1'
    );
    await copyRowsInto(client, wallets, [walletRow]);
    const [stored] = await db.select().from(wallets);
    expect(stored?.balance).toBe('12345678901234567890.12345678');
  });

  it('keeps a bytea byte-identical', async () => {
    const client = getPostgresClient();
    // Every byte class: NUL-adjacent, escape-adjacent, high bytes.
    const bytes = Buffer.from([0x01, 0x09, 0x0a, 0x0d, 0x5c, 0x7f, 0x80, 0xff]);
    await copyRowsInto(client, webauthnCredentials, [
      buildRow(
        webauthnCredentials,
        {
          id: '68c2000000000000000000d1',
          userId: OWNER,
          credentialID: 'cred-copy',
          credentialPublicKey: bytes,
          counter: 0,
          transports: null,
          deviceType: 'multiDevice',
          backedUp: false,
          userVerified: false,
          name: 'Key',
          createdAt: new Date(0),
          lastUsedAt: null,
        },
        '68c2000000000000000000d1'
      ),
    ]);
    const [stored] = await db.select().from(webauthnCredentials);
    expect(Buffer.from(stored?.credentialPublicKey ?? [])).toEqual(bytes);
  });
});

describe('column grouping preserves "omitted" as distinct from "null"', () => {
  it('splits rows by which columns they supply', () => {
    const groups = groupByColumnSet([
      { id: 'a', name: 'x' },
      { id: 'b', name: 'y' },
      // No `name` — the column default must apply, which is a different answer
      // from writing NULL into it.
      { id: 'c' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.properties)).toEqual([['id', 'name'], ['id']]);
  });

  it('treats key ORDER as irrelevant to the signature', () => {
    const groups = groupByColumnSet([
      { id: 'a', name: 'x' },
      { name: 'y', id: 'b' },
    ]);
    expect(groups).toHaveLength(1);
  });
});

describe('encodeCopyValue', () => {
  it('renders NULL as \\N, not as an empty string', () => {
    // An empty string is a VALUE; conflating the two would turn every absent
    // optional into `''` — the exact mistake CONVENTIONS.md warns about for
    // sparse unique columns.
    expect(encodeCopyValue(null, 'text')).toBe('\\N');
    expect(encodeCopyValue('', 'text')).toBe('');
  });

  it('escapes exactly the four reserved characters', () => {
    expect(encodeCopyValue('a\tb\nc\rd\\e', 'text')).toBe('a\\tb\\nc\\rd\\\\e');
  });

  it('disambiguates a JS array by the COLUMN type, which the value cannot do', () => {
    // The same JS value is a Postgres array literal in one column and a JSON
    // array in another.
    expect(encodeCopyValue(['a', 'b'], 'text[]')).toBe('{"a","b"}');
    expect(encodeCopyValue(['a', 'b'], 'jsonb')).toBe('["a","b"]');
  });

  it('renders booleans and dates in the forms Postgres parses', () => {
    expect(encodeCopyValue(true, 'boolean')).toBe('t');
    expect(encodeCopyValue(false, 'boolean')).toBe('f');
    expect(encodeCopyValue(new Date('2026-01-02T03:04:05.678Z'), 'timestamp with time zone')).toBe(
      '2026-01-02T03:04:05.678Z'
    );
  });

  it('renders bytea in hex-input format', () => {
    expect(encodeCopyValue(Buffer.from([0xde, 0xad]), 'bytea')).toBe('\\\\xdead');
  });

  it('refuses a value it cannot encode rather than stringifying it', () => {
    expect(() => encodeCopyValue(Symbol('x'), 'text')).toThrow(/Cannot encode symbol/);
  });
});

describe('a crashed run does not poison the next one', () => {
  /**
   * The staging table name is `pid + counter`, and in a container the pid is 1
   * and the counter restarts at 0 — so every run generates the SAME names. The
   * loader drops each one when it finishes, but a run that dies hard never gets
   * there: the first production backfill attempt aborted on a foreign-key
   * violation mid-level-2 and left its staging tables behind. The next run then
   * failed with `relation "oxy_backfill_stage_1_51" already exists`, nowhere
   * near the collection at fault.
   *
   * `bulkLoad.ts`'s own header calls idempotence — "safe to re-run" — the whole
   * reason the COPY is followed by an INSERT rather than used directly. A
   * leftover table breaks that claim on the one path it exists to protect.
   *
   * The test squats on the name the loader is about to use, which is what makes
   * it a regression test rather than a restatement: without the drop-first, the
   * CREATE raises 42P07 and this fails with that exact message.
   */
  it('reclaims a staging table an aborted run left behind', async () => {
    const client = getPostgresClient();
    // The name the loader is ABOUT to use, not a guessed one. A guess passes
    // with or without the fix — measured: with `_9999` the drop-first mutation
    // stayed green, because the counter never reaches it.
    const squatted = peekNextStagingName();
    await client.unsafe(`drop table if exists "${squatted}"`);
    // Deliberately the WRONG shape, so a load that reused it instead of
    // recreating it would fail on the columns rather than silently pass.
    await client.unsafe(`create unlogged table "${squatted}" (wrong_column text)`);

    try {
      const owner = await copyRowsInto(client, users, [
        buildRow(users, { id: 'stale-staging-owner', username: 'stale-staging-owner' }),
      ]);
      expect(owner).toBe(1);

      const [row] = await db.select().from(users).where(eq(users.id, 'stale-staging-owner'));
      expect(row?.username).toBe('stale-staging-owner');
    } finally {
      await client.unsafe(`drop table if exists "${squatted}"`);
      await db.delete(users).where(eq(users.id, 'stale-staging-owner'));
    }
  });
});
