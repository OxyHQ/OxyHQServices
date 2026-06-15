/**
 * Application membership roles → permission map.
 *
 * Each ApplicationMember has a `role`; the concrete `permissions` array stored
 * on the member document is derived from this map at write time via
 * `permissionsForRole`. Routes gate actions on individual permission strings
 * (see `requireAppPermission`) rather than on the role directly, so the role
 * map is the single source of truth for what each role may do.
 *
 * Staff-only application fields (`type`, `isOfficial`, `isInternal`,
 * `capabilities`) are intentionally NOT represented here — they are not
 * grantable via any role and are gated behind the platform staff guard
 * (`requireStaff`). See `Application.ts`.
 */

export const APPLICATION_PERMISSIONS = [
  'app:read',
  'app:update',
  'app:delete',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
  'webhooks:read',
  'webhooks:update',
  'usage:read',
  'billing:read',
  'billing:manage',
  'ownership:transfer',
] as const;

export type ApplicationPermission = (typeof APPLICATION_PERMISSIONS)[number];

export const APPLICATION_ROLES = [
  'owner',
  'admin',
  'developer',
  'viewer',
  'billing',
] as const;

export type ApplicationRole = (typeof APPLICATION_ROLES)[number];

const OWNER_PERMISSIONS: readonly ApplicationPermission[] = [...APPLICATION_PERMISSIONS];

const ADMIN_PERMISSIONS: readonly ApplicationPermission[] = [
  'app:read',
  'app:update',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
  'webhooks:read',
  'webhooks:update',
  'usage:read',
  'billing:read',
];

const DEVELOPER_PERMISSIONS: readonly ApplicationPermission[] = [
  'app:read',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
  'webhooks:read',
  'webhooks:update',
  'usage:read',
];

const VIEWER_PERMISSIONS: readonly ApplicationPermission[] = [
  'app:read',
  'members:read',
  'usage:read',
];

const BILLING_PERMISSIONS: readonly ApplicationPermission[] = [
  'app:read',
  'billing:read',
  'billing:manage',
  'usage:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<ApplicationRole, readonly ApplicationPermission[]>> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  developer: DEVELOPER_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
  billing: BILLING_PERMISSIONS,
};

/**
 * Resolve the concrete permission list for a role. Returns a fresh array so the
 * caller can persist it without aliasing the shared constant.
 */
export function permissionsForRole(role: ApplicationRole): ApplicationPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/**
 * Type guard for an arbitrary string being a valid application role.
 */
export function isApplicationRole(value: string): value is ApplicationRole {
  return (APPLICATION_ROLES as readonly string[]).includes(value);
}

/**
 * Map a Workspace membership role to the Application permissions it grants over
 * applications owned by that workspace.
 *
 * A workspace member gets implicit app access (no per-app ApplicationMember row
 * required) according to their workspace role:
 *  - owner / admin → full application permissions (manage everything);
 *  - member        → read + update the application;
 *  - viewer        → read-only.
 *
 * These are UNIONed with any explicit ApplicationMember permissions at the
 * route's RBAC site so the caller always receives the broader of the two.
 */
export function appPermissionsForWorkspaceRole(
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer'
): ApplicationPermission[] {
  switch (workspaceRole) {
    case 'owner':
    case 'admin':
      return [...APPLICATION_PERMISSIONS];
    case 'member':
      return ['app:read', 'app:update'];
    case 'viewer':
      return ['app:read'];
  }
}
