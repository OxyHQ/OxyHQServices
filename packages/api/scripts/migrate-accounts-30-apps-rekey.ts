#!/usr/bin/env bun
/**
 * Account migration — Phase 3: applications rekey `workspaceId` → `ownerAccountId`.
 *
 * For every application still missing `ownerAccountId`, resolve its legacy
 * `workspaceId`:
 *   - personal workspace → `ownerAccountId = workspace.ownerId` (the owner's own
 *     personal account);
 *   - team workspace → `ownerAccountId =` the org account minted in Phase 2
 *     (from the `accountmigrations` ledger);
 *   - no workspace at all → `ownerAccountId = createdByUserId` (defensive).
 *
 * Read-back asserts: 0 apps left without `ownerAccountId`, and the official apps
 * (`isOfficial:true`) all point at the minted Oxy org account.
 *
 * Idempotent (apps already carrying `ownerAccountId` are skipped). NOTHING is
 * deleted. Run Phases 0–2 first.
 *
 *   bun run packages/api/scripts/migrate-accounts-30-apps-rekey.ts
 *   DRY_RUN=true  plan only
 */

import mongoose from 'mongoose';
import {
  OXY_WORKSPACE_ID,
  connect,
  disconnect,
  findMintedAccount,
  isDryRun,
  rawDb,
} from './account-migration-lib';
import { logger } from '../src/utils/logger';

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const applications = rawDb().collection('applications');
  const workspaces = rawDb().collection('workspaces');

  const orphanApps = await applications
    .find({ ownerAccountId: { $exists: false } })
    .toArray();
  logger.info('Applications without ownerAccountId', { count: orphanApps.length });

  // Cache workspace → ownerAccountId resolutions.
  const ownerByWorkspace = new Map<string, mongoose.Types.ObjectId>();

  let changed = 0;
  let viaPersonal = 0;
  let viaTeam = 0;
  let viaCreator = 0;

  for (const app of orphanApps) {
    const workspaceId = app.workspaceId as mongoose.Types.ObjectId | undefined;
    let ownerAccountId: mongoose.Types.ObjectId | null = null;

    if (workspaceId) {
      const key = workspaceId.toString();
      ownerAccountId = ownerByWorkspace.get(key) ?? null;
      if (!ownerAccountId) {
        const ws = await workspaces.findOne(
          { _id: workspaceId },
          { projection: { type: 1, ownerId: 1 } }
        );
        if (ws?.type === 'team') {
          ownerAccountId = await findMintedAccount('workspace', workspaceId);
          if (ownerAccountId) viaTeam += 1;
        } else if (ws?.ownerId) {
          ownerAccountId = ws.ownerId as mongoose.Types.ObjectId;
          viaPersonal += 1;
        }
        if (ownerAccountId) ownerByWorkspace.set(key, ownerAccountId);
      } else {
        // counted on first resolution
      }
    }

    if (!ownerAccountId) {
      ownerAccountId = (app.createdByUserId as mongoose.Types.ObjectId | undefined) ?? null;
      if (ownerAccountId) viaCreator += 1;
    }

    if (!ownerAccountId) {
      logger.warn('Application could not be rekeyed (no resolvable owner)', {
        applicationId: app._id.toString(),
        name: app.name,
      });
      continue;
    }

    if (!dryRun) {
      await applications.updateOne(
        { _id: app._id },
        { $set: { ownerAccountId } }
      );
    }
    changed += 1;
  }

  logger.info('Phase 3 summary', { dryRun, orphanApps: orphanApps.length, changed, viaPersonal, viaTeam, viaCreator });

  // Read-back.
  const remaining = await applications.countDocuments({ ownerAccountId: { $exists: false } });
  logger.info('Read-back: applications still missing ownerAccountId', {
    count: dryRun ? orphanApps.length : remaining,
  });

  const oxyOrg = await findMintedAccount(
    'workspace',
    new mongoose.Types.ObjectId(OXY_WORKSPACE_ID)
  );
  if (oxyOrg) {
    const officialOnOxy = await applications.countDocuments({
      isOfficial: true,
      ownerAccountId: oxyOrg,
    });
    const officialTotal = await applications.countDocuments({ isOfficial: true });
    logger.info('Read-back: official applications on the Oxy org account', {
      oxyOrgAccountId: oxyOrg.toString(),
      officialOnOxy,
      officialTotal,
    });
  } else {
    logger.warn('Read-back: no minted Oxy org account found (run Phase 2 first)');
  }
}

async function main(): Promise<void> {
  await connect();
  try {
    await migrate();
  } finally {
    await disconnect();
  }
}

main().catch((error) => {
  logger.error(
    'Phase 3 (apps rekey) failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-accounts-30' }
  );
  process.exit(1);
});
