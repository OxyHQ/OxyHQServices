import crypto from 'crypto';
import mongoose from 'mongoose';
import { Workspace, IWorkspace } from '../models/Workspace';
import { WorkspaceMember, IWorkspaceMember } from '../models/WorkspaceMember';
import { permissionsForRole } from './workspaceRoles';

/** Default display name for an auto-provisioned personal workspace. */
export const PERSONAL_WORKSPACE_NAME = 'Personal';

const SLUG_RANDOM_BYTES = 4;
const MAX_SLUG_BASE_LENGTH = 48;

/**
 * Build a URL-safe, lowercase slug base from an arbitrary name. Strips
 * diacritics-unaware (ASCII-only) non-alphanumerics, collapses runs to single
 * hyphens, trims leading/trailing hyphens, and caps length. Falls back to
 * `workspace` when the input reduces to an empty string.
 */
export function slugifyWorkspaceName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : 'workspace';
}

/**
 * Generate a globally-unique slug for a workspace derived from `name`.
 *
 * Tries the bare slug first; on collision appends a short random suffix and
 * retries. The unique index on `Workspace.slug` is the ultimate guard against
 * races — this just minimises churn so the common case yields a clean slug.
 */
export async function generateUniqueWorkspaceSlug(name: string): Promise<string> {
  const baseSlug = slugifyWorkspaceName(name);

  const existing = await Workspace.findOne({ slug: baseSlug }).select('_id').lean();
  if (!existing) {
    return baseSlug;
  }

  // Collision — append random suffixes until a free slug is found. Bounded loop
  // so a pathological collision storm can never hang the request.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto.randomBytes(SLUG_RANDOM_BYTES).toString('hex');
    const candidate = `${baseSlug}-${suffix}`;
    const clash = await Workspace.findOne({ slug: candidate }).select('_id').lean();
    if (!clash) {
      return candidate;
    }
  }

  // Extremely unlikely fallthrough — use a full random token, still namespaced.
  return `${baseSlug}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Idempotently ensure the user has a `personal` workspace, returning it.
 *
 * If a personal workspace already exists for the user it is returned unchanged.
 * Otherwise a new `type:'personal'` workspace named {@link PERSONAL_WORKSPACE_NAME}
 * is created, owned by the user, together with an `owner` WorkspaceMember.
 *
 * Safe to call on every login / list path — it performs no writes once the
 * personal workspace exists.
 */
export async function ensurePersonalWorkspace(
  userId: string | mongoose.Types.ObjectId
): Promise<IWorkspace> {
  const ownerObjectId =
    typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

  const existing = await Workspace.findOne({
    ownerId: ownerObjectId,
    type: 'personal',
    status: 'active',
  });
  if (existing) {
    return existing;
  }

  const slug = await generateUniqueWorkspaceSlug(
    `${PERSONAL_WORKSPACE_NAME}-${ownerObjectId.toString()}`
  );

  const workspace = await Workspace.create({
    name: PERSONAL_WORKSPACE_NAME,
    slug,
    type: 'personal',
    ownerId: ownerObjectId,
    status: 'active',
  });

  await ensureOwnerMembership(workspace._id, ownerObjectId);

  return workspace;
}

/**
 * Idempotently ensure `userId` holds an active `owner` WorkspaceMember row for
 * `workspaceId`. Re-activates/promotes an existing row rather than creating a
 * duplicate (the unique compound index forbids duplicates). Returns the member.
 */
export async function ensureOwnerMembership(
  workspaceId: mongoose.Types.ObjectId,
  userId: mongoose.Types.ObjectId
): Promise<IWorkspaceMember> {
  const ownerPermissions = permissionsForRole('owner');

  const existing = await WorkspaceMember.findOne({ workspaceId, userId });
  if (existing) {
    let dirty = false;
    if (existing.role !== 'owner') {
      existing.role = 'owner';
      existing.permissions = ownerPermissions;
      dirty = true;
    }
    if (existing.status !== 'active') {
      existing.status = 'active';
      existing.joinedAt = existing.joinedAt ?? new Date();
      dirty = true;
    }
    if (dirty) {
      await existing.save();
    }
    return existing;
  }

  return WorkspaceMember.create({
    workspaceId,
    userId,
    role: 'owner',
    permissions: ownerPermissions,
    status: 'active',
    joinedAt: new Date(),
  });
}
