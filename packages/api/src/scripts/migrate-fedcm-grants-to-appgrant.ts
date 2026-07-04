/**
 * One-shot migration: FedCMGrant → AppGrant.
 *
 * The FedCM surface is deleted; the authoritative record of a user's third-party
 * consent is now `AppGrant` (keyed by the stable `Application._id`, written by
 * the OAuth authorize flow). This backfills `AppGrant` rows from the legacy
 * `fedcmgrants` collection so a user who only ever consented via FedCM keeps
 * their "Connected apps" entry after cutover.
 *
 * Mapping: a FedCMGrant is keyed by `(userId, clientOrigin)`. We resolve
 * `clientOrigin → Application` via the app's registered `redirectUris` origins
 * (the same derivation the CORS/approved-clients registry uses). TRUSTED
 * first-party/internal/official apps are auto-approved and never need a grant, so
 * they are SKIPPED. Only third-party apps produce an `AppGrant`.
 *
 * Properties:
 *   - Idempotent + re-runnable: upserts on the unique `(userId, applicationId)`
 *     index, so re-running never duplicates and never regresses a grant.
 *   - DRY_RUN=true reports the plan (counts + per-grant disposition) without
 *     writing anything.
 *   - Reads the legacy collection via an INLINE schema bound to `fedcmgrants`,
 *     so it does not depend on the (deleted) FedCMGrant model file.
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   DRY_RUN=true  plan only, no writes
 *
 * DO NOT run ad-hoc from a laptop (the Valkey/Mongo security groups only accept
 * ECS task traffic). Run as an ECS one-shot task pre-deploy.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { AppGrant } from '../models/AppGrant.js';
import { Application, type ApplicationType } from '../models/Application.js';
import { isTrustedApplication } from '../utils/trustedApplication.js';
import { normaliseOrigin } from '../utils/origin.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

/** Minimal read-only view of the legacy `fedcmgrants` collection. */
interface LegacyFedCMGrant {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  clientOrigin: string;
  firstGrantedAt?: Date;
  lastUsedAt?: Date;
}

const LegacyFedCMGrantModel =
  mongoose.models?.LegacyFedCMGrant ??
  mongoose.model(
    'LegacyFedCMGrant',
    new mongoose.Schema(
      {
        userId: mongoose.Schema.Types.ObjectId,
        clientOrigin: String,
        firstGrantedAt: Date,
        lastUsedAt: Date,
      },
      { collection: 'fedcmgrants', strict: false },
    ),
  );

export interface AppOriginRow {
  _id: mongoose.Types.ObjectId;
  redirectUris?: string[];
  isOfficial?: boolean;
  isInternal?: boolean;
  type?: ApplicationType;
}

export interface OriginAppEntry {
  applicationId: mongoose.Types.ObjectId;
  trusted: boolean;
}

export type GrantClassification =
  | { kind: 'migrate'; applicationId: mongoose.Types.ObjectId }
  | { kind: 'skip_trusted' }
  | { kind: 'unresolved' };

/**
 * Build a normalised-origin → { applicationId, trusted } map from every
 * Application's registered redirect origins. First app wins on a shared origin.
 * Pure — exported for unit testing.
 */
export function buildOriginToApp(apps: AppOriginRow[]): Map<string, OriginAppEntry> {
  const originToApp = new Map<string, OriginAppEntry>();
  for (const app of apps) {
    const trusted = isTrustedApplication(app);
    for (const uri of app.redirectUris ?? []) {
      const origin = normaliseOrigin(uri);
      if (!origin) continue;
      if (!originToApp.has(origin)) {
        originToApp.set(origin, { applicationId: app._id, trusted });
      }
    }
  }
  return originToApp;
}

/**
 * Classify a single FedCM grant's `clientOrigin`: migrate (third-party →
 * AppGrant), skip_trusted (auto-approved, no grant needed), or unresolved (no
 * Application owns the origin). Pure — exported for unit testing.
 */
export function classifyFedCMGrant(
  clientOrigin: string,
  originToApp: Map<string, OriginAppEntry>,
): GrantClassification {
  const origin = normaliseOrigin(clientOrigin);
  const match = origin ? originToApp.get(origin) : undefined;
  if (!match) return { kind: 'unresolved' };
  if (match.trusted) return { kind: 'skip_trusted' };
  return { kind: 'migrate', applicationId: match.applicationId };
}

async function migrate(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  logger.info(`[migrate-fedcm→appgrant] starting (DRY_RUN=${dryRun})`);

  const apps = await Application.find({})
    .select('redirectUris isOfficial isInternal type')
    .lean<AppOriginRow[]>();
  const originToApp = buildOriginToApp(apps);

  const grants = await LegacyFedCMGrantModel.find({}).lean<LegacyFedCMGrant[]>();

  let migrated = 0;
  let skippedTrusted = 0;
  let unresolved = 0;

  for (const grant of grants) {
    const decision = classifyFedCMGrant(grant.clientOrigin, originToApp);
    if (decision.kind === 'unresolved') {
      unresolved += 1;
      logger.warn('[migrate-fedcm→appgrant] no Application for clientOrigin — skipping', {
        clientOrigin: grant.clientOrigin,
      });
      continue;
    }
    if (decision.kind === 'skip_trusted') {
      skippedTrusted += 1;
      continue;
    }

    if (dryRun) {
      migrated += 1;
      continue;
    }
    const match = { applicationId: decision.applicationId };

    await AppGrant.updateOne(
      { userId: grant.userId, applicationId: match.applicationId },
      {
        $setOnInsert: {
          userId: grant.userId,
          applicationId: match.applicationId,
          firstGrantedAt: grant.firstGrantedAt ?? new Date(),
        },
        $set: { lastUsedAt: grant.lastUsedAt ?? new Date() },
      },
      { upsert: true },
    );
    migrated += 1;
  }

  logger.info('[migrate-fedcm→appgrant] done', {
    dryRun,
    totalGrants: grants.length,
    migrated,
    skippedTrusted,
    unresolved,
  });
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  const dbName = getDbName();
  await mongoose.connect(uri, { dbName });
  try {
    await migrate();
  } finally {
    await mongoose.connection.close();
  }
}

// Only run when executed directly (not when imported by a unit test).
if (require.main === module) {
  main().catch((error) => {
    logger.error('[migrate-fedcm→appgrant] failed', error instanceof Error ? error : new Error(String(error)));
    process.exit(1);
  });
}
