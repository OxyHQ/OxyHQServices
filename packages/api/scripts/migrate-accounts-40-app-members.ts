#!/usr/bin/env bun
/**
 * Account migration — Phase 4: application members → account members.
 *
 * Reads the legacy `applicationmembers` collection. Each active membership is
 * folded into an `AccountMember` on the application's owning account
 * (`app.ownerAccountId`) with the mapped role (app owner → account admin;
 * developer/billing/viewer unchanged).
 *
 * `ensureMember` never downgrades a stronger existing role (e.g. an account
 * owner from Phase 2), so folding is safe and idempotent.
 *
 * FLAG: an app-only `developer`/`viewer` who, under the old model, could only
 * see ONE application now gains that role across the WHOLE owning account. Those
 * are reported (`OXY_ACCOUNTS_BROADENED_MEMBERS=`) so an operator can, if
 * desired, move the single app into a `kind:'project'` sub-account and scope the
 * member there instead. This script does NOT auto-move (that is a judgement
 * call); it only surfaces the list.
 *
 * NOTHING is deleted. Run Phases 0–3 first.
 *
 *   bun run packages/api/scripts/migrate-accounts-40-app-members.ts
 *   DRY_RUN=true  plan only
 */

import mongoose from 'mongoose';
import {
  connect,
  disconnect,
  ensureMember,
  isDryRun,
  mapAppRole,
  rawDb,
} from './account-migration-lib';
import { logger } from '../src/utils/logger';

interface BroadenedMember {
  applicationId: string;
  ownerAccountId: string;
  memberUserId: string;
  appRole: string;
  accountRole: string;
}

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const applications = rawDb().collection('applications');
  const appMembers = rawDb().collection('applicationmembers');

  const memberships = await appMembers.find({ status: 'active' }).toArray();
  logger.info('Active application memberships', { count: memberships.length });

  // Cache app → ownerAccountId.
  const ownerByApp = new Map<string, mongoose.Types.ObjectId>();
  const broadened: BroadenedMember[] = [];

  let foldedMembers = 0;
  let skippedNoOwner = 0;

  for (const member of memberships) {
    const applicationId = member.applicationId as mongoose.Types.ObjectId;
    const memberUserId = member.userId as mongoose.Types.ObjectId;
    const appRole = (member.role as string) || 'viewer';
    if (!applicationId || !memberUserId) continue;

    const appKey = applicationId.toString();
    let ownerAccountId = ownerByApp.get(appKey) ?? null;
    if (!ownerAccountId) {
      const app = await applications.findOne(
        { _id: applicationId },
        { projection: { ownerAccountId: 1 } }
      );
      ownerAccountId = (app?.ownerAccountId as mongoose.Types.ObjectId | undefined) ?? null;
      if (ownerAccountId) ownerByApp.set(appKey, ownerAccountId);
    }

    if (!ownerAccountId) {
      skippedNoOwner += 1;
      logger.warn('Application member skipped (app has no ownerAccountId — run Phase 3)', {
        applicationId: appKey,
      });
      continue;
    }

    const accountRole = mapAppRole(appRole);
    const wrote = await ensureMember(ownerAccountId, memberUserId, accountRole, undefined, dryRun);
    if (wrote) foldedMembers += 1;

    // An app-only member that is not an owner now reaches the whole account.
    if (appRole !== 'owner') {
      broadened.push({
        applicationId: appKey,
        ownerAccountId: ownerAccountId.toString(),
        memberUserId: memberUserId.toString(),
        appRole,
        accountRole,
      });
    }
  }

  logger.info('Phase 4 summary', {
    dryRun,
    memberships: memberships.length,
    foldedMembers,
    skippedNoOwner,
    broadenedCount: broadened.length,
  });
  // eslint-disable-next-line no-console
  console.log('OXY_ACCOUNTS_BROADENED_MEMBERS=' + JSON.stringify(broadened));
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
    'Phase 4 (app members → account members) failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-accounts-40' }
  );
  process.exit(1);
});
