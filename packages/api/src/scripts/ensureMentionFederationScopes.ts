#!/usr/bin/env bun
/**
 * Idempotent ops one-shot: elevate the Mention Application's app-level scopes so
 * the credential⊆app scope intersection performed at service-token mint
 * (`intersectScopes` in `src/utils/applicationScopes.ts`) does NOT strip the live
 * Mention federation credential's `federation:write` / `files:write`.
 *
 * Background: the service-token mint computes `effective = credentialScopes ∩
 * appScopes`. The Mention federation credential
 * (`ApplicationCredential _id 6a30ca4b5b15dc1bb793ad53`) requests
 * `federation:write` + `files:write` (+ `user:read`), but if the owning
 * Application's `scopes` array is missing those, the intersection drops them and
 * the federation/outbox-sync flow silently loses authority. This script
 * `$addToSet`s the two scopes onto the owning Application so the intersection
 * preserves them.
 *
 * Targeting (precise, credential-first):
 *   1. Resolve the Application via the KNOWN credential: find
 *      `ApplicationCredential { _id: 6a30ca4b5b15dc1bb793ad53 }` and read its
 *      `applicationId`.
 *   2. Fall back to `Application { name: 'Mention' }` ONLY if that credential is
 *      not found. The resolution path used is logged.
 *
 * Safety:
 *   - `$addToSet` is idempotent — re-running performs no further changes.
 *   - Never removes or overwrites existing scopes; never touches any other app.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/ensureMentionFederationScopes.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/ensureMentionFederationScopes.js
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

/** Credential whose owning Application must carry the federation scopes. */
const MENTION_CREDENTIAL_ID = '6a30ca4b5b15dc1bb793ad53';
/** Fallback app name, used only if the credential above is not found. */
const FALLBACK_APP_NAME = 'Mention';
/** Scopes the owning Application must include so the mint intersection keeps them. */
const REQUIRED_SCOPES: readonly ApplicationScope[] = ['federation:write', 'files:write'];

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
    logger.warn(
      'Mention federation credential not found by id; falling back to Application name',
      { component: 'ensure-mention-federation-scopes', credentialId: MENTION_CREDENTIAL_ID }
    );
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
    component: 'ensure-mention-federation-scopes',
    applicationId: String(applicationId),
    resolvedVia: via,
  });

  const before = await Application.findById(applicationId).select('_id name scopes').lean();
  if (!before) {
    throw new Error(`Application ${String(applicationId)} referenced by credential no longer exists`);
  }

  logger.info('Application scopes BEFORE', {
    component: 'ensure-mention-federation-scopes',
    applicationId: String(applicationId),
    name: before.name,
    scopes: before.scopes ?? [],
  });

  const result = await Application.updateOne(
    { _id: applicationId },
    { $addToSet: { scopes: { $each: REQUIRED_SCOPES } } }
  );

  const after = await Application.findById(applicationId).select('_id name scopes').lean();

  logger.info('Application scopes AFTER', {
    component: 'ensure-mention-federation-scopes',
    applicationId: String(applicationId),
    name: after?.name ?? before.name,
    scopes: after?.scopes ?? [],
    requiredScopes: REQUIRED_SCOPES,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    idempotentNoOp: result.modifiedCount === 0,
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
  logger.info('Connected to MongoDB', {
    component: 'ensure-mention-federation-scopes',
    dbName,
  });

  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed', {
      component: 'ensure-mention-federation-scopes',
    });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error(
      'ensureMentionFederationScopes failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: 'ensure-mention-federation-scopes', method: 'main' }
    );
    process.exit(1);
  });
