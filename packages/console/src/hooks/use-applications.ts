import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@oxyhq/auth';
import { useWorkspace } from '@/hooks/use-workspace';
import type {
  Application,
  ApplicationMember,
  ApplicationCredential,
  ApplicationRole,
  ApplicationType,
  ApplicationStatus,
  ApplicationMemberStatus,
  ApplicationCredentialType,
  ApplicationCredentialStatus,
  ApplicationEnvironment,
  CreateApplicationInput,
  UpdateApplicationInput,
  ApplicationCredentialWithSecret,
  ApplicationUsageStats,
} from '@oxyhq/core';

// ===========================================================================
// Types — re-exported from @oxyhq/core so the Console shares the single
// source of truth (the `applications` mixin) rather than maintaining a
// parallel copy that can drift from the API contract.
// ===========================================================================

export type {
  Application,
  ApplicationMember,
  ApplicationCredential,
  ApplicationRole,
  ApplicationType,
  ApplicationStatus,
  ApplicationMemberStatus,
  ApplicationCredentialType,
  ApplicationCredentialStatus,
  ApplicationEnvironment,
  CreateApplicationInput,
  UpdateApplicationInput,
};

/** Result of creating/rotating a credential — the secret is returned ONCE. */
export type CredentialWithSecret = ApplicationCredentialWithSecret;

/** Usage statistics for an application over a period. */
export type AppUsageStats = ApplicationUsageStats;

/**
 * Permission strings derived from the member's role server-side.
 * The Console gates UI affordances on these values directly — it never
 * re-derives them from the role, so the role map stays single-sourced in the API.
 */
export type ApplicationPermission =
  | 'app:read'
  | 'app:update'
  | 'app:delete'
  | 'members:read'
  | 'members:invite'
  | 'members:update'
  | 'members:remove'
  | 'credentials:read'
  | 'credentials:create'
  | 'credentials:rotate'
  | 'credentials:revoke'
  | 'webhooks:read'
  | 'webhooks:update'
  | 'usage:read'
  | 'billing:read'
  | 'billing:manage'
  | 'ownership:transfer';

export interface InviteMemberInput {
  /**
   * The username or email of the user to invite. Resolved to a user server-side;
   * an unknown value yields a 404 "User not found".
   */
  usernameOrEmail: string;
  /** Owner cannot be invited — ownership is transferred, never granted. */
  role: Exclude<ApplicationRole, 'owner'>;
}

export interface UpdateMemberInput {
  role: ApplicationRole;
}

export interface CreateCredentialInput {
  name: string;
  type: ApplicationCredentialType;
  environment: ApplicationEnvironment;
  scopes?: string[];
}

// ===========================================================================
// Query keys
// ===========================================================================

/**
 * Prefix matching every workspace-scoped applications list. Used to patch all
 * cached lists (across workspaces) on update/delete via a partial key match.
 */
const APPLICATIONS_LIST_PREFIX = ['applications'] as const;

const queryKeys = {
  applications: (workspaceId: string | undefined) => ['applications', workspaceId ?? null] as const,
  application: (appId: string) => ['application', appId] as const,
  members: (appId: string) => ['application-members', appId] as const,
  credentials: (appId: string) => ['application-credentials', appId] as const,
  usage: (appId: string, period: string) => ['application-usage', appId, period] as const,
};

// ===========================================================================
// Applications
// ===========================================================================

export function useApplications() {
  const { oxyServices, isAuthenticated, isReady } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?._id;

  return useQuery({
    queryKey: queryKeys.applications(workspaceId),
    queryFn: () => oxyServices.getApplications(workspaceId),
    staleTime: 1000 * 60 * 5,
    retry: 2,
    enabled: isReady && isAuthenticated && !!workspaceId,
  });
}

export function useApplication(appId: string) {
  const { oxyServices, isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.application(appId),
    queryFn: () => oxyServices.getApplication(appId),
    enabled: isReady && isAuthenticated && !!appId,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useCreateApplication() {
  const { oxyServices } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const workspaceId = currentWorkspace?._id;

  return useMutation({
    mutationFn: (data: CreateApplicationInput): Promise<Application> =>
      // New apps land in the current workspace. An explicit `workspaceId` on
      // the input still wins; otherwise scope to the active workspace.
      oxyServices.createApplication(
        workspaceId ? { workspaceId, ...data } : data
      ),
    onSuccess: (newApp) => {
      queryClient.setQueryData<Application[]>(queryKeys.applications(workspaceId), (old) =>
        old ? [newApp, ...old] : [newApp]
      );
      queryClient.setQueryData(queryKeys.application(newApp._id), newApp);
    },
  });
}

export function useUpdateApplication() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      data,
    }: {
      appId: string;
      data: UpdateApplicationInput;
    }): Promise<Application> => oxyServices.updateApplication(appId, data),
    onSuccess: (updatedApp) => {
      // Patch the app in every cached workspace-scoped list (prefix match).
      queryClient.setQueriesData<Application[]>(
        { queryKey: APPLICATIONS_LIST_PREFIX },
        (old) =>
          old ? old.map((app) => (app._id === updatedApp._id ? updatedApp : app)) : old
      );
      queryClient.setQueryData(queryKeys.application(updatedApp._id), updatedApp);
    },
  });
}

export function useDeleteApplication() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appId: string): Promise<string> => {
      await oxyServices.deleteApplication(appId);
      return appId;
    },
    onSuccess: (appId) => {
      // Drop the app from every cached workspace-scoped list (prefix match).
      queryClient.setQueriesData<Application[]>(
        { queryKey: APPLICATIONS_LIST_PREFIX },
        (old) => (old ? old.filter((app) => app._id !== appId) : old)
      );
      queryClient.removeQueries({ queryKey: queryKeys.application(appId) });
      queryClient.removeQueries({ queryKey: queryKeys.members(appId) });
      queryClient.removeQueries({ queryKey: queryKeys.credentials(appId) });
    },
  });
}

// ===========================================================================
// Members
// ===========================================================================

export function useApplicationMembers(appId: string, enabled: boolean = true) {
  const { oxyServices, isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.members(appId),
    queryFn: () => oxyServices.getApplicationMembers(appId),
    enabled: isReady && isAuthenticated && !!appId && enabled,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useInviteMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      data,
    }: {
      appId: string;
      data: InviteMemberInput;
    }): Promise<ApplicationMember> =>
      oxyServices.inviteApplicationMember(appId, {
        usernameOrEmail: data.usernameOrEmail,
        role: data.role,
      }),
    onSuccess: (member) => {
      queryClient.setQueryData<ApplicationMember[]>(queryKeys.members(member.applicationId), (old) =>
        old ? [...old, member] : [member]
      );
    },
  });
}

export function useUpdateMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      memberId,
      data,
    }: {
      appId: string;
      memberId: string;
      data: UpdateMemberInput;
    }): Promise<ApplicationMember> => oxyServices.updateApplicationMember(appId, memberId, data),
    onSuccess: (member) => {
      queryClient.setQueryData<ApplicationMember[]>(queryKeys.members(member.applicationId), (old) =>
        old ? old.map((m) => (m._id === member._id ? member : m)) : [member]
      );
    },
  });
}

export function useRemoveMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      memberId,
    }: {
      appId: string;
      memberId: string;
    }): Promise<{ appId: string; memberId: string }> => {
      await oxyServices.removeApplicationMember(appId, memberId);
      return { appId, memberId };
    },
    onSuccess: ({ appId, memberId }) => {
      queryClient.setQueryData<ApplicationMember[]>(queryKeys.members(appId), (old) =>
        old ? old.filter((m) => m._id !== memberId) : []
      );
    },
  });
}

export function useTransferOwnership() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      userId,
    }: {
      appId: string;
      userId: string;
    }): Promise<{ success: boolean }> =>
      oxyServices.transferApplicationOwnership(appId, { userId }),
    onSuccess: (_data, { appId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(appId) });
    },
  });
}

// ===========================================================================
// Credentials
// ===========================================================================

export function useApplicationCredentials(appId: string, enabled: boolean = true) {
  const { oxyServices, isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.credentials(appId),
    queryFn: () => oxyServices.getApplicationCredentials(appId),
    enabled: isReady && isAuthenticated && !!appId && enabled,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useCreateCredential() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      data,
    }: {
      appId: string;
      data: CreateCredentialInput;
    }): Promise<CredentialWithSecret> =>
      oxyServices.createApplicationCredential(appId, {
        name: data.name,
        type: data.type,
        environment: data.environment,
        scopes: data.scopes,
      }),
    onSuccess: ({ credential }) => {
      queryClient.setQueryData<ApplicationCredential[]>(
        queryKeys.credentials(credential.applicationId),
        (old) => (old ? [credential, ...old] : [credential])
      );
    },
  });
}

export function useRotateCredential() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      appId,
      credentialId,
    }: {
      appId: string;
      credentialId: string;
    }): Promise<CredentialWithSecret> =>
      oxyServices.rotateApplicationCredential(appId, credentialId),
    onSuccess: ({ credential }) => {
      queryClient.setQueryData<ApplicationCredential[]>(
        queryKeys.credentials(credential.applicationId),
        (old) => (old ? old.map((c) => (c._id === credential._id ? credential : c)) : [credential])
      );
    },
  });
}

export function useRevokeCredential() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      credentialId,
    }: {
      appId: string;
      credentialId: string;
    }): Promise<{ appId: string; credentialId: string }> => {
      await oxyServices.revokeApplicationCredential(appId, credentialId);
      return { appId, credentialId };
    },
    onSuccess: ({ appId, credentialId }) => {
      queryClient.setQueryData<ApplicationCredential[]>(queryKeys.credentials(appId), (old) =>
        old
          ? old.map((c) =>
              c._id === credentialId ? { ...c, status: 'revoked' as const } : c
            )
          : []
      );
    },
  });
}

// ===========================================================================
// Usage
// ===========================================================================

export function useApplicationUsage(appId: string, period: string = '7d', enabled: boolean = true) {
  const { oxyServices, isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.usage(appId, period),
    queryFn: () => oxyServices.getApplicationUsage(appId, period as '24h' | '7d' | '30d' | '90d'),
    enabled: isReady && isAuthenticated && !!appId && enabled,
    staleTime: 1000 * 60,
    retry: 1,
  });
}

// ===========================================================================
// Caller permissions — derived from the current user's own membership.
// The server is the single source of truth for the role→permission map; the
// Console reads `member.permissions` directly to gate UI affordances.
// ===========================================================================

export interface CallerAccess {
  /** The current user's membership for this application, if any. */
  membership: ApplicationMember | undefined;
  /** The current user's role for this application, if a member. */
  role: ApplicationRole | undefined;
  /** Returns true if the caller holds the given permission. */
  can: (permission: ApplicationPermission) => boolean;
  /** True once the current user can be resolved against the member list. */
  isResolved: boolean;
}

function buildCallerAccess(
  membership: ApplicationMember | undefined,
  isResolved: boolean
): CallerAccess {
  const permissions = new Set<string>(membership?.permissions ?? []);
  return {
    membership,
    role: membership?.role,
    can: (permission) => permissions.has(permission),
    isResolved,
  };
}

/**
 * Resolves the current user's access within an application from a members list.
 * `currentUserId` is the authenticated user's id (`user.id` from `useAuth`).
 */
export function resolveCallerAccess(
  members: ApplicationMember[] | undefined,
  currentUserId: string | undefined
): CallerAccess {
  const membership =
    members && currentUserId ? members.find((m) => m.userId === currentUserId) : undefined;
  return buildCallerAccess(membership, Boolean(members && currentUserId));
}

/**
 * Resolves the caller's access for a single application. Prefers the embedded
 * `callerMembership` (works for any role); falls back to matching the caller's
 * id within a members list (requires `members:read`).
 */
export function useCallerAccess(
  application: Application | undefined,
  members: ApplicationMember[] | undefined
): CallerAccess {
  const { user } = useAuth();
  const currentUserId = user?.id;

  if (application?.callerMembership) {
    return buildCallerAccess(application.callerMembership, true);
  }
  return resolveCallerAccess(members, currentUserId);
}
