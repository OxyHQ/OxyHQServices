/**
 * User Management Methods Mixin
 */
import type {
  User,
  Notification,
  NotificationPreferences,
  UserPreferences,
  SearchProfilesResponse,
  PaginationInfo,
  PrivacySettings,
} from '../models/interfaces';
import type { UserNameResponse, UserProfileUpdate } from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';
import { buildSearchParams, buildPaginationParams, type PaginationParams } from '../utils/apiUtils';
import { KeyManager } from '../crypto/keyManager';
import { SignatureService } from '../crypto/signatureService';
import { normalizeUserIdentity, normalizeUserIdentityOrNull } from '../utils/userIdentity';

/** Per-user outcome returned by `POST /users/follow/bulk`. */
export interface BulkFollowEntry {
  /** The user ID that was processed. */
  userId: string;
  /** Whether the follow was applied (or already in place) without error. */
  success: boolean;
  /** Whether the caller was already following this user before the request. */
  alreadyFollowing: boolean;
}

/** Response shape of `POST /users/follow/bulk`. */
export interface BulkFollowResult {
  /** Per-user outcomes, in request order. */
  results: BulkFollowEntry[];
  /** Number of users newly followed by this request. */
  followedCount: number;
}

/** Per-user outcome returned by `POST /users/unfollow/bulk`. */
export interface BulkUnfollowEntry {
  /** The user ID that was processed. */
  userId: string;
  /** Whether the unfollow was applied (or already absent) without error. */
  success: boolean;
  /** Whether the caller was following this user before the request. */
  wasFollowing: boolean;
}

/** Response shape of `POST /users/unfollow/bulk`. */
export interface BulkUnfollowResult {
  /** Per-user outcomes, in request order. */
  results: BulkUnfollowEntry[];
  /** Number of users newly unfollowed by this request. */
  unfollowedCount: number;
}

export function OxyServicesUserMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    /**
     * Get profile by username
     */
    async getProfileByUsername(username: string): Promise<User> {
      try {
        const user = await this.makeRequest<User>('GET', `/profiles/username/${username}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000, // 5 minutes cache for profiles
        });
        return normalizeUserIdentity(user);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Lightweight username lookup for login flows.
     * Returns minimal public info: exists, color, avatar, name.displayName.
     * Faster than getProfileByUsername — no stats, no formatting.
     */
    async lookupUsername(username: string): Promise<{
      exists: boolean;
      username: string;
      color: string | null;
      avatar: string | null;
      name: UserNameResponse;
    }> {
      return await this.makeRequest('GET', `/auth/lookup/${encodeURIComponent(username)}`, undefined, {
        cache: true,
        cacheTTL: 60 * 1000, // 1 minute cache
      });
    }

    /**
     * Search user profiles
     */
    async searchProfiles(query: string, pagination?: PaginationParams): Promise<SearchProfilesResponse> {
      try {
        const params = { query, ...pagination };
        const searchParams = buildSearchParams(params);
        const paramsObj = Object.fromEntries(searchParams.entries());

        const response = await this.makeRequest<SearchProfilesResponse>(
          'GET',
          '/profiles/search',
          paramsObj,
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000, // 2 minutes cache
          }
        );

        if (
          typeof response !== 'object' ||
          response === null ||
          !Array.isArray(response.data)
        ) {
          throw new Error('Unexpected search response format');
        }

        const paginationInfo: PaginationInfo = response.pagination ?? {
          total: response.data.length,
          limit: pagination?.limit ?? response.data.length,
          offset: pagination?.offset ?? 0,
          hasMore: response.data.length === (pagination?.limit ?? response.data.length) &&
            (pagination?.limit ?? response.data.length) > 0,
        };

        return {
          data: response.data,
          pagination: paginationInfo,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Resolve a fediverse handle to an Oxy user profile.
     * Performs WebFinger discovery and returns the user, or null if not found.
     * @param handle - Fediverse handle (e.g. "@user@mastodon.social" or "user@domain")
     */
    async resolveProfile(handle: string): Promise<User | null> {
      try {
        const result = await this.makeRequest<User | null>('GET', '/profiles/resolve', {
          handle,
        }, {
          cache: true,
          cacheTTL: 24 * 60 * 60 * 1000, // 24h cache — matches server-side staleness window
        });
        return normalizeUserIdentityOrNull(result);
      } catch {
        return null;
      }
    }

    /**
     * Resolve (find or create) a non-local user. All user creation for
     * external accounts (federated, agent, automated) goes through this
     * method — calling services never write user data directly.
     */
    async resolveExternalUser(data: {
      type: 'federated' | 'agent' | 'automated';
      username: string;
      actorUri?: string;
      domain?: string;
      displayName?: string;
      avatar?: string;
      bio?: string;
      ownerId?: string;
    }): Promise<User> {
      return normalizeUserIdentity(await this.makeRequest<User>('PUT', '/users/resolve', data));
    }

    /**
     * Get profile recommendations, optionally filtering out specific user types.
     *
     * Public discovery read — works WITHOUT authentication. The SDK attaches the
     * access token automatically when one is available (personalized via
     * mutual-connection overlap), and falls back to popular public profiles when
     * the caller is logged out. This deliberately does NOT use `withAuthRetry`,
     * which would throw an authentication timeout for logged-out callers before
     * the request is ever sent.
     */
    async getProfileRecommendations(options?: {
      excludeTypes?: Array<'federated' | 'agent' | 'automated'>;
    }): Promise<Array<{
      id: string;
      username: string;
      name: UserNameResponse;
      description?: string;
      isFederated?: boolean;
      isAgent?: boolean;
      isAutomated?: boolean;
      instance?: string;
      federation?: { actorUri?: string; domain?: string; actorId?: string };
      automation?: { ownerId?: string };
      _count?: { followers: number; following: number };
      [key: string]: unknown;
    }>> {
      try {
        const params = options?.excludeTypes?.length
          ? { excludeTypes: options.excludeTypes.join(',') }
          : undefined;
        return await this.makeRequest('GET', '/profiles/recommendations', params, { cache: true });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get profiles similar to a given user, based on co-follower overlap.
     */
    async getSimilarProfiles(userId: string, limit?: number): Promise<User[]> {
      const params: Record<string, string> = {};
      if (limit) params.limit = String(limit);
      const users = await this.makeRequest<User[]>('GET', `/profiles/${userId}/similar`, params, {
        cache: true,
        cacheTTL: 5 * 60 * 1000, // 5 min cache
      });
      return users.map((user) => normalizeUserIdentity(user));
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User> {
      try {
        const user = await this.makeRequest<User>('GET', `/users/${userId}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000, // 5 minutes cache
        });
        return normalizeUserIdentity(user);
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get current user
     */
    async getCurrentUser(): Promise<User> {
      return this.withAuthRetry(async () => {
        const user = await this.makeRequest<User>('GET', '/users/me', undefined, {
          cache: true,
          cacheTTL: 1 * 60 * 1000, // 1 minute cache for current user
        });
        return normalizeUserIdentity(user);
      }, 'getCurrentUser');
    }

    /**
     * Update user profile.
     *
     * Invalidates the SDK-side response cache for every endpoint that
     * returns the current user (`GET /users/me`, `GET /session/user/*`,
     * `GET /users/<id>`, `GET /profiles/username/*`) so the next read
     * doesn't return a stale snapshot. Without this, a follow-up
     * `getUserBySession` call inside the 2-minute cache window can return
     * the pre-update user — most visibly during onboarding, where it
     * causes the username step to flicker back as if nothing was saved.
     *
     * TanStack Query handles offline queuing automatically.
     */
    async updateProfile(updates: UserProfileUpdate): Promise<User> {
      try {
        const result = normalizeUserIdentity(
          await this.makeRequest<User>('PUT', '/users/me', updates, { cache: false }),
        );

        // Bust every cached representation of the current user. We use a
        // prefix sweep rather than an enumeration because the SDK never
        // tracks the set of active session IDs centrally.
        this.clearCacheByPrefix('GET:/session/user/');
        this.clearCacheByPrefix('GET:/users/me');
        this.clearCacheByPrefix('GET:/profiles/username/');
        if (result?.id) {
          this.clearCacheEntry(`GET:/users/${result.id}`);
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorRecord = error && typeof error === 'object'
          ? error as { status?: unknown; response?: { status?: unknown } }
          : null;
        const status = typeof errorRecord?.status === 'number'
          ? errorRecord.status
          : typeof errorRecord?.response?.status === 'number'
            ? errorRecord.response.status
            : undefined;

        // Check if it's an authentication error (401)
        const isAuthError = status === 401 ||
          errorMessage.includes('Authentication required') ||
          errorMessage.includes('Invalid or missing authorization header');

        // If authentication error and we don't have a token, this might be an offline session
        // The caller should handle syncing the session before retrying
        if (isAuthError && !this.hasValidToken()) {
          // Re-throw with a specific message so the caller knows to sync
          throw new Error('AUTH_REQUIRED_OFFLINE_SESSION: Session needs to be synced to get a token');
        }

        throw this.handleError(error);
      }
    }

    /**
     * Get privacy settings for a user
     * @param userId - The user ID (defaults to current user)
     */
    async getPrivacySettings(userId?: string): Promise<PrivacySettings> {
      try {
        const id = userId || (await this.getCurrentUser()).id;
        return await this.makeRequest<PrivacySettings>('GET', `/privacy/${id}/privacy`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update privacy settings
     * @param settings - Partial privacy settings object
     * @param userId - The user ID (defaults to current user)
     */
    async updatePrivacySettings(settings: Partial<PrivacySettings>, userId?: string): Promise<PrivacySettings> {
      try {
        const id = userId || (await this.getCurrentUser()).id;
        return await this.makeRequest<PrivacySettings>('PATCH', `/privacy/${id}/privacy`, settings, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Update the authenticated user's notification preferences.
     *
     * Thin wrapper over `updateProfile` that constrains the patch to known
     * notification channels — same persistence path, same cache invalidation,
     * but type-safe at the call site.
     */
    async updateNotificationPreferences(
      preferences: Partial<NotificationPreferences>
    ): Promise<User> {
      return this.updateProfile({ notificationPreferences: preferences });
    }

    /**
     * Update the authenticated user's general preferences (language, theme,
     * reduce-motion, timezone). Persisted on the User document via
     * `PUT /users/me` — same cache-invalidation behaviour as `updateProfile`.
     */
    async updateUserPreferences(
      preferences: Partial<UserPreferences>
    ): Promise<User> {
      return this.updateProfile({ userPreferences: preferences });
    }

    /**
     * Request account verification
     */
    async requestAccountVerification(reason: string, evidence?: string): Promise<{ message: string; requestId: string }> {
      try {
        return await this.makeRequest<{ message: string; requestId: string }>('POST', '/users/verify/request', {
          reason,
          evidence,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Download account data export
     */
    async downloadAccountData(format: 'json' | 'csv' = 'json'): Promise<Blob> {
      try {
        // Use httpService for blob responses (it handles blob responses automatically)
        const result = await this.getClient().request<Blob>({
          method: 'GET',
          url: `/users/me/data`,
          params: { format },
          cache: false,
        });
        
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete account permanently.
     *
     * Signs `delete:{publicKey}:{timestamp}` with the locally-stored identity
     * private key and submits the signature alongside the confirmation text
     * (must equal the user's username). The signature is the cryptographic
     * proof of ownership — only the device holding the private key can issue
     * a valid signature, so no password is required.
     *
     * @param confirmText - Must equal the user's username (verified server-side)
     * @throws If no identity is stored on this device, or signing fails
     */
    async deleteAccount(confirmText: string): Promise<{ message: string }> {
      try {
        const publicKey = await KeyManager.getPublicKey();
        if (!publicKey) {
          throw new Error('No identity found on this device. Account deletion requires the device that holds your identity key.');
        }

        const timestamp = Date.now();
        const message = `delete:${publicKey}:${timestamp}`;
        const signature = await SignatureService.sign(message);

        return await this.makeRequest<{ message: string }>('DELETE', '/users/me', {
          signature,
          timestamp,
          confirmText,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }


    /**
     * Follow a user.
     *
     * Invalidates the cached `GET /users/<id>/follow-status` response after
     * the write. `getFollowStatus` caches for ~1 minute (identity-scoped);
     * without busting that entry, a `FollowButton` that remounts within the
     * TTL window re-reads the STALE pre-write status and reverts the optimistic
     * UI (the "follow resets after navigating away and back" bug).
     * `clearCacheEntry` deletes every identity-scoped variant of the key.
     */
    async followUser(userId: string): Promise<{ success: boolean; message: string }> {
      try {
        const result = await this.makeRequest<{ success: boolean; message: string }>('POST', `/users/${userId}/follow`, undefined, { cache: false });
        this.clearCacheEntry(`GET:/users/${userId}/follow-status`);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Follow multiple users in a single request.
     *
     * POSTs `/users/follow/bulk` with `{ userIds }` (server caps the batch at
     * 200). Returns the per-user outcomes and the count of users newly
     * followed. An empty `userIds` array resolves immediately with an empty
     * result and performs no network call.
     */
    async followUsers(userIds: string[]): Promise<BulkFollowResult> {
      if (userIds.length === 0) {
        return { results: [], followedCount: 0 };
      }
      try {
        const result = await this.makeRequest<BulkFollowResult>('POST', '/users/follow/bulk', { userIds }, { cache: false });
        // Bust each affected user's cached follow-status (see `followUser`).
        for (const id of userIds) {
          this.clearCacheEntry(`GET:/users/${id}/follow-status`);
        }
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unfollow multiple users in a single request.
     *
     * POSTs `/users/unfollow/bulk` with `{ userIds }` (server caps the batch at
     * 200). Returns the per-user outcomes and the count of users newly
     * unfollowed. An empty `userIds` array resolves immediately with an empty
     * result and performs no network call.
     */
    async unfollowUsers(userIds: string[]): Promise<BulkUnfollowResult> {
      if (userIds.length === 0) {
        return { results: [], unfollowedCount: 0 };
      }
      try {
        const result = await this.makeRequest<BulkUnfollowResult>('POST', '/users/unfollow/bulk', { userIds }, { cache: false });
        // Bust each affected user's cached follow-status (see `followUser`).
        for (const id of userIds) {
          this.clearCacheEntry(`GET:/users/${id}/follow-status`);
        }
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unfollow a user
     */
    async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
      try {
        const result = await this.makeRequest<{ success: boolean; message: string }>('DELETE', `/users/${userId}/follow`, undefined, { cache: false });
        // Bust the cached follow-status so a remount reads fresh truth (see `followUser`).
        this.clearCacheEntry(`GET:/users/${userId}/follow-status`);
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get follow status
     */
    async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
      try {
        return await this.makeRequest('GET', `/users/${userId}/follow-status`, undefined, {
          cache: true,
          cacheTTL: 1 * 60 * 1000, // 1 minute cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user followers
     */
    async getUserFollowers(
      userId: string,
      pagination?: PaginationParams
    ): Promise<{ followers: User[]; total: number; hasMore: boolean }> {
      try {
        const params = buildPaginationParams(pagination || {});
        const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/users/${userId}/followers`, params, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
        });
        return {
          followers: response.data || [],
          total: response.pagination.total,
          hasMore: response.pagination.hasMore,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user following
     */
    async getUserFollowing(
      userId: string,
      pagination?: PaginationParams
    ): Promise<{ following: User[]; total: number; hasMore: boolean }> {
      try {
        const params = buildPaginationParams(pagination || {});
        const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/users/${userId}/following`, params, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache
        });
        return {
          following: response.data || [],
          total: response.pagination.total,
          hasMore: response.pagination.hasMore,
        };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get notifications
     */
    async getNotifications(): Promise<Notification[]> {
      return this.withAuthRetry(async () => {
        return await this.makeRequest<Notification[]>('GET', '/notifications', undefined, {
          cache: false, // Don't cache notifications - always get fresh data
        });
      }, 'getNotifications');
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(): Promise<number> {
      try {
        const res = await this.makeRequest<{ count: number }>('GET', '/notifications/unread-count', undefined, {
          cache: false, // Don't cache unread count - always get fresh data
        });
        return res.count;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Create notification
     */
    async createNotification(data: Partial<Notification>): Promise<Notification> {
      try {
        return await this.makeRequest<Notification>('POST', '/notifications', data, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Mark notification as read
     */
    async markNotificationAsRead(notificationId: string): Promise<void> {
      try {
        await this.makeRequest('PUT', `/notifications/${notificationId}/read`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Mark all notifications as read
     */
    async markAllNotificationsAsRead(): Promise<void> {
      try {
        await this.makeRequest('PUT', '/notifications/read-all', undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete notification
     */
    async deleteNotification(notificationId: string): Promise<void> {
      try {
        await this.makeRequest('DELETE', `/notifications/${notificationId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
