#!/usr/bin/env bun
/**
 * One-time migration: decode/clean the free-text profile fields that were
 * historically stored HTML-entity-ESCAPED.
 *
 * Why it exists:
 *   `bio`, `description`, and `address` used to be run through `sanitizeHtml`
 *   on every write site (federated resolve, PUT /users/resolve, and the local
 *   profile-update path via `sanitizeProfileUpdate`). These fields render as
 *   TEXT in RN/React clients, which auto-escape markup at render time — so the
 *   entity-escaping double-escaped them and surfaced literal `&#x27;` / `&amp;`
 *   to users (e.g. bagder's bio: "I don&#x27;t know anything.").
 *
 *   The write sites now use `sanitizePlainText` (decode + strip tags), but rows
 *   written before that change still hold escaped values. This backfill applies
 *   `sanitizePlainText` to the stored values so they decode in place.
 *
 * Behavior:
 *   - Cursors over `users` where bio/description/address is a non-empty string.
 *   - Recomputes `sanitizePlainText(value)` for each present field; if it
 *     differs from the stored value, `$set`s the cleaned value.
 *   - Writes via `bulkWrite({ ordered: false })` in batches — no validators or
 *     other hooks fire.
 *   - Idempotent — safe to re-run. `sanitizePlainText` is a no-op on already-
 *     clean text, so a second run updates nothing.
 *
 * Run:
 *   cd packages/api && bun run scripts/backfill-decode-profile-text.ts
 *
 * Optional env:
 *   MONGODB_URI    Mongo connection string (required)
 *   BATCH_SIZE     Number of users to scan/flush per batch (default 500)
 *   DRY_RUN=true   Report what would change without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { sanitizePlainText } from '../src/utils/sanitize';
import { logger } from '../src/utils/logger';

dotenv.config();

// The stored free-text fields that were historically entity-escaped and render
// as TEXT in clients. `username`/`phone`/`language` are excluded: they carry a
// strict charset (never entities/tags) so cleaning is a guaranteed no-op, and
// they are identity/sensitive fields we do not want to rewrite.
const TEXT_FIELDS = ['bio', 'description', 'address'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

interface BackfillStats {
  scanned: number;
  updatedBio: number;
  updatedDescription: number;
  updatedAddress: number;
  documentsUpdated: number;
  errors: number;
}

const STAT_KEY: Record<TextField, keyof BackfillStats> = {
  bio: 'updatedBio',
  description: 'updatedDescription',
  address: 'updatedAddress',
};

async function backfillProfileText(): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    updatedBio: 0,
    updatedDescription: 0,
    updatedAddress: 0,
    documentsUpdated: 0,
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
        { bio: { $type: 'string', $ne: '' } },
        { description: { $type: 'string', $ne: '' } },
        { address: { $type: 'string', $ne: '' } },
      ],
    },
    { _id: 1, bio: 1, description: 1, address: 1 },
  )
    .lean()
    .cursor({ batchSize });

  const pending: Array<{
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: { $set: Record<string, string> };
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
        'bulkWrite failed during profile-text backfill',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'backfill', method: 'flush' },
      );
    } finally {
      pending.length = 0;
    }
  };

  for await (const doc of cursor) {
    stats.scanned += 1;

    const $set: Record<string, string> = {};

    for (const field of TEXT_FIELDS) {
      const raw = (doc as Record<string, unknown>)[field];
      if (typeof raw !== 'string' || raw === '') continue;
      const cleaned = sanitizePlainText(raw);
      if (cleaned !== raw) {
        $set[field] = cleaned;
        stats[STAT_KEY[field]] += 1;
      }
    }

    if (Object.keys($set).length === 0) continue;

    stats.documentsUpdated += 1;
    pending.push({
      updateOne: {
        filter: { _id: doc._id as mongoose.Types.ObjectId },
        update: { $set },
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
    const stats = await backfillProfileText();
    const elapsedMs = Date.now() - startedAt;
    const summary = { ...stats, elapsedMs, dryRun: process.env.DRY_RUN === 'true' };
    logger.info('Profile-text backfill finished', summary);
    // Final machine-readable summary for one-shot ECS log scraping.
    process.stdout.write(`${JSON.stringify(summary)}\n`);
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
