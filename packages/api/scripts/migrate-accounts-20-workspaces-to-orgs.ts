#!/usr/bin/env bun
/**
 * Account migration — Phase 2: team workspaces → organization accounts.
 *
 * Reads the legacy `workspaces` / `workspacemembers` collections.
 *   - `type:'personal'` workspaces are SKIPPED (the owner is already a root
 *     personal account — there is nothing to mint).
 *   - `type:'team'` workspaces MINT a `kind:'organization'` account parented
 *     under the workspace owner, recorded in the `accountmigrations` ledger
 *     (idempotent — a re-run reuses the same minted account). Every
 *     workspacemember becomes an `AccountMember` on the org with the mapped role
 *     (owner→owner, admin→admin, member→editor, viewer→viewer).
 *
 * OXY SPECIAL CASE: the production "Oxy" team workspace MINTS a NEW org account
 * under the `oxy` user — it never converts the `oxy` login in place. We log
 * whether `oxy` is a real login (has authMethods) for the operator's audit.
 *
 * NOTHING is deleted. Run Phase 0 first.
 *
 *   bun run packages/api/scripts/migrate-accounts-20-workspaces-to-orgs.ts
 *   DRY_RUN=true  plan only
 */

import mongoose from 'mongoose';
import { User } from '../src/models/User';
import {
  OXY_ACCOUNT_NAME,
  OXY_WORKSPACE_ID,
  allocateUsername,
  connect,
  disconnect,
  ensureMember,
  findMintedAccount,
  isDryRun,
  mapWorkspaceRole,
  rawDb,
  recordMintedAccount,
} from './account-migration-lib';
import { logger } from '../src/utils/logger';

interface MappingRow {
  workspaceId: string;
  name: string;
  ownerId: string;
  orgAccountId: string;
  minted: boolean;
}

async function mintOrgAccount(
  name: string,
  ownerId: mongoose.Types.ObjectId,
  slug: string | undefined,
  dryRun: boolean
): Promise<mongoose.Types.ObjectId> {
  const owner = await rawDb()
    .collection('users')
    .findOne({ _id: ownerId }, { projection: { ancestors: 1, rootAccountId: 1 } });
  const ownerAncestors = (owner?.ancestors as mongoose.Types.ObjectId[] | undefined) ?? [];
  const ownerRoot = (owner?.rootAccountId as mongoose.Types.ObjectId | undefined) ?? ownerId;

  if (dryRun) {
    return new mongoose.Types.ObjectId('000000000000000000000000');
  }

  const username = await allocateUsername(slug || name);
  const account = await User.create({
    username,
    name: { first: name },
    kind: 'organization',
    type: 'local',
    verified: true,
    authMethods: [],
    parentAccountId: ownerId,
    ancestors: [...ownerAncestors, ownerId],
    rootAccountId: ownerRoot,
    accountStatus: 'active',
  });
  return account._id;
}

async function migrate(): Promise<void> {
  const dryRun = isDryRun();
  if (dryRun) logger.info('DRY RUN — no writes will be performed');

  const workspaces = rawDb().collection('workspaces');
  const workspaceMembers = rawDb().collection('workspacemembers');

  const teamWorkspaces = await workspaces.find({ type: 'team' }).toArray();
  logger.info('Team workspaces', { count: teamWorkspaces.length });

  const mapping: MappingRow[] = [];
  let minted = 0;
  let membersEnsured = 0;

  for (const ws of teamWorkspaces) {
    const workspaceId = ws._id as mongoose.Types.ObjectId;
    const ownerId = ws.ownerId as mongoose.Types.ObjectId;
    const name = (ws.name as string) || 'Organization';
    const slug = ws.slug as string | undefined;
    if (!ownerId) continue;

    const isOxyWorkspace = workspaceId.toString() === OXY_WORKSPACE_ID;
    if (isOxyWorkspace) {
      const oxyOwner = await rawDb()
        .collection('users')
        .findOne({ _id: ownerId }, { projection: { authMethods: 1, username: 1 } });
      const hasLogin = Array.isArray(oxyOwner?.authMethods) && oxyOwner.authMethods.length > 0;
      logger.info('Oxy workspace special case', {
        ownerUsername: oxyOwner?.username,
        ownerHasLogin: hasLogin,
        note: 'Minting a NEW org account under the oxy user — never converting the login in place',
      });
    }

    // Idempotency: reuse a previously-minted org for this workspace.
    let orgAccountId = await findMintedAccount('workspace', workspaceId);
    let wasMinted = false;
    if (!orgAccountId) {
      orgAccountId = await mintOrgAccount(
        isOxyWorkspace ? OXY_ACCOUNT_NAME : name,
        ownerId,
        slug,
        dryRun
      );
      wasMinted = true;
      minted += 1;
      if (!dryRun) {
        await recordMintedAccount('workspace', workspaceId, orgAccountId);
      }
    }

    // Owner membership (idempotent).
    if (await ensureMember(orgAccountId, ownerId, 'owner', ownerId, dryRun)) {
      membersEnsured += 1;
    }

    // Remaining workspace members → account members.
    const members = await workspaceMembers
      .find({ workspaceId, status: 'active' })
      .toArray();
    for (const member of members) {
      const memberUserId = member.userId as mongoose.Types.ObjectId;
      if (!memberUserId || memberUserId.equals(ownerId)) continue;
      const wrote = await ensureMember(
        orgAccountId,
        memberUserId,
        mapWorkspaceRole(member.role as string),
        ownerId,
        dryRun
      );
      if (wrote) membersEnsured += 1;
    }

    mapping.push({
      workspaceId: workspaceId.toString(),
      name,
      ownerId: ownerId.toString(),
      orgAccountId: orgAccountId.toString(),
      minted: wasMinted,
    });
  }

  logger.info('Phase 2 summary', {
    dryRun,
    teamWorkspaces: teamWorkspaces.length,
    minted,
    membersEnsured,
  });
  // eslint-disable-next-line no-console
  console.log('OXY_ACCOUNTS_WORKSPACE_MAP=' + JSON.stringify(mapping));
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
    'Phase 2 (workspaces → orgs) failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-accounts-20' }
  );
  process.exit(1);
});
