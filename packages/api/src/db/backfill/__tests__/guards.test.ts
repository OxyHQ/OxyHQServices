/**
 * The two guards that stand between a transform and silent data loss.
 *
 * Both are MUTATION-TESTED in the sense that matters: each case breaks the
 * thing the guard protects and asserts the guard goes red AND names the
 * offending table/column/method. A guard that throws on everything would pass a
 * "it throws" test, so every block also asserts the legitimate path still
 * works.
 */

import { files, users, userLocations } from '../../schema';
import { BackfillRowError, buildRow, tableShape } from '../rowBuilder';
import {
  MongoWriteAttemptError,
  READ_METHODS,
  checkpointOf,
  readOnlyCollection,
  reviveCheckpoint,
} from '../mongoSource';
import { BackfillValueError, decimal, isObjectId, jsonObject, numberMap, str } from '../values';
import { oid } from '../mongoTestSource';

describe('buildRow — drizzle silently ignores an unknown key', () => {
  it('accepts a well-formed row', () => {
    const row = buildRow(
      files,
      {
        id: '68a1000000000000000000aa',
        sha256: 'a'.repeat(64),
        size: 12,
        mime: 'image/png',
        ext: 'png',
        ownerUserId: '68a1000000000000000000bb',
        systemOwner: null,
        storageKey: 'k',
      },
      '68a1000000000000000000aa'
    );
    expect(row.sha256).toBe('a'.repeat(64));
  });

  it('THROWS on a key that is not a column, naming the table and the key', () => {
    // This is the trap: drizzle would drop `ownerUserID` and insert a row with a
    // NULL owner, with no error anywhere.
    expect(() =>
      buildRow(files, { id: 'x', sha256: 's', size: 1, mime: 'm', ext: 'e', storageKey: 'k', ownerUserID: 'oops' }, 'x')
    ).toThrow(BackfillRowError);
    expect(() =>
      buildRow(files, { id: 'x', sha256: 's', size: 1, mime: 'm', ext: 'e', storageKey: 'k', ownerUserID: 'oops' }, 'x')
    ).toThrow(/files\.ownerUserID.*DROPPED it silently/s);
  });

  it('THROWS on a dot path copied straight from Mongo', () => {
    expect(() =>
      buildRow(users, { id: 'u1', 'name.first': 'Nate' }, 'u1')
    ).toThrow(/users\.name\.first/);
  });

  it('THROWS on a GENERATED column', () => {
    // Postgres would reject it with SQLSTATE 428C9 — but only once the batch
    // reached the server, hours into a run.
    expect(() => buildRow(users, { id: 'u1', hashedEmail: 'deadbeef' }, 'u1')).toThrow(
      /users\.hashedEmail.*GENERATED ALWAYS/s
    );
    expect(() => buildRow(userLocations, { id: 'l1', userId: 'u1', locationKey: 'k', name: 'n', searchVector: 'x' }, 'l1')).toThrow(
      /searchVector.*GENERATED ALWAYS/s
    );
  });

  it('THROWS on `undefined`, because null and omission are different answers', () => {
    expect(() => buildRow(users, { id: 'u1', username: undefined }, 'u1')).toThrow(
      /users\.username.*Supply `null`.*OMIT the key/s
    );
    // …and omitting the key is accepted, so the guard is not simply refusing
    // everything.
    expect(buildRow(users, { id: 'u1' }, 'u1')).toEqual({ id: 'u1' });
  });

  it('THROWS when a NOT NULL column with no default is missing', () => {
    expect(() => buildRow(files, { id: 'f1', sha256: 's', size: 1, mime: 'm', ext: 'e' }, 'f1')).toThrow(
      /files\.storageKey.*NOT NULL with no default.*supplied nothing/s
    );
  });

  it('distinguishes a supplied null from an absent key in the message', () => {
    expect(() =>
      buildRow(files, { id: 'f1', sha256: 's', size: 1, mime: 'm', ext: 'e', storageKey: null }, 'f1')
    ).toThrow(/storageKey.*supplied null/s);
  });

  it('reads the table shape from live drizzle metadata, not a hand-written list', () => {
    const shape = tableShape(files);
    expect(shape.properties.has('systemOwner')).toBe(true);
    expect(shape.required.has('storageKey')).toBe(true);
    // `status` is NOT NULL but HAS a default, so it is not required of a row.
    expect(shape.required.has('status')).toBe(false);
    expect(tableShape(users).generated.has('hashedEmail')).toBe(true);
  });
});

describe('readOnlyCollection — MongoDB access is a control, not a promise', () => {
  /** A stand-in with both read and write methods, so the guard has to choose. */
  function fakeDriverCollection(): Record<string, unknown> {
    return {
      collectionName: 'users',
      find: () => 'found',
      countDocuments: () => 7,
      distinct: () => ['a'],
      aggregate: () => [],
      // The write half, one keystroke from the read half.
      deleteMany: () => 'DELETED',
      insertOne: () => 'INSERTED',
      updateMany: () => 'UPDATED',
      findOneAndUpdate: () => 'UPDATED',
      drop: () => 'DROPPED',
    };
  }

  function wrap(): Record<string, unknown> {
    // The guard is generic over the driver's shape; the fake stands in for a
    // real `Collection` so the test does not need a live server.
    const fake = fakeDriverCollection() as unknown as Parameters<typeof readOnlyCollection>[0];
    return readOnlyCollection(fake) as unknown as Record<string, unknown>;
  }

  it.each(['deleteMany', 'insertOne', 'updateMany', 'findOneAndUpdate', 'drop'])(
    'refuses %s at ACCESS time, before any call',
    (method) => {
      const collection = wrap();
      // Merely TAKING the reference throws — there is no window in which a
      // write function exists as a value.
      expect(() => collection[method]).toThrow(MongoWriteAttemptError);
      expect(() => collection[method]).toThrow(new RegExp(`users\\.${method}`));
    }
  );

  it('still resolves every read method — the guard is not just refusing everything', () => {
    const collection = wrap();
    // Without this the test above would pass against a Proxy that throws on
    // absolutely everything, which would be a broken guard, not a strict one.
    expect(typeof collection.find).toBe('function');
    expect(typeof collection.countDocuments).toBe('function');
    expect(typeof collection.distinct).toBe('function');
    expect(typeof collection.aggregate).toBe('function');
  });

  it('refuses a method the driver does not have yet — the allowlist is closed', () => {
    const collection = wrap();
    expect(() => collection.replaceOneWithSomethingNew).toThrow(MongoWriteAttemptError);
    expect(READ_METHODS).not.toContain('replaceOneWithSomethingNew');
  });
});

describe('checkpoints carry the BSON type of the `_id`', () => {
  it('records an ObjectId as an ObjectId', () => {
    const checkpoint = checkpointOf({ _id: oid('68a1000000000000000000aa') });
    expect(checkpoint).toEqual({ value: '68a1000000000000000000aa', kind: 'objectId' });
    expect(isObjectId(reviveCheckpoint(checkpoint))).toBe(true);
  });

  it('records a 24-hex STRING `_id` as a string, not an ObjectId', () => {
    // `usercredits._id` is a userId hex stored as a BSON String. Inferring
    // "looks like hex ⇒ ObjectId" would make `{$gt: ObjectId(…)}` match nothing
    // at all — silently — and every resumed run would report "0 remaining".
    const checkpoint = checkpointOf({ _id: '68a1000000000000000000aa' });
    expect(checkpoint).toEqual({ value: '68a1000000000000000000aa', kind: 'string' });
    expect(reviveCheckpoint(checkpoint)).toBe('68a1000000000000000000aa');
  });

  it('records a SHA-256 string `_id` as a string', () => {
    const checkpoint = checkpointOf({ _id: 'f'.repeat(64) });
    expect(checkpoint.kind).toBe('string');
  });
});

describe('value coercion refuses rather than guesses', () => {
  it('throws on a wrong type instead of coercing it', () => {
    expect(() => str({ _id: 'x', n: 3 }, 'n')).toThrow(BackfillValueError);
    expect(() => str({ _id: 'x', n: 3 }, 'n')).toThrow(/expected a string, got number/);
  });

  it('reports the source `_id` in the message', () => {
    expect(() => str({ _id: 'doc-42', n: 3 }, 'n')).toThrow(/source _id doc-42/);
  });

  it('rejects a non-numeric entry in a number map', () => {
    // The CHECK on these columns only asserts `jsonb_typeof(...) = 'object'`, so
    // a string value would pass the constraint and corrupt whatever reads it.
    expect(() => numberMap({ _id: 'x', m: { a: 1, b: 'two' } }, 'm')).toThrow(/m\.b.*finite number/s);
    expect(numberMap({ _id: 'x', m: { a: 1 } }, 'm')).toEqual({ a: 1 });
  });

  it('renders a numeric(38,8) money column at the declared scale', () => {
    expect(decimal({ _id: 'x', balance: 12.5 }, 'balance')).toBe('12.50000000');
    expect(decimal({ _id: 'x' }, 'balance')).toBeNull();
  });

  it('converts a Mongoose Map rather than serializing it as {}', () => {
    // `JSON.stringify(new Map([['a',1]]))` is `{}` — a naive port stores an
    // empty object and nothing complains.
    expect(jsonObject({ _id: 'x', headers: new Map([['a', '1']]) }, 'headers')).toEqual({ a: '1' });
  });
});
