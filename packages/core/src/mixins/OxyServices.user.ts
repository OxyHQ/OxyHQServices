/**
 * User Management Methods Mixin
 */
import type { User, Notification, SearchProfilesResponse, PaginationInfo } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { buildSearchParams, buildPaginationParams, type PaginationParams } from '../utils/apiUtils';

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
        return await this.makeRequest<User>('GET', `/api/profiles/username/${username}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000, // 5 minutes cache for profiles
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Search user profiles
     */
    async searchProfiles(query: string, pagination?: PaginationParams): Promise<SearchProfilesResponse> {
      try {
        const params = { query, ...pagination };
        const searchParams = buildSearchParams(params);
        const paramsObj = Object.fromEntries(searchParams.entries());

        const response = await this.makeRequest<SearchProfilesResponse | User[]>(
          'GET',
          '/api/profiles/search',
          paramsObj,
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000, // 2 minutes cache
          }
        );

        // New API shape: { data: User[], pagination: {...} }
        const isSearchProfilesResponse = (payload: unknown): payload is SearchProfilesResponse =>
          typeof payload === 'object' &&
          payload !== null &&
          Array.isArray((payload as SearchProfilesResponse).data);

        if (isSearchProfilesResponse(response)) {
          const typedResponse = response;
          const paginationInfo: PaginationInfo = typedResponse.pagination ?? {
            total: typedResponse.data.length,
            limit: pagination?.limit ?? typedResponse.data.length,
            offset: pagination?.offset ?? 0,
            hasMore: typedResponse.data.length === (pagination?.limit ?? typedResponse.data.length) &&
              (pagination?.limit ?? typedResponse.data.length) > 0,
          };

          return {
            data: typedResponse.data,
            pagination: paginationInfo,
          };
        }

        // Legacy API shape: returns raw User[]
        if (Array.isArray(response)) {
          const fallbackLimit = pagination?.limit ?? response.length;
          const fallbackPagination: PaginationInfo = {
            total: response.length,
            limit: fallbackLimit,
            offset: pagination?.offset ?? 0,
            hasMore: fallbackLimit > 0 && response.length === fallbackLimit,
          };

          return { data: response, pagination: fallbackPagination };
        }

        // If response is unexpected, throw an error
        throw new Error('Unexpected search response format');
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get profile recommendations
     */
    async getProfileRecommendations(): Promise<Array<{
      id: string;
      username: string;
      name?: { first?: string; last?: string; full?: string };
      description?: string;
      _count?: { followers: number; following: number };
      [key: string]: any;
    }>> {
      return this.withAuthRetry(async () => {
        return await this.makeRequest('GET', '/api/profiles/recommendations', undefined, { cache: true });
      }, 'getProfileRecommendations');
    }

    /**
     * Get user by ID
     */
    async getUserById(userId: string): Promise<User> {
      try {
        return await this.makeRequest<User>('GET', `/api/users/${userId}`, undefined, {
          cache: true,
          cacheTTL: 5 * 60 * 1000, // 5 minutes cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get current user
     */
    async getCurrentUser(): Promise<User> {
      return this.withAuthRetry(async () => {
        return await this.makeRequest<User>('GET', '/api/users/me', undefined, {
          cache: true,
          cacheTTL: 1 * 60 * 1000, // 1 minute cache for current user
        });
      }, 'getCurrentUser');
    }

    /**
     * Update user profile
     * TanStack Query handles offline queuing automatically
     */
    async updateProfile(updates: Record<string, any>): Promise<User> {
      try {
        return await this.makeRequest<User>('PUT', '/api/users/me', updates, { cache: false });
      } catch (error) {
        const errorAny = error as any;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const status = errorAny?.status || errorAny?.response?.status;
        
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
    async getPrivacySettings(userId?: string): Promise<any> {
      try {
        const id = userId || (await this.getCurrentUser()).id;
        return await this.makeRequest<any>('GET', `/api/privacy/${id}/privacy`, undefined, {
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
    async updatePrivacySettings(settings: Record<string, any>, userId?: string): Promise<any> {
      try {
        const id = userId || (await this.getCurrentUser()).id;
        return await this.makeRequest<any>('PATCH', `/api/privacy/${id}/privacy`, settings, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Request account verification
     */
    async requestAccountVerification(reason: string, evidence?: string): Promise<{ message: string; requestId: string }> {
      try {
        return await this.makeRequest<{ message: string; requestId: string }>('POST', '/api/users/verify/request', {
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
          url: `/api/users/me/data`,
          params: { format },
          cache: false,
        });
        
        return result;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete account permanently
     * @param password - User password for confirmation
     * @param confirmText - Confirmation text (usually username)
     */
    async deleteAccount(password: string, confirmText: string): Promise<{ message: string }> {
      try {
        return await this.makeRequest<{ message: string }>('DELETE', '/api/users/me', {
          password,
          confirmText,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }


    /**
     * Follow a user
     */
    async followUser(userId: string): Promise<{ success: boolean; message: string }> {
      try {
        return await this.makeRequest('POST', `/api/users/${userId}/follow`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unfollow a user
     */
    async unfollowUser(userId: string): Promise<{ success: boolean; message: string }> {
      try {
        return await this.makeRequest('DELETE', `/api/users/${userId}/follow`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get follow status
     */
    async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
      try {
        return await this.makeRequest('GET', `/api/users/${userId}/follow-status`, undefined, {
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
        const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/api/users/${userId}/followers`, params, {
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
        const response = await this.makeRequest<{ data: User[]; pagination: { total: number; hasMore: boolean } }>('GET', `/api/users/${userId}/following`, params, {
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
        return await this.makeRequest<Notification[]>('GET', '/api/notifications', undefined, {
          cache: false, // Don't cache notifications - always get fresh data
        });
      }, 'getNotifications');
    }

    /**
     * Get unread notification count
     */
    async getUnreadCount(): Promise<number> {
      try {
        const res = await this.makeRequest<{ count: number }>('GET', '/api/notifications/unread-count', undefined, {
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
        return await this.makeRequest<Notification>('POST', '/api/notifications', data, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Mark notification as read
     */
    async markNotificationAsRead(notificationId: string): Promise<void> {
      try {
        await this.makeRequest('PUT', `/api/notifications/${notificationId}/read`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Mark all notifications as read
     */
    async markAllNotificationsAsRead(): Promise<void> {
      try {
        await this.makeRequest('PUT', '/api/notifications/read-all', undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Delete notification
     */
    async deleteNotification(notificationId: string): Promise<void> {
      try {
        await this.makeRequest('DELETE', `/api/notifications/${notificationId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

