#!/usr/bin/env bun
/**
 * Idempotent migration: backfill `Application.workspaceId` for every existing
 * application that does not yet belong to a Workspace, provisioning the owning
 * Workspace + owner WorkspaceMember as needed.
 *
 * Backfill rules:
 *   1. SPECIAL CASE — apps owned by the platform user `oxy` (username 'oxy'):
 *      ensure a single `type:'team'` Workspace named "Oxy" (idempotent, keyed by
 *      name + ownerId = oxyId) with an owner WorkspaceMember, and point ALL of
 *      oxy's applications at it (NOT oxy's personal workspace).
 *   2. EVERY OTHER app WITHOUT a workspaceId: ensure the owner
 *      (`createdByUserId`) has a personal Workspace (idempotent) and point the
 *      app at that personal workspace.
 *
 * Apps that ALREADY carry a workspaceId are left untouched.
 *
 * Safety (mirrors scripts/seed-oxy-applications.ts):
 *   - No deletes, no drops, no modification of unrelated documents/fields.
 *   - Re-running performs 0 writes once migrated (verified by the summary).
 *   - DRY_RUN=true reports the plan without writing.
 *
 * Run (inside the oxy-api image, working dir /app):
 *   bun run packages/api/scripts/migrate-workspaces.ts
 *
 * Env:
 *   MONGODB_URI   required (injected by ECS from SSM)
 *   OXY_USERNAME  platform owner username to resolve (default 'oxy')
 *   OXY_WORKSPACE_NAME  team workspace name for oxy's apps (default 'Oxy')
 *   DRY_RUN=true  plan only, no writes
 */

import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { Workspace } from '../src/models/Workspace';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { User } from '../src/models/User';
import { permissionsForRole } from '../src/utils/workspaceRoles';
import {
  ensurePersonalWorkspace,
  generateUniqueWorkspaceSlug,
} from '../src/utils/workspaceProvisioning';
import { logger } from '../src/utils/logger';

interface MappingRow {
  applicationId: string;
  name: string;
  ownerId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceType: 'personal' | 'team';
  changed: boolean;
}

/**
 * Idempotently ensure the named `type:'team'` Workspace owned by `ownerId`
 * (keyed by name + ownerId), with an owner WorkspaceMember. Returns its id.
 */
async function ensureNamedTeamWorkspace(
  name: string,
  ownerId: mongoose.Types.ObjectId,
  dryRun: boolean
): Promise<{ id: mongoose.Types.ObjectId; created: boolean }> {
  const existing = await Workspace.findOne({
    name,
    ownerId,
    type: 'team',
    status: 'active',
  });
  if (existing) {
    // Backfill the owner membership in case it is missing (idempotent).
    const member = await WorkspaceMember.findOne({ workspaceId: existing._id, userId: ownerId });
    if (!member && !dryRun) {
      await WorkspaceMember.create({
        workspaceId: existing._id,
        userId: ownerId,
        role: 'owner',
        permissions: permissionsForRole('owner'),
        status: 'active',
        joinedAt: new Date(),
      });
    }
    return { id: existing._id, created: false };
  }

  if (dryRun) {
    // Synthesize a placeholder id for the dry-run mapping.
    return { id: new mongoose.Types.ObjectId('000000000000000000000000'), created: true };
  }

  const slug = await generateUniqueWorkspaceSlug(name);
  const workspace = await Workspace.create({
    name,
    slug,
    type: 'team',
    ownerId,
    status: 'active',
  });
  await WorkspaceMember.create({
    workspaceId: workspace._id,
    userId: ownerId,
    role: 'owner',
    permissions: permissionsForRole('owner'),
    status: 'active',
    joinedAt: new Date(),
  });
  return { id: workspace._id, created: true };
}

async function migrate(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  const ownerUsername = process.env.OXY_USERNAME || 'oxy';
  const oxyWorkspaceName = process.env.OXY_WORKSPACE_NAME || 'Oxy';

  if (dryRun) {
    logger.info('DRY RUN — no writes will be performed');
  }

  // Resolve the platform owner `oxy` (special-cased into the "Oxy" team workspace).
  const owner = await User.findOne({ username: ownerUsername }).select('_id username').lean();
  const oxyId = owner?._id as mongoose.Types.ObjectId | undefined;
  if (oxyId) {
    logger.info('Resolved platform owner', {
      username: ownerUsername,
      oxyId: oxyId.toString(),
    });
  } else {
    logger.warn(
      `Platform owner "${ownerUsername}" not found — its apps (if any) will be ` +
        'treated like any other owner (personal workspace). No "Oxy" team workspace will be created.'
    );
  }

  // Apps still lacking a workspaceId.
  const orphanApps = await Application.find({
    $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }],
  });
  logger.info('Applications without a workspaceId', { count: orphanApps.length });

  // Lazily create the "Oxy" team workspace only if oxy actually owns orphan apps.
  let oxyWorkspaceId: mongoose.Types.ObjectId | null = null;
  let oxyWorkspaceCreated = false;
  if (oxyId) {
    const oxyOrphanCount = orphanApps.filter((app) => app.createdByUserId.equals(oxyId)).length;
    if (oxyOrphanCount > 0) {
      const result = await ensureNamedTeamWorkspace(oxyWorkspaceName, oxyId, dryRun);
      oxyWorkspaceId = result.id;
      oxyWorkspaceCreated = result.created;
      logger.info('Oxy team workspace', {
        name: oxyWorkspaceName,
        workspaceId: oxyWorkspaceId.toString(),
        created: oxyWorkspaceCreated,
        oxyOrphanApps: oxyOrphanCount,
      });
    }
  }

  // Cache personal workspace ids per owner so we don't re-resolve per app.
  const personalWorkspaceByOwner = new Map<string, mongoose.Types.ObjectId>();
  const personalWorkspaceNameById = new Map<string, string>();

  const mapping: MappingRow[] = [];
  let appsChanged = 0;
  let personalWorkspacesEnsured = 0;

  for (const app of orphanApps) {
    const ownerObjectId = app.createdByUserId;
    let targetWorkspaceId: mongoose.Types.ObjectId;
    let workspaceName: string;
    let workspaceType: 'personal' | 'team';

    if (oxyId && oxyWorkspaceId && ownerObjectId.equals(oxyId)) {
      targetWorkspaceId = oxyWorkspaceId;
      workspaceName = oxyWorkspaceName;
      workspaceType = 'team';
    } else {
      const ownerKey = ownerObjectId.toString();
      let personalId = personalWorkspaceByOwner.get(ownerKey);
      if (!personalId) {
        if (dryRun) {
          // Cannot create in dry-run; reflect whatever already exists, else a
          // synthetic placeholder.
          const existingPersonal = await Workspace.findOne({
            ownerId: ownerObjectId,
            type: 'personal',
            status: 'active',
          }).select('_id name');
          personalId =
            existingPersonal?._id ?? new mongoose.Types.ObjectId('000000000000000000000000');
          personalWorkspaceNameById.set(personalId.toString(), existingPersonal?.name ?? 'Personal');
        } else {
          const personal = await ensurePersonalWorkspace(ownerObjectId);
          personalId = personal._id;
          personalWorkspaceNameById.set(personalId.toString(), personal.name);
          personalWorkspacesEnsured += 1;
        }
        personalWorkspaceByOwner.set(ownerKey, personalId);
      }
      targetWorkspaceId = personalId;
      workspaceName = personalWorkspaceNameById.get(personalId.toString()) ?? 'Personal';
      workspaceType = 'personal';
    }

    if (!dryRun) {
      app.workspaceId = targetWorkspaceId;
      await app.save();
    }
    appsChanged += 1;

    mapping.push({
      applicationId: app._id.toString(),
      name: app.name,
      ownerId: ownerObjectId.toString(),
      workspaceId: targetWorkspaceId.toString(),
      workspaceName,
      workspaceType,
      changed: true,
    });
  }

  logger.info('Migration summary', {
    dryRun,
    orphanApps: orphanApps.length,
    appsChanged,
    personalWorkspacesEnsured,
    oxyWorkspaceCreated,
  });

  // Read-back proof.
  const remaining = await Application.countDocuments({
    $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }],
  });
  logger.info('Read-back: applications still missing a workspaceId', { count: remaining });

  // Emit the mapping as a single parseable JSON line.
  // eslint-disable-next-line no-console
  console.log('OXY_WORKSPACE_MIGRATION_JSON=' + JSON.stringify(mapping));
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
    'Workspace migration failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'migrate-workspaces', method: 'main' }
  );
  process.exit(1);
});
