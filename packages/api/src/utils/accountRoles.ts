/**
 * Unified Account membership roles → permission map.
 *
 * The unified Account system collapses the three legacy role vocabularies
 * (`workspaceRoles`, `applicationRoles`, and `ManagedAccount.managers[].role`)
 * into ONE set of roles + capabilities keyed off an {@link AccountMember} row.
 *
 * Each AccountMember has a `role`; the concrete `permissions` array stored on
 * the member document is derived from this map at write time via
 * `permissionsForAccountRole`. Routes gate actions on individual permission
 * strings (see `requireAccountPermission`) rather than on the role directly, so
 * the role map is the single source of truth for what each role may do.
 *
 * `account:act_as` (the right to switch INTO the account via
 * `POST /accounts/:id/switch`, minting a real session AS it) is deliberately
 * granted ONLY to owner/admin/editor — billing/developer/viewer may manage
 * facets of the account but never post/act as it.
 *
 * Legacy role mapping (used by the migration scripts):
 *  - ManagedAccount owner/admin/editor → owner/admin/editor (unchanged)
 *  - Workspace member → editor, Workspace viewer → viewer
 *  - Application owner → admin (on the owning account), developer/billing/viewer
 *    → developer/billing/viewer (unchanged)
 */

/**
 * Application-level permissions. An application's access is DERIVED from the
 * caller's effective {@link AccountRole} over the app's owning account (there is
 * no separate per-app member table) via {@link appPermissionsForAccountRole}.
 * Routes in `applications.ts` gate on these strings.
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
  'updates:manage',
] as const;

export type ApplicationPermission = (typeof APPLICATION_PERMISSIONS)[number];

export const ACCOUNT_PERMISSIONS = [
  'account:read',
  'account:update',
  'account:delete',
  'account:act_as',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'children:read',
  'children:create',
  'children:update',
  'children:delete',
  'apps:read',
  'apps:create',
  'apps:update',
  'apps:delete',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
  'billing:read',
  'billing:manage',
  'ownership:transfer',
] as const;

export type AccountPermission = (typeof ACCOUNT_PERMISSIONS)[number];

export const ACCOUNT_ROLES = [
  'owner',
  'admin',
  'editor',
  'developer',
  'billing',
  'viewer',
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];

const OWNER_PERMISSIONS: readonly AccountPermission[] = [...ACCOUNT_PERMISSIONS];

const ADMIN_PERMISSIONS: readonly AccountPermission[] = [
  'account:read',
  'account:update',
  'account:act_as',
  'members:read',
  'members:invite',
  'members:update',
  'members:remove',
  'children:read',
  'children:create',
  'children:update',
  'children:delete',
  'apps:read',
  'apps:create',
  'apps:update',
  'apps:delete',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
  'billing:read',
];

const EDITOR_PERMISSIONS: readonly AccountPermission[] = [
  'account:read',
  'account:act_as',
  'members:read',
  'children:read',
  'apps:read',
  'apps:create',
  'apps:update',
  'credentials:read',
  'billing:read',
];

const DEVELOPER_PERMISSIONS: readonly AccountPermission[] = [
  'account:read',
  'children:read',
  'apps:read',
  'credentials:read',
  'credentials:create',
  'credentials:rotate',
  'credentials:revoke',
];

const BILLING_PERMISSIONS: readonly AccountPermission[] = [
  'account:read',
  'apps:read',
  'billing:read',
  'billing:manage',
];

const VIEWER_PERMISSIONS: readonly AccountPermission[] = [
  'account:read',
  'members:read',
  'children:read',
  'apps:read',
];

export const ROLE_PERMISSIONS: Readonly<Record<AccountRole, readonly AccountPermission[]>> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  editor: EDITOR_PERMISSIONS,
  developer: DEVELOPER_PERMISSIONS,
  billing: BILLING_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/** Roles whose holders may switch INTO the account (mint a session AS it). */
export const ACTING_AS_ROLES: readonly AccountRole[] = ['owner', 'admin', 'editor'];

/**
 * Resolve the concrete permission list for a role. Returns a fresh array so the
 * caller can persist it without aliasing the shared constant.
 */
export function permissionsForAccountRole(role: AccountRole): AccountPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Type guard for an arbitrary string being a valid account role. */
export function isAccountRole(value: string): value is AccountRole {
  return (ACCOUNT_ROLES as readonly string[]).includes(value);
}

/** Whether a role carries the `account:act_as` capability. */
export function roleCanActAs(role: AccountRole): boolean {
  return ROLE_PERMISSIONS[role].includes('account:act_as');
}

/**
 * Per-role application-permission grants, mirroring the legacy
 * `applicationRoles` map so that — once `Application.ownerAccountId` lands and
 * `ApplicationMember` is retired — an application can derive a caller's access
 * directly from their effective {@link AccountMember} role over the owning
 * account, with NO per-app membership row required.
 *
 * UNIONed with any explicit per-app grant at the application route's RBAC site
 * during the additive phase, exactly like `appPermissionsForWorkspaceRole`.
 */
const APP_PERMISSIONS_BY_ROLE: Readonly<Record<AccountRole, readonly ApplicationPermission[]>> = {
  owner: [...APPLICATION_PERMISSIONS],
  admin: [
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
    'updates:manage',
  ],
  editor: [
    'app:read',
    'app:update',
    'members:read',
    'credentials:read',
    'webhooks:read',
    'webhooks:update',
    'usage:read',
  ],
  developer: [
    'app:read',
    'credentials:read',
    'credentials:create',
    'credentials:rotate',
    'credentials:revoke',
    'webhooks:read',
    'webhooks:update',
    'usage:read',
    'updates:manage',
  ],
  billing: ['app:read', 'billing:read', 'billing:manage', 'usage:read'],
  viewer: ['app:read', 'members:read', 'usage:read'],
};

/**
 * Map an Account membership role to the Application permissions it grants over
 * applications owned by that account. Returns a fresh array.
 */
export function appPermissionsForAccountRole(role: AccountRole): ApplicationPermission[] {
  return [...APP_PERMISSIONS_BY_ROLE[role]];
}
