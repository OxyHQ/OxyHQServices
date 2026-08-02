/**
 * A throwaway REAL MongoDB for the backfill tests.
 *
 * ## Why a real Mongo and not a fake
 *
 * The audits are the phase most worth testing and they are written in Mongo's
 * query language: `distinct` over a dotted path that crosses an array,
 * `$group` with `$toLower` and `$ifNull`, `find` with `{_id: {$gt: …}}` against
 * both ObjectId and string keys. A hand-written in-memory fake would implement
 * MY understanding of those operators, so every audit test would prove the fake
 * agrees with itself. That is the "check that answers a narrower question"
 * shape, and it is exactly the failure the mutation tests below exist to catch
 * in the verifier — so it would be incoherent to build it in here.
 *
 * A reachable MongoDB is therefore a hard prerequisite of these tests, the same
 * decision `jest.globalSetup.ts` already makes for Postgres and for the same
 * reason: skipping silently when the database is absent is a check that cannot
 * tell success from failure.
 *
 *   docker compose -f docker-compose.dev.yml up -d mongo
 *
 * ## Getting past the global mongoose mock
 *
 * `jest.setup.cjs` mocks `mongoose` wholesale for the whole suite, so
 * `connectMongoSource` (which calls `mongoose.createConnection`) cannot run
 * here. `jest.requireActual('mongoose')` loads the real module for this file
 * only, and `mongoSourceFromDb` takes the resulting driver handle — which is
 * why that constructor is split out of `mongoSource.ts` in the first place.
 */

import { randomBytes } from 'node:crypto';
import { mongoSourceFromDb, type MongoSource } from './mongoSource';

/** Bytes of randomness in a throwaway database name. */
const NAME_ENTROPY_BYTES = 8;

/**
 * The real mongoose module, past the suite-wide mock.
 *
 * Typed through `typeof import('mongoose')` rather than `any`: the mock is a
 * test-harness fact, not a reason to lose types.
 */
function realMongoose(): typeof import('mongoose') {
  return jest.requireActual<typeof import('mongoose')>('mongoose');
}

/** A connected throwaway database plus the handle to drop it. */
export interface MongoTestDatabase {
  readonly source: MongoSource;
  /** Insert fixture documents into a collection. The ONLY write path in tests. */
  seed(collection: string, documents: ReadonlyArray<Record<string, unknown>>): Promise<void>;
  /** Create a collection with no documents, so `listCollections` reports it. */
  createEmpty(collection: string): Promise<void>;
  /** Drop the database and close the connection. */
  drop(): Promise<void>;
}

/**
 * Create a uniquely-named throwaway database on the configured server.
 *
 * `BACKFILL_TEST_MONGODB_URI` wins over `MONGODB_URI` so a developer whose
 * `.env` points at a database with real local data cannot have it used as the
 * server for a `dropDatabase()`. The database NAME is always generated here, so
 * neither variable's path component is ever the thing dropped.
 */
export async function createMongoTestDatabase(): Promise<MongoTestDatabase> {
  const base =
    process.env.BACKFILL_TEST_MONGODB_URI ??
    process.env.MONGODB_URI ??
    'mongodb://127.0.0.1:27017';

  const url = new URL(base);
  url.pathname = `/oxy_backfill_test_${randomBytes(NAME_ENTROPY_BYTES).toString('hex')}`;

  const mongoose = realMongoose();
  const connection = await mongoose
    .createConnection(url.toString(), { serverSelectionTimeoutMS: 10_000 })
    .asPromise();

  const db = connection.db;
  if (!db) {
    await connection.close();
    throw new Error(`Connected to ${base} but no database was selected`);
  }

  const source = mongoSourceFromDb(db, async () => {
    await connection.close();
  });

  return {
    source,
    async seed(collection, documents) {
      if (documents.length === 0) {
        await db.createCollection(collection);
        return;
      }
      await db.collection(collection).insertMany([...documents]);
    },
    async createEmpty(collection) {
      await db.createCollection(collection);
    },
    async drop() {
      await db.dropDatabase();
      await connection.close();
    },
  };
}

/**
 * A real BSON `ObjectId` from a 24-hex string, for fixtures.
 *
 * Fixtures use FIXED ids rather than generated ones so a failure names the same
 * id every run — a generated id turns "row 68a1… is missing" into a value
 * nobody can look up afterwards.
 */
export function oid(hex: string): InstanceType<typeof import('mongoose').Types.ObjectId> {
  return new (realMongoose().Types.ObjectId)(hex);
}
