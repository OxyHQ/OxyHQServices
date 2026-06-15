import express from 'express';
import mongoose from 'mongoose';
import { Workspace, IWorkspace } from '../models/Workspace';
import { WorkspaceMember, IWorkspaceMember } from '../models/WorkspaceMember';
import { Application } from '../models/Application';
import { authMiddleware, type AuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/error';
import { logger } from '../utils/logger';
import {
  permissionsForRole,
  type WorkspacePermission,
  type WorkspaceRole,
} from '../utils/workspaceRoles';
import {
  ensurePersonalWorkspace,
  generateUniqueWorkspaceSlug,
} from '../utils/workspaceProvisioning';
import {
  workspaceIdRouteParams,
  workspaceMemberParams,
  createWorkspaceSchema,
  updateWorkspaceSchema,
  inviteWorkspaceMemberSchema,
  updateWorkspaceMemberSchema,
  transferWorkspaceOwnershipSchema,
} from '../schemas/workspace.schemas';

/**
 * Request decorated by `loadWorkspaceContext` / `requireWorkspacePermission`
 * with the resolved workspace and the caller's active membership row.
 */
interface WorkspaceContextRequest extends AuthRequest {
  workspace?: IWorkspace;
  membership?: IWorkspaceMember;
}

const router = express.Router();

// All workspace routes require an authenticated user.
router.use(authMiddleware);

/** Resolve the authenticated user id, or throw 401. */
function requireUserId(req: AuthRequest): string {
  const userId = req.user?._id?.toString();
  if (!userId) {
    throw new UnauthorizedError('Authentication required');
  }
  return userId;
}

/**
 * Serialise a workspace for client responses.
 *
 * When the caller's own membership is supplied it is embedded as
 * `callerMembership` so the Console can gate UI on
 * `workspace.callerMembership.permissions` regardless of whether the role
 * carries `members:read`.
 */
function serializeWorkspace(
  workspace: IWorkspace,
  callerMembership?: IWorkspaceMember | null
) {
  return {
    _id: workspace._id.toString(),
    name: workspace.name,
    slug: workspace.slug,
    type: workspace.type,
    description: workspace.description,
    icon: workspace.icon,
    ownerId: workspace.ownerId.toString(),
    status: workspace.status,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    callerMembership: callerMembership ? serializeMember(callerMembership) : null,
  };
}

/** Serialise a membership for client responses. */
function serializeMember(member: IWorkspaceMember) {
  return {
    _id: member._id.toString(),
    workspaceId: member.workspaceId.toString(),
    userId: member.userId.toString(),
    role: member.role,
    permissions: member.permissions,
    invitedByUserId: member.invitedByUserId?.toString(),
    joinedAt: member.joinedAt,
    status: member.status,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,
  };
}

/**
 * Resolve the workspace (non-deleted) and the caller's active membership for
 * `:id`. Returns 404 when the workspace is missing/deleted and 403 when the
 * caller is not an active member. Attaches both to the request.
 */
async function loadWorkspaceContext(req: WorkspaceContextRequest): Promise<{
  workspace: IWorkspace;
  membership: IWorkspaceMember;
}> {
  const userId = requireUserId(req);
  const workspaceId = req.params.id;

  if (!mongoose.isValidObjectId(workspaceId)) {
    throw new NotFoundError('Workspace not found');
  }

  const workspace = await Workspace.findOne({
    _id: workspaceId,
    status: { $ne: 'deleted' },
  });
  if (!workspace) {
    throw new NotFoundError('Workspace not found');
  }

  const membership = await WorkspaceMember.findOne({
    workspaceId: workspace._id,
    userId,
    status: 'active',
  });
  if (!membership) {
    throw new ForbiddenError('You are not a member of this workspace');
  }

  req.workspace = workspace;
  req.membership = membership;
  return { workspace, membership };
}

/**
 * RBAC middleware factory. Resolves the workspace + caller's active membership
 * for `:id`, then enforces that the membership carries `permission`.
 */
function requireWorkspacePermission(permission: WorkspacePermission) {
  return asyncHandler(async (req: WorkspaceContextRequest, _res, next) => {
    const { membership } = await loadWorkspaceContext(req);
    if (!membership.permissions.includes(permission)) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
    next();
  });
}

// ============================================================================
// Workspaces — CRUD
// ============================================================================

/**
 * List workspaces the caller is an active member of.
 *
 * Auto-provisions the caller's personal workspace when they belong to none, so
 * the list is never empty for an authenticated user.
 */
router.get(
  '/',
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);

    let memberships = await WorkspaceMember.find({ userId, status: 'active' });

    // Cold start for a brand-new user: ensure a personal workspace exists so the
    // Console always has at least one workspace to render.
    if (memberships.length === 0) {
      await ensurePersonalWorkspace(userId);
      memberships = await WorkspaceMember.find({ userId, status: 'active' });
    }

    const membershipByWorkspaceId = new Map<string, IWorkspaceMember>();
    for (const membership of memberships) {
      membershipByWorkspaceId.set(membership.workspaceId.toString(), membership);
    }

    const workspaces = await Workspace.find({
      _id: { $in: memberships.map((m) => m.workspaceId) },
      status: { $ne: 'deleted' },
    }).sort({ createdAt: 1 });

    res.json({
      workspaces: workspaces.map((workspace) =>
        serializeWorkspace(workspace, membershipByWorkspaceId.get(workspace._id.toString()))
      ),
    });
  })
);

/**
 * Create a new team workspace. The creator is automatically added as an active
 * `owner` member. The slug is auto-generated (unique) from the name.
 */
router.post(
  '/',
  validate({ body: createWorkspaceSchema }),
  asyncHandler(async (req: AuthRequest, res) => {
    const userId = requireUserId(req);
    const body = req.body as {
      name: string;
      description?: string;
      icon?: string;
    };

    const slug = await generateUniqueWorkspaceSlug(body.name);

    const workspace = await Workspace.create({
      name: body.name,
      slug,
      type: 'team',
      description: body.description,
      icon: body.icon,
      ownerId: new mongoose.Types.ObjectId(userId),
      status: 'active',
    });

    const membership = await WorkspaceMember.create({
      workspaceId: workspace._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
      permissions: permissionsForRole('owner'),
      status: 'active',
      joinedAt: new Date(),
    });

    logger.info('Workspace created', {
      userId,
      workspaceId: workspace._id.toString(),
      slug: workspace.slug,
      name: workspace.name,
    });

    res.status(201).json({ workspace: serializeWorkspace(workspace, membership) });
  })
);

/**
 * Get a single workspace the caller is a member of.
 */
router.get(
  '/:id',
  validate({ params: workspaceIdRouteParams }),
  requireWorkspacePermission('workspace:read'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }
    res.json({ workspace: serializeWorkspace(workspace, req.membership) });
  })
);

/**
 * Partially update a workspace (`workspace:update`).
 */
router.patch(
  '/:id',
  validate({ params: workspaceIdRouteParams, body: updateWorkspaceSchema }),
  requireWorkspacePermission('workspace:update'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }

    const body = req.body as {
      name?: string;
      description?: string | null;
      icon?: string | null;
    };

    if (body.name !== undefined) workspace.name = body.name;
    if (body.description !== undefined) {
      workspace.description = body.description ?? undefined;
    }
    if (body.icon !== undefined) {
      workspace.icon = body.icon ?? undefined;
    }

    await workspace.save();

    logger.info('Workspace updated', {
      userId: requireUserId(req),
      workspaceId: workspace._id.toString(),
    });

    res.json({ workspace: serializeWorkspace(workspace, req.membership) });
  })
);

/**
 * Soft-delete a workspace.
 *
 * Guards:
 *  - owner only (`workspace:delete`, which only the `owner` role carries);
 *  - a `personal` workspace can NEVER be deleted;
 *  - a workspace that still owns applications is rejected with 409 — move or
 *    delete its applications first.
 */
router.delete(
  '/:id',
  validate({ params: workspaceIdRouteParams }),
  requireWorkspacePermission('workspace:delete'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    const callerMembership = req.membership;
    if (!workspace || !callerMembership) {
      throw new NotFoundError('Workspace not found');
    }

    if (callerMembership.role !== 'owner') {
      throw new ForbiddenError('Only the workspace owner may delete a workspace');
    }

    if (workspace.type === 'personal') {
      throw new BadRequestError('A personal workspace cannot be deleted');
    }

    const appCount = await Application.countDocuments({
      workspaceId: workspace._id,
      status: { $ne: 'deleted' },
    });
    if (appCount > 0) {
      throw new ConflictError(
        `Cannot delete a workspace that still owns ${appCount} application(s). ` +
          'Move or delete its applications first.',
        { applicationCount: appCount }
      );
    }

    workspace.status = 'deleted';
    await workspace.save();

    logger.info('Workspace deleted', {
      userId: requireUserId(req),
      workspaceId: workspace._id.toString(),
    });

    res.json({ success: true });
  })
);

// ============================================================================
// Members
// ============================================================================

/**
 * List members of a workspace.
 */
router.get(
  '/:id/members',
  validate({ params: workspaceIdRouteParams }),
  requireWorkspacePermission('members:read'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }

    const members = await WorkspaceMember.find({
      workspaceId: workspace._id,
      status: { $ne: 'removed' },
    }).sort({ createdAt: 1 });

    res.json({ members: members.map(serializeMember) });
  })
);

/**
 * Add a member to a workspace (role != owner). Re-activates a previously removed
 * membership instead of creating a duplicate.
 */
router.post(
  '/:id/members',
  validate({ params: workspaceIdRouteParams, body: inviteWorkspaceMemberSchema }),
  requireWorkspacePermission('members:invite'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    if (!workspace) {
      throw new NotFoundError('Workspace not found');
    }

    const { userId: targetUserId, role } = req.body as {
      userId: string;
      role: WorkspaceRole;
    };
    if (!mongoose.isValidObjectId(targetUserId)) {
      throw new BadRequestError('Invalid userId');
    }

    const callerUserId = requireUserId(req);
    const targetUserObjectId = new mongoose.Types.ObjectId(targetUserId);

    const existing = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: targetUserObjectId,
    });

    if (existing && existing.status === 'active') {
      throw new BadRequestError('User is already a member of this workspace');
    }

    const permissions = permissionsForRole(role);

    let member: IWorkspaceMember;
    if (existing) {
      existing.role = role;
      existing.permissions = permissions;
      existing.status = 'active';
      existing.invitedByUserId = new mongoose.Types.ObjectId(callerUserId);
      existing.joinedAt = new Date();
      member = await existing.save();
    } else {
      member = await WorkspaceMember.create({
        workspaceId: workspace._id,
        userId: targetUserObjectId,
        role,
        permissions,
        status: 'active',
        invitedByUserId: new mongoose.Types.ObjectId(callerUserId),
        joinedAt: new Date(),
      });
    }

    logger.info('Workspace member added', {
      workspaceId: workspace._id.toString(),
      memberId: member._id.toString(),
      role,
      by: callerUserId,
    });

    res.status(201).json({ member: serializeMember(member) });
  })
);

/**
 * Change a member's role. An owner's role can only be changed via
 * transfer-ownership.
 */
router.patch(
  '/:id/members/:memberId',
  validate({ params: workspaceMemberParams, body: updateWorkspaceMemberSchema }),
  requireWorkspacePermission('members:update'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    const callerMembership = req.membership;
    if (!workspace || !callerMembership) {
      throw new NotFoundError('Workspace not found');
    }

    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }

    const member = await WorkspaceMember.findOne({
      _id: req.params.memberId,
      workspaceId: workspace._id,
      status: { $ne: 'removed' },
    });
    if (!member) {
      throw new NotFoundError('Member not found');
    }

    if (member.role === 'owner') {
      throw new ForbiddenError(
        "An owner's role can only be changed via transfer-ownership"
      );
    }

    const { role } = req.body as { role: WorkspaceRole };
    member.role = role;
    member.permissions = permissionsForRole(role);
    await member.save();

    logger.info('Workspace member role updated', {
      workspaceId: workspace._id.toString(),
      memberId: member._id.toString(),
      role,
      by: requireUserId(req),
    });

    res.json({ member: serializeMember(member) });
  })
);

/**
 * Remove a member. The last owner cannot be removed; an owner can only be
 * removed by another owner.
 */
router.delete(
  '/:id/members/:memberId',
  validate({ params: workspaceMemberParams }),
  requireWorkspacePermission('members:remove'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    const callerMembership = req.membership;
    if (!workspace || !callerMembership) {
      throw new NotFoundError('Workspace not found');
    }

    if (!mongoose.isValidObjectId(req.params.memberId)) {
      throw new NotFoundError('Member not found');
    }

    const member = await WorkspaceMember.findOne({
      _id: req.params.memberId,
      workspaceId: workspace._id,
      status: { $ne: 'removed' },
    });
    if (!member) {
      throw new NotFoundError('Member not found');
    }

    if (member.role === 'owner') {
      if (callerMembership.role !== 'owner') {
        throw new ForbiddenError('Only an owner may remove another owner');
      }
      const ownerCount = await WorkspaceMember.countDocuments({
        workspaceId: workspace._id,
        role: 'owner',
        status: 'active',
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot remove the last owner of a workspace');
      }
    }

    member.status = 'removed';
    await member.save();

    logger.info('Workspace member removed', {
      workspaceId: workspace._id.toString(),
      memberId: member._id.toString(),
      by: requireUserId(req),
    });

    res.json({ success: true });
  })
);

/**
 * Transfer ownership to another active member (owner only). The current owner is
 * demoted to `admin`; the target is promoted to `owner`. Also re-points the
 * workspace's `ownerId` to the new owner.
 */
router.post(
  '/:id/transfer-ownership',
  validate({ params: workspaceIdRouteParams, body: transferWorkspaceOwnershipSchema }),
  requireWorkspacePermission('ownership:transfer'),
  asyncHandler(async (req: WorkspaceContextRequest, res) => {
    const workspace = req.workspace;
    const callerMembership = req.membership;
    if (!workspace || !callerMembership) {
      throw new NotFoundError('Workspace not found');
    }

    const { userId: targetUserId } = req.body as { userId: string };
    if (!mongoose.isValidObjectId(targetUserId)) {
      throw new BadRequestError('Invalid userId');
    }

    const targetMember = await WorkspaceMember.findOne({
      workspaceId: workspace._id,
      userId: new mongoose.Types.ObjectId(targetUserId),
      status: 'active',
    });
    if (!targetMember) {
      throw new NotFoundError('Target user is not an active member of this workspace');
    }

    if (targetMember._id.equals(callerMembership._id)) {
      throw new BadRequestError('You already own this workspace');
    }

    targetMember.role = 'owner';
    targetMember.permissions = permissionsForRole('owner');

    callerMembership.role = 'admin';
    callerMembership.permissions = permissionsForRole('admin');

    workspace.ownerId = targetMember.userId;

    await targetMember.save();
    await callerMembership.save();
    await workspace.save();

    logger.info('Workspace ownership transferred', {
      workspaceId: workspace._id.toString(),
      from: requireUserId(req),
      to: targetUserId,
    });

    res.json({ success: true });
  })
);

export default router;
