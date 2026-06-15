import * as React from 'react';
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@oxyhq/auth';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceType,
  WorkspaceStatus,
  WorkspaceMemberStatus,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from '@oxyhq/core';

// ===========================================================================
// Types — re-exported from @oxyhq/core so the Console shares the single
// source of truth (the `workspaces` mixin) rather than maintaining a
// parallel copy that can drift from the API contract.
// ===========================================================================

export type {
  Workspace,
  WorkspaceMember,
  WorkspaceRole,
  WorkspaceType,
  WorkspaceStatus,
  WorkspaceMemberStatus,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
};

/**
 * Permission strings derived from the member's role server-side.
 * The Console gates UI affordances on these values directly — it never
 * re-derives them from the role, so the role map stays single-sourced in the API.
 */
export type WorkspacePermission =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'members:read'
  | 'members:invite'
  | 'members:update'
  | 'members:remove'
  | 'ownership:transfer';

/** Roles assignable via invite/update — everything except `owner`. */
export type AssignableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>;

interface WorkspaceContextValue {
  // State
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  isLoading: boolean;

  // Workspace CRUD
  setCurrentWorkspace: (workspace: Workspace) => void;
  createWorkspace: (data: CreateWorkspaceInput) => Promise<Workspace>;
  updateWorkspace: (id: string, data: UpdateWorkspaceInput) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;

  // Permissions — derived from the workspace's embedded `callerMembership`.
  canEditWorkspace: (workspace: Workspace) => boolean;
  canManageMembers: (workspace: Workspace) => boolean;
  canDeleteWorkspace: (workspace: Workspace) => boolean;
  getUserRole: (workspace: Workspace) => WorkspaceRole | null;
}

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

const CURRENT_WORKSPACE_KEY = 'oxy-current-workspace-id';

const workspaceQueryKeys = {
  all: ['workspaces'] as const,
  members: (workspaceId: string) => ['workspace-members', workspaceId] as const,
};

function readStoredWorkspaceId(): string | null {
  try {
    return localStorage.getItem(CURRENT_WORKSPACE_KEY);
  } catch {
    // localStorage can throw in privacy modes / SSR — treat as no selection.
    return null;
  }
}

function persistWorkspaceId(id: string): void {
  try {
    localStorage.setItem(CURRENT_WORKSPACE_KEY, id);
  } catch (error) {
    // Persisting the selection is best-effort; surface for diagnostics only.
    if (import.meta.env.DEV) {
      console.warn('Failed to persist current workspace id', error);
    }
  }
}

/** Pick the default workspace: the personal one, else the first available. */
function pickDefaultWorkspace(workspaces: Workspace[]): Workspace | null {
  if (workspaces.length === 0) {
    return null;
  }
  return workspaces.find((w) => w.type === 'personal') ?? workspaces[0];
}

/** A workspace permission check that reads the embedded `callerMembership`. */
function hasPermission(workspace: Workspace, permissions: WorkspacePermission[]): boolean {
  const granted = workspace.callerMembership?.permissions;
  if (!granted) {
    return false;
  }
  return permissions.some((p) => granted.includes(p));
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { oxyServices, isAuthenticated, isReady } = useAuth();
  const queryClient = useQueryClient();

  const workspacesQuery = useQuery({
    queryKey: workspaceQueryKeys.all,
    queryFn: () => oxyServices.getWorkspaces(),
    enabled: isReady && isAuthenticated,
    staleTime: 1000 * 60 * 5,
    retry: 2,
  });

  const workspaces = React.useMemo(() => workspacesQuery.data ?? [], [workspacesQuery.data]);

  // Selected workspace id, seeded from localStorage. Updates are user-driven
  // (switcher) so a single setter + a small persistence effect is enough.
  const [selectedId, setSelectedId] = React.useState<string | null>(() => readStoredWorkspaceId());

  // Resolve the current workspace from the selection, falling back to the
  // default (personal-first) when the selection is missing or invalid.
  const currentWorkspace = React.useMemo<Workspace | null>(() => {
    if (workspaces.length === 0) {
      return null;
    }
    const selected = selectedId ? workspaces.find((w) => w._id === selectedId) : undefined;
    return selected ?? pickDefaultWorkspace(workspaces);
  }, [workspaces, selectedId]);

  // Keep the persisted selection aligned with the resolved current workspace.
  // This reconciles a stale/invalid stored id to the actual default once the
  // list loads. Persistence is the only side-effect, so a small effect is fine.
  React.useEffect(() => {
    if (currentWorkspace && currentWorkspace._id !== selectedId) {
      setSelectedId(currentWorkspace._id);
      persistWorkspaceId(currentWorkspace._id);
    }
  }, [currentWorkspace, selectedId]);

  const setCurrentWorkspace = React.useCallback((workspace: Workspace) => {
    setSelectedId(workspace._id);
    persistWorkspaceId(workspace._id);
  }, []);

  const createWorkspaceMutation = useMutation({
    mutationFn: (data: CreateWorkspaceInput): Promise<Workspace> =>
      oxyServices.createWorkspace(data),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all });
      setCurrentWorkspace(created);
    },
  });

  const updateWorkspaceMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateWorkspaceInput }): Promise<Workspace> =>
      oxyServices.updateWorkspace(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all });
    },
  });

  const deleteWorkspaceMutation = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await oxyServices.deleteWorkspace(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.all });
    },
  });

  const createWorkspace = React.useCallback(
    (data: CreateWorkspaceInput): Promise<Workspace> => createWorkspaceMutation.mutateAsync(data),
    [createWorkspaceMutation]
  );

  const updateWorkspace = React.useCallback(
    (id: string, data: UpdateWorkspaceInput): Promise<Workspace> =>
      updateWorkspaceMutation.mutateAsync({ id, data }),
    [updateWorkspaceMutation]
  );

  const deleteWorkspace = React.useCallback(
    (id: string): Promise<void> => deleteWorkspaceMutation.mutateAsync(id),
    [deleteWorkspaceMutation]
  );

  const getUserRole = React.useCallback(
    (workspace: Workspace): WorkspaceRole | null => workspace.callerMembership?.role ?? null,
    []
  );

  const canEditWorkspace = React.useCallback(
    (workspace: Workspace): boolean => hasPermission(workspace, ['workspace:update']),
    []
  );

  const canManageMembers = React.useCallback(
    (workspace: Workspace): boolean =>
      hasPermission(workspace, ['members:invite', 'members:update', 'members:remove']),
    []
  );

  const canDeleteWorkspace = React.useCallback(
    (workspace: Workspace): boolean => hasPermission(workspace, ['workspace:delete']),
    []
  );

  const value = React.useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      currentWorkspace,
      isLoading: workspacesQuery.isLoading,
      setCurrentWorkspace,
      createWorkspace,
      updateWorkspace,
      deleteWorkspace,
      canEditWorkspace,
      canManageMembers,
      canDeleteWorkspace,
      getUserRole,
    }),
    [
      workspaces,
      currentWorkspace,
      workspacesQuery.isLoading,
      setCurrentWorkspace,
      createWorkspace,
      updateWorkspace,
      deleteWorkspace,
      canEditWorkspace,
      canManageMembers,
      canDeleteWorkspace,
      getUserRole,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = React.useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return context;
}

// ===========================================================================
// Members — queried per-workspace. There is NO separate "invite" entity:
// invitations are members with `status: 'invited'`. Pending invites are
// therefore `members.filter((m) => m.status === 'invited')`, and cancelling an
// invite is the same operation as removing a member.
// ===========================================================================

export function useWorkspaceMembers(
  workspaceId: string | undefined,
  enabled: boolean = true
): UseQueryResult<WorkspaceMember[]> {
  const { oxyServices, isAuthenticated, isReady } = useAuth();

  return useQuery({
    queryKey: workspaceQueryKeys.members(workspaceId ?? ''),
    queryFn: () => oxyServices.getWorkspaceMembers(workspaceId ?? ''),
    enabled: isReady && isAuthenticated && !!workspaceId && enabled,
    staleTime: 1000 * 60 * 2,
    retry: 1,
  });
}

export function useInviteWorkspaceMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      usernameOrEmail,
      role,
    }: {
      workspaceId: string;
      usernameOrEmail: string;
      role: AssignableWorkspaceRole;
    }): Promise<WorkspaceMember> =>
      oxyServices.inviteWorkspaceMember(workspaceId, { usernameOrEmail, role }),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(member.workspaceId) });
    },
  });
}

export function useUpdateWorkspaceMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      workspaceId,
      memberId,
      role,
    }: {
      workspaceId: string;
      memberId: string;
      role: AssignableWorkspaceRole;
    }): Promise<WorkspaceMember> =>
      oxyServices.updateWorkspaceMember(workspaceId, memberId, { role }),
    onSuccess: (member) => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(member.workspaceId) });
    },
  });
}

export function useRemoveWorkspaceMember() {
  const { oxyServices } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      workspaceId,
      memberId,
    }: {
      workspaceId: string;
      memberId: string;
    }): Promise<{ workspaceId: string; memberId: string }> => {
      await oxyServices.removeWorkspaceMember(workspaceId, memberId);
      return { workspaceId, memberId };
    },
    onSuccess: ({ workspaceId }) => {
      queryClient.invalidateQueries({ queryKey: workspaceQueryKeys.members(workspaceId) });
    },
  });
}
