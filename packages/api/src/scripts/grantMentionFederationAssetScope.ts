#!/usr/bin/env bun
/**
 * Inspect-by-default ops one-shot: grant the `files:read` scope to the Mention
 * federation service credential AND its owning Application so Mention's backend
 * can call the service-token reverse content-address asset endpoints:
 *   - `POST /assets/service/by-ids`    (PR #452)
 *   - `POST /assets/service/by-sha256` (PR #456)
 *
 * Both handlers gate on `requireServiceScope(req, 'files:read')`
 * (`src/routes/assets.ts`) — the exact scope string is `files:read`. Without it
 * those calls 403, breaking the MTN blob read-side (sha256 -> fileId
 * resolution).
 *
 * WHY BOTH the credential AND the app:
 *   The service-token mint (`POST /auth/service-token`, `src/routes/auth.ts`)
 *   computes the effective scopes as
 *     `effective = credential.scopes.length > 0
 *        ? intersectScopes(credential.scopes, app.scopes)  // credential ∩ app
 *        : app.scopes`                                      // inherit app set
 *   (`intersectScopes` in `src/utils/applicationScopes.ts`). Mention's
 *   credential carries explicit scopes, so `files:read` survives the
 *   intersection ONLY if it is present on BOTH the credential and the owning
 *   Application. This script `$addToSet`s it onto both.
 *
 *   `files:read` is NOT a privileged scope
 *   (`PRIVILEGED_APPLICATION_SCOPES` = federation/reputation/signals/
 *   notifications:write), so granting it is safe and freely allowed — it
 *   authorises read-only metadata access over assets only.
 *
 * CACHE: service-token scopes are read FRESH from Mongo on every
 * `POST /auth/service-token` mint — there is NO scope cache to bust.
 *
 * SAFETY:
 *   - INSPECT by default: logs current + would-add scopes and exits 0 WITHOUT
 *     mutating. Mutates only when `APPLY === 'true'`.
 *   - `$addToSet` is idempotent — re-running performs no further changes.
 *   - Never removes or overwrites existing scopes; never touches any other app
 *     or credential.
 *   - If the credential is not found, logs clearly and exits 0 (no crash).
 *
 * Targeting (precise, credential-first):
 *   1. Resolve the Application via the KNOWN credential: find
 *      `ApplicationCredential { _id: 6a30ca4b5b15dc1bb793ad53 }` and read its
 *      `applicationId`.
 *   2. Fall back to `Application { name: 'Mention' }` ONLY if that credential is
 *      not found (in which case only the app can be granted; logged loudly).
 *
 * Run (inside the oxy-api image, working dir /app):
 *   # inspect (default — no writes)
 *   node packages/api/dist/scripts/grantMentionFederationAssetScope.js
 *   # apply (mutates the credential + application)
 *   APPLY=true node packages/api/dist/scripts/grantMentionFederationAssetScope.js
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   NODE_ENV      selects the DB name via getDbName() (e.g. oxy-prod)
 *   APPLY         'true' to mutate; anything else (default) = inspect only
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Application } from '../models/Application.js';
import { ApplicationCredential } from '../models/ApplicationCredential.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';
import type { ApplicationScope } from '../utils/applicationScopes.js';

dotenv.config();

const COMPONENT = 'grant-mention-federation-asset-scope';
/** Mention federation credential whose owning Application is the target. */
const MENTION_CREDENTIAL_ID = '6a30ca4b5b15dc1bb793ad53';
/** Fallback app name, used only if the credential above is not found. */
const FALLBACK_APP_NAME = 'Mention';
/**
 * The exact scope string both `POST /assets/service/by-ids` and
 * `POST /assets/service/by-sha256` gate on (`requireServiceScope(req,
 * 'files:read')`). Verified against `src/routes/assets.ts`.
 */
const ASSET_READ_SCOPE: ApplicationScope = 'files:read';

/** True when this run is allowed to mutate the database. */
const APPLY = process.env.APPLY === 'true';

interface ResolvedApplication {
  applicationId: mongoose.Types.ObjectId;
  via: 'credential' | 'fallback-name';
  /** The service credential, when resolved via it. Absent on the fallback path. */
  credentialFound: boolean;
}

async function resolveTarget(): Promise<ResolvedApplication | null> {
  if (mongoose.isValidObjectId(MENTION_CREDENTIAL_ID)) {
    const credential = await ApplicationCredential.findById(MENTION_CREDENTIAL_ID)
      .select('_id applicationId type')
      .lean();
    if (credential?.applicationId) {
      if (credential.type !== 'service') {
        logger.warn('Resolved credential is not a service credential', {
          component: COMPONENT,
          credentialId: MENTION_CREDENTIAL_ID,
          credentialType: credential.type,
        });
      }
      return {
        applicationId: credential.applicationId,
        via: 'credential',
        credentialFound: true,
      };
    }
    logger.warn('Mention credential not found by id; falling back to Application name', {
      component: COMPONENT,
      credentialId: MENTION_CREDENTIAL_ID,
    });
  }

  const app = await Application.findOne({ name: FALLBACK_APP_NAME }).select('_id').lean();
  if (app?._id) {
    return { applicationId: app._id, via: 'fallback-name', credentialFound: false };
  }
  return null;
}

async function run(): Promise<void> {
  logger.info(APPLY ? 'Running in APPLY mode (will mutate)' : 'Running in INSPECT mode (no writes)', {
    component: COMPONENT,
    apply: APPLY,
    scope: ASSET_READ_SCOPE,
  });

  const resolved = await resolveTarget();
  if (!resolved) {
    // Nothing to act on; exit cleanly so the one-shot does not fail the task.
    logger.warn('Could not resolve the Mention Application or credential — nothing to do', {
      component: COMPONENT,
      credentialId: MENTION_CREDENTIAL_ID,
      fallbackAppName: FALLBACK_APP_NAME,
    });
    return;
  }

  const { applicationId, via, credentialFound } = resolved;
  logger.info('Resolved target Application', {
    component: COMPONENT,
    applicationId: String(applicationId),
    resolvedVia: via,
    credentialFound,
  });

  const appBefore = await Application.findById(applicationId).select('_id name scopes').lean();
  if (!appBefore) {
    logger.warn('Application referenced by credential no longer exists — nothing to do', {
      component: COMPONENT,
      applicationId: String(applicationId),
    });
    return;
  }

  const credBefore = credentialFound
    ? await ApplicationCredential.findById(MENTION_CREDENTIAL_ID)
        .select('_id name type scopes')
        .lean()
    : null;

  const appScopesBefore = appBefore.scopes ?? [];
  const credScopesBefore = credBefore?.scopes ?? [];
  const appAlreadyHas = appScopesBefore.includes(ASSET_READ_SCOPE);
  const credAlreadyHas = credBefore ? credScopesBefore.includes(ASSET_READ_SCOPE) : true;

  logger.info('Scopes BEFORE', {
    component: COMPONENT,
    applicationId: String(applicationId),
    appName: appBefore.name,
    appScopes: appScopesBefore,
    credentialId: credBefore ? String(credBefore._id) : null,
    credentialScopes: credBefore ? credScopesBefore : null,
    requiredScope: ASSET_READ_SCOPE,
    appAlreadyHasScope: appAlreadyHas,
    credentialAlreadyHasScope: credBefore ? credAlreadyHas : 'n/a (credential not found)',
  });

  // INSPECT mode: report what WOULD change, then stop without mutating.
  if (!APPLY) {
    const wouldAddToApp = !appAlreadyHas;
    const wouldAddToCredential = Boolean(credBefore) && !credAlreadyHas;
    logger.info('INSPECT — no changes written. Re-run with APPLY=true to apply.', {
      component: COMPONENT,
      scope: ASSET_READ_SCOPE,
      wouldAddToApplication: wouldAddToApp,
      wouldAddToCredential,
      alreadyFullyGranted:
        !wouldAddToApp && !wouldAddToCredential,
      note: credBefore
        ? 'Both credential and app must carry the scope for it to survive the mint intersection.'
        : 'Credential not found — only the application would be granted on the fallback path.',
      cacheNote:
        'No cache bust needed: service-token scopes are read fresh from Mongo on each /auth/service-token mint.',
    });
    return;
  }

  // APPLY mode: grant the scope on both the application and (when present) the
  // credential. `$addToSet` is idempotent.
  const appResult = await Application.updateOne(
    { _id: applicationId },
    { $addToSet: { scopes: ASSET_READ_SCOPE } }
  );
  const credResult = credBefore
    ? await ApplicationCredential.updateOne(
        { _id: MENTION_CREDENTIAL_ID },
        { $addToSet: { scopes: ASSET_READ_SCOPE } }
      )
    : null;

  const appAfter = await Application.findById(applicationId).select('_id name scopes').lean();
  const credAfter = credBefore
    ? await ApplicationCredential.findById(MENTION_CREDENTIAL_ID).select('_id name scopes').lean()
    : null;

  logger.info('Scopes AFTER', {
    component: COMPONENT,
    applicationId: String(applicationId),
    appName: appAfter?.name ?? appBefore.name,
    appScopes: appAfter?.scopes ?? [],
    credentialId: credAfter ? String(credAfter._id) : null,
    credentialScopes: credAfter ? credAfter.scopes ?? [] : null,
    grantedScope: ASSET_READ_SCOPE,
    appModified: appResult.modifiedCount,
    credentialModified: credResult ? credResult.modifiedCount : 'n/a (credential not found)',
    idempotentNoOp:
      appResult.modifiedCount === 0 && (credResult ? credResult.modifiedCount === 0 : true),
  });

  if (!credBefore) {
    logger.warn(
      'Credential was NOT found — only the Application was granted. ' +
        'If the credential carries explicit scopes, files:read will be stripped by the ' +
        'mint intersection. Re-provision the credential or re-run once the credential exists.',
      { component: COMPONENT, credentialId: MENTION_CREDENTIAL_ID }
    );
  }

  logger.info(
    'Done. files:read now grants Mention service tokens access to ' +
      'POST /assets/service/by-ids and POST /assets/service/by-sha256 on next mint.',
    { component: COMPONENT, applicationId: String(applicationId) }
  );
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
      'grantMentionFederationAssetScope failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: COMPONENT, method: 'main' }
    );
    process.exit(1);
  });
