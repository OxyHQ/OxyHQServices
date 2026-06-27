#!/usr/bin/env bun
/**
 * One-shot cleanup: remove `type:'federated'` User rows that shadow a real
 * LOCAL user on one of Oxy's OWN federation domains (e.g. `nate@oxy.so`).
 *
 * Background: the fediverse treats Oxy's apex (`oxy.so`) as a remote
 * ActivityPub origin. Before the own-domain guard landed in
 * `federation.service.ts` (`isOwnFederationDomain`), resolving a handle like
 * `nate@oxy.so` would WebFinger our OWN apex and upsert a `type:'federated'`
 * User — a pure shadow of the real local `nate`. Those duplicates show up in
 * people-search alongside the genuine local account. The code fix stops NEW
 * duplicates; this script removes the rows already written.
 *
 * What it does:
 *   1. Find all `User` docs with `type:'federated'` whose `federation.domain`
 *      is one of Oxy's OWN federation domains ({@link OWN_FEDERATION_DOMAINS}).
 *   2. For each, resolve the real LOCAL user by the handle's local-part
 *      (case-insensitive username match, excluding `type:'federated'`).
 *   3. When a local user exists, the federated row is a pure shadow → DELETE it
 *      and invalidate the user cache for the deleted id.
 *   4. When NO local user matches, the row is an ORPHAN — it is NOT deleted;
 *      it is logged for manual review (deleting it could hide real data).
 *
 * Safety / idempotency:
 *   - Re-runnable: once shadows are deleted, a second run scans 0 (or only
 *     orphans) and changes nothing.
 *   - `DRY_RUN=true` reports the full plan (and the local-user mapping) WITHOUT
 *     deleting anything.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/src/scripts/dedupe-own-domain-federated-users.ts
 * Or, against the compiled output:
 *   node packages/api/dist/scripts/dedupe-own-domain-federated-users.js
 *
 * Env:
 *   MONGODB_URI            required (injected by ECS from SSM)
 *   NODE_ENV               selects the DB name via getDbName() (e.g. oxy-prod)
 *   FEDERATION_DOMAIN      Oxy's own apex (default `oxy.so`)
 *   FEDERATION_OWN_DOMAINS optional extra own-domain aliases (comma-separated)
 *   DRY_RUN=true           plan only, no deletes
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../models/User.js';
import userCache from '../utils/userCache.js';
import {
  OWN_FEDERATION_DOMAINS,
  isOwnFederationDomain,
} from '../services/federation.service.js';
import { exactCaseInsensitiveUsernameRegex } from '../utils/resolveUserIdentifier.js';
import { getDbName } from '../config/db.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const COMPONENT = 'dedupe-own-domain-federated-users';
const DRY_RUN = process.env.DRY_RUN === 'true';

interface Summary {
  scanned: number;
  matchedLocal: number;
  deleted: number;
  orphanedNoLocal: number;
}

/** Extract the local-part of a `<localpart>@<domain>` username. */
function localPartOf(username: string): string {
  const atIndex = username.indexOf('@');
  return atIndex > 0 ? username.substring(0, atIndex) : '';
}

async function run(): Promise<Summary> {
  const ownDomains = [...OWN_FEDERATION_DOMAINS];
  logger.info('Own federation domains', { component: COMPONENT, ownDomains, dryRun: DRY_RUN });

  // Indexed candidate query on the lowercased stored `federation.domain`.
  const candidates = await User.find({
    type: 'federated',
    'federation.domain': { $in: ownDomains },
  })
    .select('_id username federation.domain')
    .lean();

  const summary: Summary = {
    scanned: 0,
    matchedLocal: 0,
    deleted: 0,
    orphanedNoLocal: 0,
  };

  for (const candidate of candidates) {
    const fedDomain = candidate.federation?.domain ?? '';
    // Defensive re-check in case any stored domain wasn't lowercased on write.
    if (!isOwnFederationDomain(fedDomain)) continue;
    summary.scanned += 1;

    const fedId = candidate._id.toString();
    const username = typeof candidate.username === 'string' ? candidate.username : '';
    const localPart = localPartOf(username);

    if (!localPart) {
      summary.orphanedNoLocal += 1;
      logger.warn('Orphan federated row has no resolvable local-part — manual review', {
        component: COMPONENT,
        federatedUserId: fedId,
        username,
        domain: fedDomain,
      });
      continue;
    }

    const localUser = await User.findOne({
      username: exactCaseInsensitiveUsernameRegex(localPart),
      type: { $ne: 'federated' },
    })
      .select('_id username type')
      .lean();

    if (!localUser) {
      summary.orphanedNoLocal += 1;
      logger.warn('Orphan federated row — no matching local user, NOT deleting (manual review)', {
        component: COMPONENT,
        federatedUserId: fedId,
        username,
        domain: fedDomain,
        localPart,
      });
      continue;
    }

    summary.matchedLocal += 1;
    logger.info('Federated shadow → local user mapping', {
      component: COMPONENT,
      federatedUserId: fedId,
      federatedUsername: username,
      domain: fedDomain,
      localUserId: localUser._id.toString(),
      localUsername: localUser.username,
      localType: localUser.type ?? 'local',
      action: DRY_RUN ? 'would-delete' : 'delete',
    });

    if (!DRY_RUN) {
      await User.deleteOne({ _id: candidate._id });
      userCache.invalidate(fedId);
      summary.deleted += 1;
    }
  }

  logger.info('Dedupe summary', {
    component: COMPONENT,
    dryRun: DRY_RUN,
    scanned: summary.scanned,
    matchedLocal: summary.matchedLocal,
    deleted: summary.deleted,
    orphanedNoLocal: summary.orphanedNoLocal,
  });

  return summary;
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
      'dedupe-own-domain-federated-users failed',
      error instanceof Error ? error : new Error(String(error)),
      { component: COMPONENT, method: 'main' },
    );
    process.exit(1);
  });
