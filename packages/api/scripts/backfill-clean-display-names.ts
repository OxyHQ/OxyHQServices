#!/usr/bin/env bun
/**
 * One-time migration: re-apply the display-name character policy to every
 * stored `name.*` field.
 *
 * Why it exists:
 *   The policy's script allowlist was expressed as `Script_Extensions` alone
 *   (`scx=Latin` … `scx=Han`) and never intersected with General_Category L. A
 *   Unicode script is not only its letters — `scx=X` also carries script X's own
 *   digits, punctuation and symbols — so the allowlist admitted 1831 non-letter
 *   code points that the policy documents as removed: script digits (`٥`, `०`),
 *   1082 symbols (`֍ ۞ ৳`), 180 punctuation marks (`։ ، ؛ ।`), and 9 INVISIBLE
 *   format/control characters, among them U+061C ARABIC LETTER MARK — a bidi
 *   control that can visually reorder a rendered name.
 *
 *   The allowlist is now generated as `scripts ∩ L`, so every write site
 *   (`cleanDisplayName` on federated ingest, `isValidDisplayName` on native
 *   writes) rejects those. Rows written before the fix still hold them. Federated
 *   actors would eventually self-heal on their next federation resolve, but
 *   native rows never would and dormant federated rows could sit dirty
 *   indefinitely — hence this backfill.
 *
 * Scope note — what this does NOT fix:
 *   A character policy cannot see words. Code points that are formally letters
 *   but read as symbols (`卐` U+5350, `卍` U+534D — CJK Unified Ideographs) and
 *   slurs spelled in ordinary letters both survive this pass by construction.
 *   Those need a code-point denylist and a word-level moderation layer
 *   respectively; do not widen this script to chase them.
 *
 * Behavior:
 *   - Cursors over `users` holding any non-empty `name.first` / `name.last` /
 *     `name.full` / `name.displayName`.
 *   - Recomputes `cleanDisplayName(value)` per present field. A changed value is
 *     `$set`; a value that cleans away to nothing is `$unset` rather than stored
 *     as an empty string, so the DTO serializer omits it and consumers fall back
 *     to the handle (the documented contract) instead of rendering a blank name.
 *   - Writes via `bulkWrite({ ordered: false })` in batches — no validators or
 *     other hooks fire, so the pre-validate hooks that recompute hashed contact
 *     fields are not triggered.
 *   - Idempotent — `cleanDisplayName` is a no-op on already-clean text, so a
 *     second run updates nothing.
 *
 * Run (one-shot ECS task, same shape as the reputation migration):
 *   cd packages/api && bun run scripts/backfill-clean-display-names.ts
 *
 * Optional env:
 *   MONGODB_URI    Mongo connection string (required)
 *   BATCH_SIZE     Number of users to scan/flush per batch (default 500)
 *   DRY_RUN=true   Report what would change without writing. Also logs a sample
 *                  of before/after pairs so the blast radius is reviewable
 *                  BEFORE any write — always run this first.
 *   SAMPLE_SIZE    How many before/after pairs to log (default 25)
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../src/models/User';
import { cleanDisplayName } from '../src/utils/displayNameSanitize';
import { logger } from '../src/utils/logger';

dotenv.config();

/**
 * The stored structured-name fields. All four are human-name text subject to the
 * same character policy; `username` is deliberately excluded (strict ASCII
 * charset, and an identity field this migration must never rewrite).
 */
const NAME_FIELDS = ['first', 'last', 'full', 'displayName'] as const;
type NameField = (typeof NAME_FIELDS)[number];

interface BackfillStats {
  scanned: number;
  fieldsCleaned: number;
  fieldsEmptied: number;
  documentsUpdated: number;
  errors: number;
}

/**
 * One logged before/after pair. A `type` alias rather than an `interface` so it
 * satisfies the logger's `LogContext` index signature — an interface is open to
 * declaration merging and so never gets an implicit one.
 */
type SampleEntry = {
  userId: string;
  field: NameField;
  before: string;
  after: string;
};

async function backfillDisplayNames(): Promise<{
  stats: BackfillStats;
  sample: SampleEntry[];
}> {
  const stats: BackfillStats = {
    scanned: 0,
    fieldsCleaned: 0,
    fieldsEmptied: 0,
    documentsUpdated: 0,
    errors: 0,
  };

  const batchSize = Number(process.env.BATCH_SIZE) || 500;
  const sampleSize = Number(process.env.SAMPLE_SIZE) || 25;
  const dryRun = process.env.DRY_RUN === 'true';
  const sample: SampleEntry[] = [];

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const cursor = User.find(
    {
      $or: NAME_FIELDS.map((field) => ({
        [`name.${field}`]: { $type: 'string', $ne: '' },
      })),
    },
    { _id: 1, name: 1 },
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
        'bulkWrite failed during display-name backfill',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'backfill', method: 'flush' },
      );
    } finally {
      pending.length = 0;
    }
  };

  for await (const doc of cursor) {
    stats.scanned += 1;

    const storedName = (doc as { name?: Record<string, unknown> }).name;
    if (!storedName || typeof storedName !== 'object') continue;

    const $set: Record<string, string> = {};
    const $unset: Record<string, ''> = {};

    for (const field of NAME_FIELDS) {
      const raw = storedName[field];
      if (typeof raw !== 'string' || raw === '') continue;

      const cleaned = cleanDisplayName(raw);
      if (cleaned === raw) continue;

      stats.fieldsCleaned += 1;
      if (sample.length < sampleSize) {
        sample.push({
          userId: String(doc._id),
          field,
          before: raw,
          after: cleaned,
        });
      }

      // A name that cleans away entirely is UNSET, not stored as ''. The DTO
      // serializer omits absent fields and consumers fall back to the handle;
      // an empty string would instead render as a blank name.
      if (cleaned === '') {
        stats.fieldsEmptied += 1;
        $unset[`name.${field}`] = '';
      } else {
        $set[`name.${field}`] = cleaned;
      }
    }

    const hasSet = Object.keys($set).length > 0;
    const hasUnset = Object.keys($unset).length > 0;
    if (!hasSet && !hasUnset) continue;

    stats.documentsUpdated += 1;
    pending.push({
      updateOne: {
        filter: { _id: doc._id as mongoose.Types.ObjectId },
        update: {
          ...(hasSet ? { $set } : {}),
          ...(hasUnset ? { $unset } : {}),
        },
      },
    });

    if (pending.length >= batchSize) {
      await flush();
    }
  }

  await flush();

  return { stats, sample };
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
    const { stats, sample } = await backfillDisplayNames();
    const elapsedMs = Date.now() - startedAt;
    const summary = { ...stats, elapsedMs, dryRun: process.env.DRY_RUN === 'true' };

    for (const entry of sample) {
      logger.info('display-name change', entry);
    }
    logger.info('Display-name backfill finished', summary);
    // Final machine-readable summary for one-shot ECS log scraping.
    process.stdout.write(`${JSON.stringify({ ...summary, sample })}\n`);
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
