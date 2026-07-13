#!/usr/bin/env bun
/**
 * One-shot, idempotent seed of `User.languages` from the legacy singular
 * `language` field.
 *
 * The account language model moved from a singular `language` (bare or BCP-47)
 * to `languages: string[]` — an ordered list of full BCP-47 locales, PRIMARY
 * first, and the ONLY language field. This script backfills existing accounts
 * that predate the change, reading the RAW legacy `language` value before it is
 * removed from documents.
 *
 * Per user (only those WITHOUT a populated `languages` array):
 *   - `languages = [locale]` where `locale` is resolved from the legacy value:
 *       1. a valid BCP-47 locale (`normalizeLocale`)               → that locale
 *       2. a bare / non-locale code (e.g. `es`) → the default locale of that
 *          base language (first SUPPORTED_LANGUAGES entry whose `.language`
 *          matches), e.g. `es` → `es-ES`
 *       3. missing / unresolvable                                  → FALLBACK_LOCALE (`en-US`)
 *   - the legacy singular `language` field is `$unset` in the same write, so no
 *     document keeps a value that the `locations` text index could read as a
 *     text-search language (error 17262).
 *
 * Safety:
 *   - No deletes, no drops.
 *   - Idempotent: only documents missing a non-empty `languages` array are
 *     touched, so re-running performs 0 writes.
 *   - `DRY_RUN=true` reports the plan without writing.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/seed-user-languages.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/seed-user-languages.js
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   NODE_ENV      selects the DB name via getDbName()
 *   DRY_RUN=true  plan only, no writes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { resolveSeedLocale } from '../utils/userLanguageSeed.js';

dotenv.config();

/** Legacy on-disk user shape this script reads directly (schema-independent). */
interface LegacyUserDoc {
  _id: mongoose.Types.ObjectId;
  language?: unknown;
  languages?: unknown;
}

/** Flush a bulk batch every N operations to bound memory on large collections. */
const BATCH_SIZE = 1000;

interface BulkUpdateOne {
  updateOne: {
    filter: { _id: mongoose.Types.ObjectId };
    update: { $set: { languages: string[] }; $unset: { language: '' } };
  };
}

async function seed(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No active MongoDB connection');
  }

  const users = db.collection<LegacyUserDoc>('users');

  // Only accounts without a populated `languages` array need seeding. This makes
  // the script naturally idempotent — a second run matches nothing.
  const filter = {
    $or: [{ languages: { $exists: false } }, { languages: { $size: 0 } }],
  };

  const total = await users.countDocuments(filter);
  logger.info('Accounts needing a languages backfill', { count: total });

  const cursor = users
    .find(filter, { projection: { language: 1, languages: 1 } })
    .batchSize(BATCH_SIZE);

  let scanned = 0;
  let updated = 0;
  let batch: BulkUpdateOne[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    if (!dryRun) {
      await users.bulkWrite(batch, { ordered: false });
    }
    updated += batch.length;
    batch = [];
    logger.info('Backfill progress', { scanned, updated, dryRun });
  };

  for await (const doc of cursor) {
    scanned += 1;
    const locale = resolveSeedLocale(doc.language);
    batch.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { languages: [locale] }, $unset: { language: '' } },
      },
    });
    if (batch.length >= BATCH_SIZE) {
      await flush();
    }
  }
  await flush();

  logger.info('User languages seed summary', { total, scanned, updated, dryRun });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { dbName });

  try {
    await seed();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'User languages seed failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'seed-user-languages', method: 'main' }
  );
  process.exit(1);
});
