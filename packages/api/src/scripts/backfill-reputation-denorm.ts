#!/usr/bin/env bun
/**
 * One-time migration: backfill the denormalized reputation fields
 * (`reputationRankWeight`, `reputationTier`) on existing User documents from the
 * authoritative `reputationbalances` collection.
 *
 * Why it exists:
 *   `reputationService.recalculateBalance` keeps these two User fields in sync
 *   with `ReputationBalance.influence.rankingFeedbackWeight` /
 *   `ReputationBalance.trustTier` going forward, but users whose balance was last
 *   recomputed before the denorm change have stale defaults
 *   (`reputationRankWeight = INFLUENCE_MIN`, `reputationTier = 'new'`). The
 *   recommendation scorer joins on these denorm fields, so they must be populated
 *   for the reputation signal and the restricted-floor to take effect.
 *
 * Behavior:
 *   - Iterates the `reputationbalances` collection in batches (one doc per user).
 *   - For each balance, writes `reputationRankWeight` + `reputationTier` onto the
 *     matching User via `updateOne` (no validators / hooks).
 *   - Idempotent — safe to re-run. Updates only users whose denorm values diverge
 *     from the authoritative balance.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/backfill-reputation-denorm.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/backfill-reputation-denorm.js
 *
 * Env:
 *   MONGODB_URI    Mongo connection string (required, injected by ECS from SSM)
 *   NODE_ENV       selects the DB name via getDbName() (e.g. oxy-prod)
 *   BATCH_SIZE     Number of balances to scan per batch (default 500)
 *   DRY_RUN=true   Report what would change without writing
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { ReputationBalance } from '../models/ReputationBalance.js';
import { INFLUENCE_MIN, type TrustTier } from '../utils/reputation.constants.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

interface BackfillStats {
  scanned: number;
  updated: number;
  unchanged: number;
  missingUser: number;
  errors: number;
}

async function backfillReputationDenorm(): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    updated: 0,
    unchanged: 0,
    missingUser: 0,
    errors: 0,
  };

  const batchSize = Number(process.env.BATCH_SIZE) || 500;
  const dryRun = process.env.DRY_RUN === 'true';

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  // Read the authoritative denorm sources straight off each balance.
  const cursor = ReputationBalance.find(
    {},
    {
      _id: 1,
      userId: 1,
      trustTier: 1,
      'influence.rankingFeedbackWeight': 1,
    },
  )
    .lean()
    .cursor({ batchSize });

  const pending: Array<{
    updateOne: {
      filter: { _id: mongoose.Types.ObjectId };
      update: { $set: { reputationRankWeight: number; reputationTier: TrustTier } };
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
        'bulkWrite failed during reputation-denorm backfill',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'backfill', method: 'flush' },
      );
    } finally {
      pending.length = 0;
    }
  };

  for await (const balance of cursor) {
    stats.scanned += 1;

    const userId = balance.userId as mongoose.Types.ObjectId | undefined;
    if (!userId) {
      stats.missingUser += 1;
      continue;
    }

    const rankWeight =
      typeof balance.influence?.rankingFeedbackWeight === 'number'
        ? balance.influence.rankingFeedbackWeight
        : INFLUENCE_MIN;
    const tier: TrustTier = balance.trustTier ?? 'new';

    // Only write when the user's current denorm diverges from the balance.
    const user = await User.findById(userId)
      .select('reputationRankWeight reputationTier')
      .lean();

    if (!user) {
      stats.missingUser += 1;
      continue;
    }

    const currentWeight =
      typeof user.reputationRankWeight === 'number' ? user.reputationRankWeight : undefined;
    const currentTier = user.reputationTier;

    if (currentWeight === rankWeight && currentTier === tier) {
      stats.unchanged += 1;
      continue;
    }

    stats.updated += 1;
    pending.push({
      updateOne: {
        filter: { _id: userId },
        update: { $set: { reputationRankWeight: rankWeight, reputationTier: tier } },
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

  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  logger.info('Connected to MongoDB', { dbName });

  try {
    const startedAt = Date.now();
    const stats = await backfillReputationDenorm();
    const elapsedMs = Date.now() - startedAt;
    logger.info('Reputation-denorm backfill finished', {
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
