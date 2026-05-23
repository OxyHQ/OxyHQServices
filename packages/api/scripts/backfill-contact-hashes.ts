#!/usr/bin/env bun
/**
 * One-time migration: backfill `hashedEmail` and `hashedPhone` on all
 * existing User documents.
 *
 * Why it exists:
 *   The pre-validate hook in `models/User.ts` keeps these fields in sync
 *   going forward, but rows written before the schema change have neither
 *   field set. Contact discovery (`POST /contacts/discover`) requires the
 *   indexes to be populated for matches to be found.
 *
 * Behavior:
 *   - Iterates the `users` collection in batches.
 *   - For each user, computes the hash if the source field is set, and writes
 *     directly to `hashedEmail` / `hashedPhone` using `updateOne` with no
 *     validators (so we don't accidentally trigger other Mongoose hooks).
 *   - Idempotent — safe to re-run. Updates only rows where the hash is
 *     missing OR diverges from the canonical recomputed value.
 *
 * Run:
 *   cd packages/api && bun run scripts/backfill-contact-hashes.ts
 *
 * Optional env:
 *   MONGODB_URI    Mongo connection string (required)
 *   BATCH_SIZE     Number of users to scan per batch (default 500)
 *   DRY_RUN=true   Report what would change without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { maybeHashEmail, maybeHashPhone } from '../src/utils/contactHash';
import { logger } from '../src/utils/logger';

dotenv.config();

interface BackfillStats {
  scanned: number;
  emailUpdates: number;
  phoneUpdates: number;
  combinedUpdates: number;
  clearedEmailHashes: number;
  clearedPhoneHashes: number;
  errors: number;
}

async function backfillContactHashes(): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    emailUpdates: 0,
    phoneUpdates: 0,
    combinedUpdates: 0,
    clearedEmailHashes: 0,
    clearedPhoneHashes: 0,
    errors: 0,
  };

  const batchSize = Number(process.env.BATCH_SIZE) || 500;
  const dryRun = process.env.DRY_RUN === 'true';

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  // Lean cursor includes the hidden hash + phone fields explicitly.
  const cursor = User.find(
    {},
    {
      _id: 1,
      email: 1,
      phone: 1,
      hashedEmail: 1,
      hashedPhone: 1,
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
        'bulkWrite failed during contact-hash backfill',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'backfill', method: 'flush' },
      );
    } finally {
      pending.length = 0;
    }
  };

  for await (const doc of cursor) {
    stats.scanned += 1;

    const desiredEmailHash = maybeHashEmail(doc.email);
    const desiredPhoneHash = maybeHashPhone(doc.phone);
    const existingEmailHash =
      typeof doc.hashedEmail === 'string' ? doc.hashedEmail : undefined;
    const existingPhoneHash =
      typeof doc.hashedPhone === 'string' ? doc.hashedPhone : undefined;

    const $set: Record<string, string> = {};
    const $unset: Record<string, ''> = {};

    if (desiredEmailHash) {
      if (existingEmailHash !== desiredEmailHash) {
        $set.hashedEmail = desiredEmailHash;
        stats.emailUpdates += 1;
      }
    } else if (existingEmailHash) {
      $unset.hashedEmail = '';
      stats.clearedEmailHashes += 1;
    }

    if (desiredPhoneHash) {
      if (existingPhoneHash !== desiredPhoneHash) {
        $set.hashedPhone = desiredPhoneHash;
        stats.phoneUpdates += 1;
      }
    } else if (existingPhoneHash) {
      $unset.hashedPhone = '';
      stats.clearedPhoneHashes += 1;
    }

    if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
      continue;
    }
    if (Object.keys($set).length > 0 && Object.keys($unset).length > 0) {
      stats.combinedUpdates += 1;
    }

    const update: { $set?: Record<string, string>; $unset?: Record<string, ''> } =
      {};
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
    const stats = await backfillContactHashes();
    const elapsedMs = Date.now() - startedAt;
    logger.info('Contact-hash backfill finished', {
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
    'Backfill failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'backfill', method: 'main' },
  );
  process.exit(1);
});
