#!/usr/bin/env bun
/**
 * One-shot: drop the TTL index that was DELETING subscription rows.
 *
 * `models/Subscription.ts` used to declare
 * `index({ endDate: 1 }, { expireAfterSeconds: 0 })`. A Mongo TTL index deletes
 * the document; it does not mark it. Every subscription row was therefore
 * destroyed the moment its `endDate` passed — `status: 'expired'` was
 * unreachable, no subscription history survived, and `autoRenew: true` rows were
 * deleted rather than renewed.
 *
 * Removing the declaration does NOT remove the live index: Mongoose's
 * `autoIndex` only ever CREATES declared indexes, it never drops undeclared
 * ones. Until this runs, production keeps deleting rows even with the fixed code
 * deployed. This script is the second half of that fix.
 *
 * SAFETY
 *   - Drops ONLY an index on `{ endDate: 1 }` that actually carries
 *     `expireAfterSeconds`. A plain (non-TTL) `endDate` index is left alone, and
 *     no other index is ever considered.
 *   - Idempotent: re-running once the index is gone reports "already absent" and
 *     writes nothing. Safe if the collection does not exist yet.
 *   - No document is read, written or deleted — this only touches index metadata.
 *   - DRY_RUN=1 (or DRY_RUN=true) prints exactly what would be dropped and exits.
 *
 * The replacement indexes (`{ userId, status, endDate }`, `{ status, endDate }`)
 * are declared on the schema, so the running API creates them via `autoIndex`.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/drop-subscription-ttl-index.ts
 * Or from packages/api:
 *   bun run scripts/drop-subscription-ttl-index.ts
 *
 * Env:
 *   MONGODB_URI   Mongo connection string (required)
 *   DRY_RUN=1     Report the plan, change nothing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const COLLECTION = 'subscriptions';

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('No database handle after connect');
    }

    const collections = await db.listCollections({ name: COLLECTION }).toArray();
    if (collections.length === 0) {
      console.log(`${COLLECTION}: collection does not exist — nothing to drop`);
      return;
    }

    const indexes = await db.collection(COLLECTION).indexes();
    const ttlIndexes = indexes.filter((index) => {
      const key = index.key as Record<string, unknown> | undefined;
      const keyFields = Object.keys(key ?? {});
      return (
        index.expireAfterSeconds !== undefined &&
        keyFields.length === 1 &&
        key?.endDate === 1
      );
    });

    console.log(`${COLLECTION}: ${indexes.length} indexes present`);
    for (const index of indexes) {
      const ttl = index.expireAfterSeconds === undefined
        ? ''
        : ` (TTL expireAfterSeconds=${index.expireAfterSeconds})`;
      console.log(`  - ${index.name}: ${JSON.stringify(index.key)}${ttl}`);
    }

    if (ttlIndexes.length === 0) {
      console.log(`${COLLECTION}: no endDate TTL index — already absent, nothing to do`);
      return;
    }

    for (const index of ttlIndexes) {
      const name = index.name;
      if (typeof name !== 'string') {
        throw new Error(`Refusing to drop an unnamed index: ${JSON.stringify(index)}`);
      }
      if (dryRun) {
        console.log(`[DRY_RUN] would drop TTL index ${name} on ${COLLECTION}`);
        continue;
      }
      await db.collection(COLLECTION).dropIndex(name);
      console.log(`dropped TTL index ${name} on ${COLLECTION}`);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
