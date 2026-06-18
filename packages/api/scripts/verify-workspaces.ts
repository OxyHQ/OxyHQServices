#!/usr/bin/env bun
/**
 * READ-ONLY verification of the workspace migration. NO writes.
 *
 * Reports:
 *   - The "Oxy" team workspace: _id, slug, type, status, ownerId + its owner member.
 *   - That all 12 oxy apps carry workspaceId == the Oxy workspace id.
 *   - Count of personal workspaces in the collection.
 *   - Any oxy app NOT pointing at the Oxy workspace (should be none).
 *
 * Run (inside oxy-api image, working dir /app):
 *   bun run packages/api/scripts/verify-workspaces.ts
 */

import mongoose from 'mongoose';
import { Application } from '../src/models/Application';
import { Workspace } from '../src/models/Workspace';
import { WorkspaceMember } from '../src/models/WorkspaceMember';
import { logger } from '../src/utils/logger';

const OXY_ID = '69b2d3df5d12f58c9800d651';
const OXY_WORKSPACE_NAME = 'Oxy';

function writeVerifyJson(out: Record<string, unknown>): void {
  process.stdout.write(`VERIFY_JSON=${JSON.stringify(out, null, 2)}\n`);
}

async function run(): Promise<void> {
  const out: Record<string, unknown> = {};
  const oxyId = new mongoose.Types.ObjectId(OXY_ID);

  // ── Oxy team workspace ──
  const oxyWs = await Workspace.findOne({
    name: OXY_WORKSPACE_NAME,
    ownerId: oxyId,
    type: 'team',
    status: 'active',
  }).lean();

  if (!oxyWs) {
    out.error = 'Oxy team workspace not found';
    writeVerifyJson(out);
    return;
  }

  const oxyWsId = oxyWs._id as mongoose.Types.ObjectId;
  out.oxyWorkspace = {
    _id: String(oxyWsId),
    name: oxyWs.name,
    slug: oxyWs.slug,
    type: oxyWs.type,
    status: oxyWs.status,
    ownerId: String(oxyWs.ownerId),
  };

  // Count how many "Oxy" team workspaces owned by oxy exist (idempotency: must be 1).
  out.oxyWorkspaceCountForOwner = await Workspace.countDocuments({
    name: OXY_WORKSPACE_NAME,
    ownerId: oxyId,
    type: 'team',
    status: 'active',
  });

  // ── Owner membership ──
  const ownerMember = await WorkspaceMember.findOne({
    workspaceId: oxyWsId,
    userId: oxyId,
  }).lean();
  out.oxyWorkspaceOwnerMember = ownerMember
    ? {
        _id: String(ownerMember._id),
        userId: String(ownerMember.userId),
        role: ownerMember.role,
        status: ownerMember.status,
        permissionsCount: Array.isArray(ownerMember.permissions)
          ? ownerMember.permissions.length
          : 0,
      }
    : null;

  // ── All apps owned by oxy and their workspaceId ──
  const oxyApps = await Application.find({ createdByUserId: oxyId })
    .select('_id name workspaceId')
    .sort({ name: 1 })
    .lean();

  out.oxyAppCount = oxyApps.length;
  out.oxyAppsPointingAtOxyWorkspace = oxyApps.filter(
    (a) => a.workspaceId && String(a.workspaceId) === String(oxyWsId)
  ).length;
  out.oxyAppsNotPointingAtOxyWorkspace = oxyApps
    .filter((a) => !a.workspaceId || String(a.workspaceId) !== String(oxyWsId))
    .map((a) => ({ name: a.name, _id: String(a._id), workspaceId: a.workspaceId ? String(a.workspaceId) : null }));
  out.oxyApps = oxyApps.map((a) => ({
    name: a.name,
    _id: String(a._id),
    workspaceId: a.workspaceId ? String(a.workspaceId) : null,
  }));

  // ── Personal workspaces count + total workspaces ──
  out.personalWorkspaceCount = await Workspace.countDocuments({ type: 'personal' });
  out.totalWorkspaceCount = await Workspace.countDocuments({});
  out.teamWorkspaceCount = await Workspace.countDocuments({ type: 'team' });

  // ── Any application anywhere still missing a workspaceId ──
  out.applicationsMissingWorkspaceId = await Application.countDocuments({
    $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }],
  });

  writeVerifyJson(out);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    logger.error('MONGODB_URI is required');
    process.exit(1);
  }
  await mongoose.connect(uri);
  logger.info('Connected to MongoDB (read-only verify)');
  try {
    await run();
  } finally {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  }
}

main().catch((error) => {
  logger.error(
    'Verify failed',
    error instanceof Error ? error : new Error(String(error)),
    { component: 'verify-workspaces', method: 'main' }
  );
  process.exit(1);
});
