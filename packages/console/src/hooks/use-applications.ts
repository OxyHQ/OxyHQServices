import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@oxyhq/auth';
import apiClient from '@/lib/api/client';

// ===========================================================================
// Types — mirror the issue #213 API contract.
// Mongo `_id` and dates are serialized as strings on the wire.
// ===========================================================================

export type ApplicationType = 'first_party' | 'third_party' | 'internal' | 'system';
export type ApplicationStatus = 'active' | 'suspended' | 'deleted' | 'pending_review';

export interface Application {
  _id: string;
  name: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  type: ApplicationType;
  status: ApplicationStatus;
  isOfficial: boolean;
  isInternal: boolean;
  capabilities: string[];
  redirectUris: string[];
  scopes: string[];
  webhookUrl?: string;
  devWebhookUrl?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * The authenticated caller's membership for this application, when the API
   * embeds it. Used to gate Console UI affordances on the caller's own role —
   * it lets a member (e.g. a `developer`) discover their own permissions
   * without `members:read` access to the full member list.
   */
  callerMembership?: ApplicationMember;
}

export type ApplicationRole = 'owner' | 'admin' | 'developer' | 'viewer' | 'billing';
export type ApplicationMemberStatus = 'active' | 'invited' | 'removed';

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

export interface ApplicationMember {
  _id: string;
  applicationId: string;
  userId: string;
  role: ApplicationRole;
  permissions: ApplicationPermission[];
  invitedByUserId?: string;
  joinedAt?: string;
  status: ApplicationMemberStatus;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationCredentialType = 'public' | 'confidential' | 'service';
export type ApplicationEnvironment = 'development' | 'staging' | 'production';
export type ApplicationCredentialStatus = 'active' | 'deprecated' | 'revoked';

export interface ApplicationCredential {
  _id: string;
  applicationId: string;
  name: string;
  publicKey: string;
  type: ApplicationCredentialType;
  environment: ApplicationEnvironment;
  scopes: string[];
  status: ApplicationCredentialStatus;
  lastUsedAt?: string;
  expiresAt?: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateApplicationInput {
  name: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  redirectUris?: string[];
  scopes?: string[];
}

export interface UpdateApplicationInput {
  name?: string;
  description?: string;
  websiteUrl?: string;
  icon?: string;
  redirectUris?: string[];
  scopes?: string[];
  webhookUrl?: string;
  devWebhookUrl?: string;
  status?: ApplicationStatus;
}

export interface InviteMemberInput {
  userId: string;
  role: ApplicationRole;
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

export interface CredentialWithSecret {
  credential: ApplicationCredential;
  secret: string;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCredits: number;
  avgResponseTime: number;
  successfulRequests: number;
  errorRequests: number;
}

export interface UsageByDay {
  _id: string;
  requests: number;
  tokens: number;
  credits: number;
}

export interface UsageByEndpoint {
  _id: string;
  requests: number;
  tokens: number;
}

export interface AppUsageStats {
  summary: UsageSummary;
  byDay: UsageByDay[];
  byEndpoint: UsageByEndpoint[];
}

// ===========================================================================
// Query keys
// ===========================================================================

const queryKeys = {
  applications: ['applications'] as const,
  application: (appId: string) => ['application', appId] as const,
  members: (appId: string) => ['application-members', appId] as const,
  credentials: (appId: string) => ['application-credentials', appId] as const,
  usage: (appId: string, period: string) => ['application-usage', appId, period] as const,
};

// ===========================================================================
// Applications
// ===========================================================================

async function fetchApplications(): Promise<Application[]> {
  const response = await apiClient.get<{ applications: Application[] }>('/applications');
  return response.data.applications;
}

export function useApplications() {
  const { isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.applications,
    queryFn: fetchApplications,
    staleTime: 1000 * 60 * 5,
    retry: 2,
    enabled: isReady && isAuthenticated,
  });
}

async function fetchApplication(appId: string): Promise<Application> {
  const response = await apiClient.get<{ application: Application }>(`/applications/${appId}`);
  return response.data.application;
}

export function useApplication(appId: string) {
  const { isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.application(appId),
    queryFn: () => fetchApplication(appId),
    enabled: isReady && isAuthenticated && !!appId,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useCreateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateApplicationInput): Promise<Application> => {
      const response = await apiClient.post<{ application: Application }>('/applications', data);
      return response.data.application;
    },
    onSuccess: (newApp) => {
      queryClient.setQueryData<Application[]>(queryKeys.applications, (old) =>
        old ? [newApp, ...old] : [newApp]
      );
      queryClient.setQueryData(queryKeys.application(newApp._id), newApp);
    },
  });
}

export function useUpdateApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      data,
    }: {
      appId: string;
      data: UpdateApplicationInput;
    }): Promise<Application> => {
      const response = await apiClient.patch<{ application: Application }>(
        `/applications/${appId}`,
        data
      );
      return response.data.application;
    },
    onSuccess: (updatedApp) => {
      queryClient.setQueryData<Application[]>(queryKeys.applications, (old) =>
        old ? old.map((app) => (app._id === updatedApp._id ? updatedApp : app)) : [updatedApp]
      );
      queryClient.setQueryData(queryKeys.application(updatedApp._id), updatedApp);
    },
  });
}

export function useDeleteApplication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (appId: string): Promise<string> => {
      await apiClient.delete(`/applications/${appId}`);
      return appId;
    },
    onSuccess: (appId) => {
      queryClient.setQueryData<Application[]>(queryKeys.applications, (old) =>
        old ? old.filter((app) => app._id !== appId) : []
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

async function fetchMembers(appId: string): Promise<ApplicationMember[]> {
  const response = await apiClient.get<{ members: ApplicationMember[] }>(
    `/applications/${appId}/members`
  );
  return response.data.members;
}

export function useApplicationMembers(appId: string, enabled: boolean = true) {
  const { isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.members(appId),
    queryFn: () => fetchMembers(appId),
    enabled: isReady && isAuthenticated && !!appId && enabled,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      data,
    }: {
      appId: string;
      data: InviteMemberInput;
    }): Promise<ApplicationMember> => {
      const response = await apiClient.post<{ member: ApplicationMember }>(
        `/applications/${appId}/members`,
        data
      );
      return response.data.member;
    },
    onSuccess: (member) => {
      queryClient.setQueryData<ApplicationMember[]>(queryKeys.members(member.applicationId), (old) =>
        old ? [...old, member] : [member]
      );
    },
  });
}

export function useUpdateMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      memberId,
      data,
    }: {
      appId: string;
      memberId: string;
      data: UpdateMemberInput;
    }): Promise<ApplicationMember> => {
      const response = await apiClient.patch<{ member: ApplicationMember }>(
        `/applications/${appId}/members/${memberId}`,
        data
      );
      return response.data.member;
    },
    onSuccess: (member) => {
      queryClient.setQueryData<ApplicationMember[]>(queryKeys.members(member.applicationId), (old) =>
        old ? old.map((m) => (m._id === member._id ? member : m)) : [member]
      );
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      memberId,
    }: {
      appId: string;
      memberId: string;
    }): Promise<{ appId: string; memberId: string }> => {
      await apiClient.delete(`/applications/${appId}/members/${memberId}`);
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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      userId,
    }: {
      appId: string;
      userId: string;
    }): Promise<{ success: boolean }> => {
      const response = await apiClient.post<{ success: boolean }>(
        `/applications/${appId}/transfer-ownership`,
        { userId }
      );
      return response.data;
    },
    onSuccess: (_data, { appId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.members(appId) });
    },
  });
}

// ===========================================================================
// Credentials
// ===========================================================================

async function fetchCredentials(appId: string): Promise<ApplicationCredential[]> {
  const response = await apiClient.get<{ credentials: ApplicationCredential[] }>(
    `/applications/${appId}/credentials`
  );
  return response.data.credentials;
}

export function useApplicationCredentials(appId: string, enabled: boolean = true) {
  const { isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.credentials(appId),
    queryFn: () => fetchCredentials(appId),
    enabled: isReady && isAuthenticated && !!appId && enabled,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useCreateCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      data,
    }: {
      appId: string;
      data: CreateCredentialInput;
    }): Promise<CredentialWithSecret> => {
      const response = await apiClient.post<CredentialWithSecret>(
        `/applications/${appId}/credentials`,
        data
      );
      return response.data;
    },
    onSuccess: ({ credential }) => {
      queryClient.setQueryData<ApplicationCredential[]>(
        queryKeys.credentials(credential.applicationId),
        (old) => (old ? [credential, ...old] : [credential])
      );
    },
  });
}

export function useRotateCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      credentialId,
    }: {
      appId: string;
      credentialId: string;
    }): Promise<CredentialWithSecret> => {
      const response = await apiClient.post<CredentialWithSecret>(
        `/applications/${appId}/credentials/${credentialId}/rotate`
      );
      return response.data;
    },
    onSuccess: ({ credential }) => {
      queryClient.setQueryData<ApplicationCredential[]>(
        queryKeys.credentials(credential.applicationId),
        (old) => (old ? old.map((c) => (c._id === credential._id ? credential : c)) : [credential])
      );
    },
  });
}

export function useRevokeCredential() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      appId,
      credentialId,
    }: {
      appId: string;
      credentialId: string;
    }): Promise<{ appId: string; credentialId: string }> => {
      await apiClient.delete(`/applications/${appId}/credentials/${credentialId}`);
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

async function fetchUsage(appId: string, period: string): Promise<AppUsageStats> {
  const response = await apiClient.get<AppUsageStats>(
    `/applications/${appId}/usage?period=${period}`
  );
  return response.data;
}

export function useApplicationUsage(appId: string, period: string = '7d', enabled: boolean = true) {
  const { isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.usage(appId, period),
    queryFn: () => fetchUsage(appId, period),
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
  const permissions = new Set(membership?.permissions ?? []);
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
