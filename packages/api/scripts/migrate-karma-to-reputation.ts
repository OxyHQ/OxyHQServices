#!/usr/bin/env bun
/**
 * Idempotent migration: copy the legacy karma system into the new reputation
 * ledger (#217 / #219).
 *
 * For each legacy `Karma` document:
 *   - every `history` entry becomes a `ReputationTransaction` (status 'active').
 *   - the category is taken from the matching `ReputationRule` (by actionType)
 *     when one exists, otherwise inferred: negative points → 'penalty', else
 *     'other'.
 *   - idempotency: a history entry is skipped when a transaction already exists
 *     matching (userId, createdAt, points, actionType).
 *
 * For each legacy `KarmaRule`:
 *   - upsert a `ReputationRule` keyed by actionType (= the old `action`).
 *   - category mapping (old → new):
 *       content   → content
 *       social    → social
 *       system    → trust       (identity / trust-graph signals)
 *       purchases → other       (no real-world receipt in the legacy data)
 *       other     → other
 *     Any other / missing value falls back to 'other'.
 *
 * After copying, `reputationService.recalculateBalance` runs for every affected
 * user so totals/tier/influence reflect the migrated ledger.
 *
 * The legacy `karmas` / `karmarules` collections are NOT dropped — drop them
 * manually after verifying the migration.
 *
 * Safety:
 *   - No deletes, no drops.
 *   - Re-running performs 0 writes once migrated (verified by the summary).
 *   - DRY_RUN=true reports the plan without writing.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/migrate-karma-to-reputation.ts
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   DRY_RUN=true  plan only, no writes
 */

import mongoose from 'mongoose';
import { ReputationTransaction } from '../src/models/ReputationTransaction';
import { ReputationRule } from '../src/models/ReputationRule';
import reputationService from '../src/services/reputation.service';
import {
  type ReputationCategory,
} from '../src/utils/reputation.constants';
import {
  mapLegacyRuleCategory,
  inferTransactionCategory,
} from '../src/utils/reputationMigrationMapping';
import { logger } from '../src/utils/logger';

/**
 * Legacy karma documents are read directly from their collections (their
 * Mongoose models have been deleted in the hard replace). These interfaces
 * describe the on-disk shape we read.
 */
interface LegacyKarmaHistoryEntry {
  action: string;
  points: number;
  timestamp?: Date;
  description?: string;
  sourceUserId?: mongoose.Types.ObjectId;
  targetContentId?: string;
}

interface LegacyKarmaDoc {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  totalKarma?: number;
  history?: LegacyKarmaHistoryEntry[];
}

interface LegacyKarmaRuleDoc {
  _id: mongoose.Types.ObjectId;
  action: string;
  points: number;
  description?: string;
  cooldownInMinutes?: number;
  isEnabled?: boolean;
  category?: string;
}

async function migrate(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('No active MongoDB connection');
  }

  const karmaRulesCollection = db.collection<LegacyKarmaRuleDoc>('karmarules');
  const karmasCollection = db.collection<LegacyKarmaDoc>('karmas');

  // -------------------------------------------------------------------------
  // 1. Rules: legacy KarmaRule → ReputationRule (upsert by actionType).
  // -------------------------------------------------------------------------
  const legacyRules = await karmaRulesCollection.find({}).toArray();
  logger.info('Legacy karma rules found', { count: legacyRules.length });

  const ruleCategoryByAction = new Map<string, ReputationCategory>();
  let rulesUpserted = 0;

  for (const legacy of legacyRules) {
    const category = mapLegacyRuleCategory(legacy.category);
    ruleCategoryByAction.set(legacy.action, category);

    const existing = await ReputationRule.findOne({ actionType: legacy.action });
    const desired = {
      points: legacy.points,
      category,
      description: legacy.description ?? legacy.action,
      cooldownInMinutes: legacy.cooldownInMinutes ?? 0,
      isEnabled: legacy.isEnabled ?? true,
    };

    const isUpToDate =
      existing &&
      existing.points === desired.points &&
      existing.category === desired.category &&
      existing.description === desired.description &&
      existing.cooldownInMinutes === desired.cooldownInMinutes &&
      existing.isEnabled === desired.isEnabled;

    if (isUpToDate) {
      continue;
    }
    if (!dryRun) {
      await reputationService.upsertRule({
        actionType: legacy.action,
        ...desired,
      });
    }
    rulesUpserted += 1;
  }

  logger.info('Reputation rules upserted', { count: rulesUpserted, dryRun });

  // -------------------------------------------------------------------------
  // 2. History entries: legacy Karma.history → ReputationTransaction.
  // -------------------------------------------------------------------------
  const legacyKarmas = await karmasCollection.find({}).toArray();
  logger.info('Legacy karma documents found', { count: legacyKarmas.length });

  const affectedUserIds = new Set<string>();
  let historyEntries = 0;
  let transactionsCreated = 0;
  let transactionsSkipped = 0;

  for (const karma of legacyKarmas) {
    const history = karma.history ?? [];
    affectedUserIds.add(karma.userId.toString());

    for (const entry of history) {
      historyEntries += 1;
      const createdAt = entry.timestamp ? new Date(entry.timestamp) : new Date();
      const category = inferTransactionCategory(
        entry.action,
        entry.points,
        ruleCategoryByAction
      );

      // Idempotency: skip when an equivalent transaction already exists.
      const duplicate = await ReputationTransaction.findOne({
        userId: karma.userId,
        actionType: entry.action,
        points: entry.points,
        createdAt,
      });
      if (duplicate) {
        transactionsSkipped += 1;
        continue;
      }

      if (!dryRun) {
        await ReputationTransaction.create({
          userId: karma.userId,
          points: entry.points,
          actionType: entry.action,
          category,
          sourceActionType: entry.action,
          targetEntityId: entry.targetContentId,
          createdByUserId: entry.sourceUserId,
          reason: entry.description,
          status: 'active',
          createdAt,
        });
      }
      transactionsCreated += 1;
    }
  }

  logger.info('Reputation transactions', {
    historyEntries,
    transactionsCreated,
    transactionsSkipped,
    dryRun,
  });

  // -------------------------------------------------------------------------
  // 3. Recalculate balances for every affected user.
  // -------------------------------------------------------------------------
  let balancesRecalculated = 0;
  if (!dryRun) {
    for (const userId of affectedUserIds) {
      await reputationService.recalculateBalance(userId);
      balancesRecalculated += 1;
    }
  }

  logger.info('Migration summary', {
    dryRun,
    legacyRules: legacyRules.length,
    rulesUpserted,
    legacyKarmaDocs: legacyKarmas.length,
    historyEntries,
    transactionsCreated,
    transactionsSkipped,
    affectedUsers: affectedUserIds.size,
    balancesRecalculated,
  });

  logger.info(
    'Legacy `karmas` and `karmarules` collections were NOT dropped. After ' +
      'verifying the migrated ledger they can be dropped manually: ' +
      'db.karmas.drop(); db.karmarules.drop();'
  );
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
    await migrate();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Karma → reputation migration failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-karma-to-reputation', method: 'main' }
  );
  process.exit(1);
});
