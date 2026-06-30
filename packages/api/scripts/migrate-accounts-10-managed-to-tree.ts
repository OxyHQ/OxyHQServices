#!/usr/bin/env bun
/**
 * Account migration — Phase 1: managed sub-accounts → tree + members.
 *
 * Reads the legacy `managedaccounts` collection. For each relationship
 * `{ accountId, ownerId, managers[] }`:
 *   - the sub-account User becomes `kind:'project'` parented under its owner
 *     (`parentAccountId = ownerId`, `ancestors = [...owner.ancestors, ownerId]`,
 *     `rootAccountId = owner.rootAccountId`);
 *   - every manager becomes an `AccountMember` on the sub-account with the
 *     mapped role (owner/admin/editor → unchanged).
 *
 * Idempotent (deterministic field writes + member upserts). NOTHING is deleted.
 * Run Phase 0 first so owners already carry their tree fields.
 *
 *   bun run packages/api/scripts/migrate-accounts-10-managed-to-tree.ts
 *   DRY_RUN=true  plan only
 */

import mongoose from 'mongoose';
import {
  connect,
  disconnect,
  ensureMember,
  isDryRun,
  mapManagedRole,
  rawDb,
} from './account-migration-lib';
import { logger } from '../src/utils/logger';

interface ManagedManager {
  userId: mongoose.Types.ObjectId;
  role: string;
}

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const users = rawDb().collection('users');
  const managed = rawDb().collection('managedaccounts');

  const relationships = await managed.find({}).toArray();
  logger.info('Managed account relationships', { count: relationships.length });

  let subAccountsReparented = 0;
  let membersEnsured = 0;

  for (const rel of relationships) {
    const accountId = rel.accountId as mongoose.Types.ObjectId;
    const ownerId = rel.ownerId as mongoose.Types.ObjectId;
    if (!accountId || !ownerId) continue;

    const owner = await users.findOne(
      { _id: ownerId },
      { projection: { ancestors: 1, rootAccountId: 1 } }
    );
    const ownerAncestors = (owner?.ancestors as mongoose.Types.ObjectId[] | undefined) ?? [];
    const ownerRoot = (owner?.rootAccountId as mongoose.Types.ObjectId | undefined) ?? ownerId;

    if (!dryRun) {
      await users.updateOne(
        { _id: accountId },
        {
          $set: {
            kind: 'project',
            parentAccountId: ownerId,
            ancestors: [...ownerAncestors, ownerId],
            rootAccountId: ownerRoot,
            accountStatus: 'active',
          },
        }
      );
    }
    subAccountsReparented += 1;

    const managers = (rel.managers as ManagedManager[] | undefined) ?? [];
    for (const manager of managers) {
      if (!manager?.userId) continue;
      const wrote = await ensureMember(
        accountId,
        manager.userId,
        mapManagedRole(manager.role),
        ownerId,
        dryRun
      );
      if (wrote) membersEnsured += 1;
    }
  }

  logger.info('Phase 1 summary', {
    dryRun,
    relationships: relationships.length,
    subAccountsReparented,
    membersEnsured,
  });
}

async function main(): Promise<void> {
  await connect();
  try {
    await migrate();
  } finally {
    await disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
  logger.error(
    'Phase 1 (managed → tree) failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-accounts-10' }
  );
  process.exit(1);
});
