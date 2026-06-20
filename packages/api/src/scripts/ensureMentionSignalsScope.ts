#!/usr/bin/env bun
/**
 * Idempotent ops one-shot: grant the `signals:write` scope to the Mention
 * Application AND its federation credential so the multi-app recommendation
 * signal-ingest endpoint (`POST /app-signals/ingest`) accepts Mention's pushes.
 *
 * Background: the service-token mint computes `effective = credentialScopes ∩
 * appScopes` (`intersectScopes` in `src/utils/applicationScopes.ts`). For the
 * `signals:write` scope to survive the intersection it must be present on BOTH:
 *   - the `ApplicationCredential` (`_id 6a30ca4b5b15dc1bb793ad53`), and
 *   - the owning `Application` (resolved from that credential's `applicationId`).
 * This script `$addToSet`s the scope onto both. It also logs the resolved
 * `applicationId`, which is the value to wire as `MENTION_APPLICATION_ID`
 * (oxy-api) and `MENTION_OXY_CLIENT_ID` (mention).
 *
 * Safety:
 *   - `$addToSet` is idempotent — re-running performs no further changes.
 *   - Never removes or overwrites existing scopes; never touches any other app
 *     or credential.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   node packages/api/dist/scripts/ensureMentionSignalsScope.js
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   NODE_ENV      selects the DB name via getDbName() (e.g. oxy-prod)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Application } from '../models/Application.js';
import { ApplicationCredential } from '../models/ApplicationCredential.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import type { ApplicationScope } from '../utils/applicationScopes.js';

dotenv.config();

const COMPONENT = 'ensure-mention-signals-scope';
/** Mention federation credential whose owning Application is the target. */
const MENTION_CREDENTIAL_ID = '6a30ca4b5b15dc1bb793ad53';
/** Fallback app name, used only if the credential above is not found. */
const FALLBACK_APP_NAME = 'Mention';
/** The scope that must be present on both the credential and the application. */
const SIGNALS_SCOPE: ApplicationScope = 'signals:write';

async function resolveApplicationId(): Promise<{
  applicationId: mongoose.Types.ObjectId;
  via: 'credential' | 'fallback-name';
} | null> {
  if (mongoose.isValidObjectId(MENTION_CREDENTIAL_ID)) {
    const credential = await ApplicationCredential.findById(MENTION_CREDENTIAL_ID)
      .select('_id applicationId')
      .lean();
    if (credential?.applicationId) {
      return { applicationId: credential.applicationId, via: 'credential' };
    }
    logger.warn('Mention credential not found by id; falling back to Application name', {
      component: COMPONENT,
      credentialId: MENTION_CREDENTIAL_ID,
    });
  }

  const app = await Application.findOne({ name: FALLBACK_APP_NAME }).select('_id').lean();
  if (app?._id) {
    return { applicationId: app._id, via: 'fallback-name' };
  }
  return null;
}

async function run(): Promise<void> {
  const resolved = await resolveApplicationId();
  if (!resolved) {
    throw new Error(
      `Could not resolve the Mention Application (no credential ${MENTION_CREDENTIAL_ID}, ` +
        `no Application named "${FALLBACK_APP_NAME}")`
    );
  }

  const { applicationId, via } = resolved;
  logger.info('Resolved target Application', {
    component: COMPONENT,
    applicationId: String(applicationId),
    resolvedVia: via,
  });

  const appBefore = await Application.findById(applicationId).select('_id name scopes').lean();
  if (!appBefore) {
    throw new Error(`Application ${String(applicationId)} referenced by credential no longer exists`);
  }
  const credBefore = await ApplicationCredential.findById(MENTION_CREDENTIAL_ID)
    .select('_id name scopes')
    .lean();

  logger.info('Scopes BEFORE', {
    component: COMPONENT,
    applicationId: String(applicationId),
    appName: appBefore.name,
    appScopes: appBefore.scopes ?? [],
    credentialScopes: credBefore?.scopes ?? [],
  });

  const appResult = await Application.updateOne(
    { _id: applicationId },
    { $addToSet: { scopes: SIGNALS_SCOPE } }
  );
  const credResult = await ApplicationCredential.updateOne(
    { _id: MENTION_CREDENTIAL_ID },
    { $addToSet: { scopes: SIGNALS_SCOPE } }
  );

  const appAfter = await Application.findById(applicationId).select('_id name scopes').lean();
  const credAfter = await ApplicationCredential.findById(MENTION_CREDENTIAL_ID)
    .select('_id name scopes')
    .lean();

  logger.info('Scopes AFTER', {
    component: COMPONENT,
    applicationId: String(applicationId),
    appName: appAfter?.name ?? appBefore.name,
    appScopes: appAfter?.scopes ?? [],
    credentialScopes: credAfter?.scopes ?? [],
    grantedScope: SIGNALS_SCOPE,
    appModified: appResult.modifiedCount,
    credentialModified: credResult.modifiedCount,
    idempotentNoOp: appResult.modifiedCount === 0 && credResult.modifiedCount === 0,
  });

  logger.info('WIRE THIS VALUE as MENTION_APPLICATION_ID (oxy-api) and MENTION_OXY_CLIENT_ID (mention)', {
    component: COMPONENT,
    applicationId: String(applicationId),
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
  logger.info('Connected to MongoDB', { component: COMPONENT, dbName });

  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed', { component: COMPONENT });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(
      'ensureMentionSignalsScope failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: COMPONENT, method: 'main' }
    );
    process.exit(1);
  });
