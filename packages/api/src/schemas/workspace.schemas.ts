import { z } from 'zod';
import { WORKSPACE_ROLES } from '../utils/workspaceRoles';

/** Route params with :id. */
export const workspaceIdRouteParams = z.object({
  id: z.string().trim().min(1),
});

/** Route params with :id and :memberId. */
export const workspaceMemberParams = z.object({
  id: z.string().trim().min(1),
  memberId: z.string().trim().min(1),
});

/**
 * POST /workspaces — create a team workspace.
 *
 * `type` is intentionally absent: the route always creates `type:'team'`
 * workspaces. Personal workspaces are auto-provisioned, never user-created.
 */
export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  icon: z.string().optional(),
});

/** PATCH /workspaces/:id — partial update. `slug` and `type` are immutable. */
export const updateWorkspaceSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional().nullable(),
    icon: z.string().optional().nullable(),
  })
  .strict();

/** Roles assignable to a member (owner is reachable only via transfer-ownership). */
const assignableRoles = WORKSPACE_ROLES.filter((role) => role !== 'owner') as Exclude<
  (typeof WORKSPACE_ROLES)[number],
  'owner'
>[];

/**
 * POST /workspaces/:id/members — invite/add a member.
 *
 * `usernameOrEmail` is resolved to a userId server-side (people know usernames
 * and emails, not opaque Mongo ids). See `utils/resolveUserIdentifier.ts`.
 */
export const inviteWorkspaceMemberSchema = z.object({
  usernameOrEmail: z.string().trim().min(1),
  role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
});

/** PATCH /workspaces/:id/members/:memberId — change a member role. */
export const updateWorkspaceMemberSchema = z.object({
  role: z.enum(assignableRoles as [typeof assignableRoles[number], ...typeof assignableRoles]),
});

/** POST /workspaces/:id/transfer-ownership. */
export const transferWorkspaceOwnershipSchema = z.object({
  userId: z.string().trim().min(1),
});
