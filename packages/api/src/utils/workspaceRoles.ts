/**
 * Workspace (organization/tenant) membership roles → permission map.
 *
 * Each WorkspaceMember has a `role`; the concrete `permissions` array stored on
 * the member document is derived from this map at write time via
 * `permissionsForRole`. Routes gate actions on individual permission strings
 * (see `requireWorkspacePermission`) rather than on the role directly, so the
 * role map is the single source of truth for what each role may do.
 *
 * Mirrors the conventions of `applicationRoles.ts`. A workspace is the parent
 * tenant that owns Applications; `apps:*` permissions gate which members may
 * list/create/update/delete the workspace's applications, while `workspace:*`
 * and `members:*` govern the workspace itself.
 */

export const WORKSPACE_PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'apps:read',
  'apps:create',
  'apps:update',
  'apps:delete',
  'ownership:transfer',
] as const;

export type WorkspacePermission = (typeof WORKSPACE_PERMISSIONS)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const OWNER_PERMISSIONS: readonly WorkspacePermission[] = [...WORKSPACE_PERMISSIONS];

const ADMIN_PERMISSIONS: readonly WorkspacePermission[] = [
  'workspace:read',
  'workspace:update',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'apps:read',
  'apps:create',
  'apps:update',
  'apps:delete',
];

const MEMBER_PERMISSIONS: readonly WorkspacePermission[] = [
  'workspace:read',
  'members:read',
  'apps:read',
  'apps:create',
];

const VIEWER_PERMISSIONS: readonly WorkspacePermission[] = [
  'workspace:read',
  'members:read',
  'apps:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<WorkspaceRole, readonly WorkspacePermission[]>> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  member: MEMBER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/**
 * Resolve the concrete permission list for a role. Returns a fresh array so the
 * caller can persist it without aliasing the shared constant.
 */
export function permissionsForRole(role: WorkspaceRole): WorkspacePermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Type guard for an arbitrary string being a valid workspace role.
 */
export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(value);
}
