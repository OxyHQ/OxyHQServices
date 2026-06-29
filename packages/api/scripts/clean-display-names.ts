#!/usr/bin/env bun
/**
 * One-time migration: clean `name.first` / `name.last` on all existing User
 * documents to the display-name character policy.
 *
 * Why it exists:
 *   Display names accumulated junk before the character policy existed: emoji
 *   (`nixCraft 🐧`), symbols (`Dabid ⁂`, `Axe vert de La Ramée ⏚`), and
 *   `:emoji:` shortcodes (`Laura :bongoCat:`). New writes are now validated
 *   (native → 400) or stripped (federated → cleanDisplayName), but rows written
 *   before that change still carry the garbage. This backfills them.
 *
 * Behavior:
 *   - Iterates User documents that have `name.first` or `name.last`.
 *   - For each field: DECODE existing HTML entities FIRST (older rows were
 *     stored HTML-escaped, e.g. `O&#x27;Brien` / `A&amp;B`), THEN run
 *     `cleanDisplayName`. Decoding first prevents corrupting a previously
 *     escaped name into mojibake.
 *   - If the cleaned value differs from what is stored, queues a `$set` (or a
 *     `$unset` of that subfield when the cleaned value is empty, e.g. an
 *     emoji-only name).
 *   - Writes via `bulkWrite({ ordered: false })` with no validators so no other
 *     Mongoose hooks fire.
 *   - Idempotent — safe to re-run; a row already clean produces no update.
 *
 * Run:
 *   cd packages/api && bun run scripts/clean-display-names.ts
 *
 * Optional env:
 *   MONGODB_URI    Mongo connection string (required)
 *   BATCH_SIZE     Number of users to scan per batch (default 500)
 *   DRY_RUN=true   Report what would change without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { cleanDisplayName } from '../src/utils/displayNameSanitize';
import { decodeHtmlEntities } from '../src/utils/sanitize';
import { logger } from '../src/utils/logger';

dotenv.config();

interface CleanStats {
  scanned: number;
  updatedFirst: number;
  updatedLast: number;
  clearedFirst: number;
  clearedLast: number;
  errors: number;
}

/**
 * Decode-then-clean a single stored name part.
 *
 * Returns the cleaned value when it differs from `stored` (caller writes it),
 * or `undefined` when the value is already clean (caller skips it). An empty
 * string result means the part should be unset.
 */
function resolveCleaned(stored: unknown): string | undefined {
  if (typeof stored !== 'string' || stored.length === 0) {
    return undefined;
  }
  const cleaned = cleanDisplayName(decodeHtmlEntities(stored));
  return cleaned === stored ? undefined : cleaned;
}

async function cleanDisplayNames(): Promise<CleanStats> {
  const stats: CleanStats = {
    scanned: 0,
    updatedFirst: 0,
    updatedLast: 0,
    clearedFirst: 0,
    clearedLast: 0,
    errors: 0,
  };

  const batchSize = Number(process.env.BATCH_SIZE) || 500;
  const dryRun = process.env.DRY_RUN === 'true';

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const cursor = User.find(
    {
      $or: [
        { 'name.first': { $exists: true, $nin: [null, ''] } },
        { 'name.last': { $exists: true, $nin: [null, ''] } },
      ],
    },
    {
      _id: 1,
      'name.first': 1,
      'name.last': 1,
    },
  )
    .lean()
    .cursor({ batchSize });

  const pending: Array<{
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: { $set?: Record<string, string>; $unset?: Record<string, ''> };
    };
  }> = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    if (dryRun) {
      pending.length = 0;
      return;
    }
    try {
      await User.bulkWrite(pending, { ordered: false });
    } catch (error) {
      stats.errors += pending.length;
      logger.error(
        'bulkWrite failed during display-name cleanup',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'clean-display-names', method: 'flush' },
      );
    } finally {
      pending.length = 0;
    }
  };

  for await (const doc of cursor) {
    stats.scanned += 1;

    const name = (doc as { name?: { first?: unknown; last?: unknown } }).name;
    const $set: Record<string, string> = {};
    const $unset: Record<string, ''> = {};

    const cleanedFirst = resolveCleaned(name?.first);
    if (cleanedFirst !== undefined) {
      if (cleanedFirst === '') {
        $unset['name.first'] = '';
        stats.clearedFirst += 1;
      } else {
        $set['name.first'] = cleanedFirst;
        stats.updatedFirst += 1;
      }
    }

    const cleanedLast = resolveCleaned(name?.last);
    if (cleanedLast !== undefined) {
      if (cleanedLast === '') {
        $unset['name.last'] = '';
        stats.clearedLast += 1;
      } else {
        $set['name.last'] = cleanedLast;
        stats.updatedLast += 1;
      }
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      continue;
    }

    const update: { $set?: Record<string, string>; $unset?: Record<string, ''> } = {};
    if (Object.keys($set).length > 0) update.$set = $set;
    if (Object.keys($unset).length > 0) update.$unset = $unset;

    pending.push({
      updateOne: {
        filter: { _id: doc._id as mongoose.Types.ObjectId },
        update,
      },
    });

    if (pending.length >= batchSize) {
      await flush();
    }
  }

  await flush();

  return stats;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }

  await mongoose.connect(uri);
  logger.info('Connected to MongoDB');

  try {
    const startedAt = Date.now();
    const stats = await cleanDisplayNames();
    const elapsedMs = Date.now() - startedAt;
    // pino emits this as a single structured JSON line in production — the
    // machine-readable summary for one-shot ECS log scraping.
    logger.info('Display-name cleanup finished', {
      ...stats,
      elapsedMs,
    });
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Display-name cleanup failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'clean-display-names', method: 'main' },
  );
  process.exit(1);
});
