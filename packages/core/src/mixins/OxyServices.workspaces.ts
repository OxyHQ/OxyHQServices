/**
 * Workspaces Methods Mixin
 *
 * Provides methods for managing Oxy workspaces and their members via the
 * `/workspaces` API. A workspace is a multi-user container that owns
 * applications and other resources: membership (with a role) grants
 * permissions. A `personal` workspace is created implicitly for every user;
 * `team` workspaces are created explicitly and can invite additional members.
 *
 * Reference workspaces by their Mongo `_id` and members by their member `_id`.
 * Never by name or slug.
 */
import type { OxyServicesBase } from '../OxyServices.base';
import { CACHE_TIMES } from './mixinHelpers';

/** Role a member holds within a workspace. */
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Workspace classification. A `personal` workspace is implicit per user. */
export type WorkspaceType = 'personal' | 'team';

/** Lifecycle status of a workspace. */
export type WorkspaceStatus = 'active' | 'deleted';

/** Membership lifecycle status. */
export type WorkspaceMemberStatus = 'active' | 'invited' | 'removed';

/**
 * Client-facing WorkspaceMember shape. `permissions` is derived from `role`
 * on the server at write time.
 */
export interface WorkspaceMember {
  _id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  permissions: string[];
  invitedByUserId?: string | null;
  joinedAt?: string | null;
  status: WorkspaceMemberStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client-facing Workspace shape returned by the `/workspaces` API. Mirrors the
 * server `Workspace` model with `_id` as a string and dates serialized to ISO
 * strings.
 */
export interface Workspace {
  _id: string;
  name: string;
  slug: string;
  type: WorkspaceType;
  description?: string | null;
  icon?: string | null;
  ownerId: string;
  status: WorkspaceStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * The calling user's own membership in this workspace, embedded by the API
   * on list (`GET /workspaces`) and detail (`GET /workspaces/:id`) responses.
   * Use `callerMembership.permissions` to gate UI affordances.
   */
  callerMembership?: WorkspaceMember | null;
}

/** Input accepted by `createWorkspace`. */
export interface CreateWorkspaceInput {
  name: string;
  description?: string;
  icon?: string;
}

/** Input accepted by `updateWorkspace`. */
export interface UpdateWorkspaceInput {
  name?: string;
  description?: string | null;
  icon?: string | null;
}

/** Input accepted by `inviteWorkspaceMember`. The owner role cannot be invited. */
export interface InviteWorkspaceMemberInput {
  /**
   * The username or email of the user to invite. Resolved to a user server-side;
   * an unknown value yields a 404 "User not found".
   */
  usernameOrEmail: string;
  role: Exclude<WorkspaceRole, 'owner'>;
}

/** Input accepted by `updateWorkspaceMember`. The owner role cannot be assigned. */
export interface UpdateWorkspaceMemberInput {
  role: Exclude<WorkspaceRole, 'owner'>;
}

/** Input accepted by `transferWorkspaceOwnership`. */
export interface TransferWorkspaceOwnershipInput {
  userId: string;
}

/** Result of a delete/remove/transfer operation. */
export interface WorkspaceSuccessResult {
  success: boolean;
}

export function OxyServicesWorkspacesMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * List workspaces the current user is an active member of.
     */
    async getWorkspaces(): Promise<Workspace[]> {
      try {
        const res = await this.makeRequest<{ workspaces?: Workspace[] }>(
          'GET',
          '/workspaces',
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
        return res.workspaces ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Create a new team workspace. The caller becomes its `owner`.
     * @param data - Workspace configuration.
     */
    async createWorkspace(data: CreateWorkspaceInput): Promise<Workspace> {
      try {
        const res = await this.makeRequest<{ workspace: Workspace }>(
          'POST',
          '/workspaces',
          data,
          { cache: false },
        );
        return res.workspace;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Fetch a single workspace by id.
     * @param workspaceId - The workspace's Mongo `_id`.
     */
    async getWorkspace(workspaceId: string): Promise<Workspace> {
      try {
        const res = await this.makeRequest<{ workspace: Workspace }>(
          'GET',
          `/workspaces/${encodeURIComponent(workspaceId)}`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.LONG },
        );
        return res.workspace;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update a workspace's mutable fields.
     * @param workspaceId - The workspace's Mongo `_id`.
     * @param data - Subset of updatable fields.
     */
    async updateWorkspace(
      workspaceId: string,
      data: UpdateWorkspaceInput,
    ): Promise<Workspace> {
      try {
        const res = await this.makeRequest<{ workspace: Workspace }>(
          'PATCH',
          `/workspaces/${encodeURIComponent(workspaceId)}`,
          data,
          { cache: false },
        );
        return res.workspace;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Soft-delete a workspace (owner only).
     * @param workspaceId - The workspace's Mongo `_id`.
     */
    async deleteWorkspace(workspaceId: string): Promise<WorkspaceSuccessResult> {
      try {
        return await this.makeRequest<WorkspaceSuccessResult>(
          'DELETE',
          `/workspaces/${encodeURIComponent(workspaceId)}`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * List members of a workspace.
     * @param workspaceId - The workspace's Mongo `_id`.
     */
    async getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[]> {
      try {
        const res = await this.makeRequest<{ members?: WorkspaceMember[] }>(
          'GET',
          `/workspaces/${encodeURIComponent(workspaceId)}/members`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.MEDIUM },
        );
        return res.members ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Add a member to a workspace.
     * @param workspaceId - The workspace's Mongo `_id`.
     * @param data - Target user's username or email and role (never `owner`).
     *   The server resolves `usernameOrEmail` to a user; an unknown value yields
     *   a 404 "User not found".
     */
    async inviteWorkspaceMember(
      workspaceId: string,
      data: InviteWorkspaceMemberInput,
    ): Promise<WorkspaceMember> {
      try {
        const res = await this.makeRequest<{ member: WorkspaceMember }>(
          'POST',
          `/workspaces/${encodeURIComponent(workspaceId)}/members`,
          data,
          { cache: false },
        );
        return res.member;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Change a member's role.
     * @param workspaceId - The workspace's Mongo `_id`.
     * @param memberId - The member's Mongo `_id`.
     * @param data - New role (never `owner`).
     */
    async updateWorkspaceMember(
      workspaceId: string,
      memberId: string,
      data: UpdateWorkspaceMemberInput,
    ): Promise<WorkspaceMember> {
      try {
        const res = await this.makeRequest<{ member: WorkspaceMember }>(
          'PATCH',
          `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
          data,
          { cache: false },
        );
        return res.member;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Remove a member from a workspace.
     * @param workspaceId - The workspace's Mongo `_id`.
     * @param memberId - The member's Mongo `_id`.
     */
    async removeWorkspaceMember(
      workspaceId: string,
      memberId: string,
    ): Promise<WorkspaceSuccessResult> {
      try {
        return await this.makeRequest<WorkspaceSuccessResult>(
          'DELETE',
          `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(memberId)}`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Transfer ownership of a workspace to another member (owner only).
     * Demotes the current owner and promotes the target to `owner`.
     * @param workspaceId - The workspace's Mongo `_id`.
     * @param data - Target user id.
     */
    async transferWorkspaceOwnership(
      workspaceId: string,
      data: TransferWorkspaceOwnershipInput,
    ): Promise<WorkspaceSuccessResult> {
      try {
        return await this.makeRequest<WorkspaceSuccessResult>(
          'POST',
          `/workspaces/${encodeURIComponent(workspaceId)}/transfer-ownership`,
          data,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
