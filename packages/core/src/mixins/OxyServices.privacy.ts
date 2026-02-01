/**
 * Privacy Methods Mixin (Blocked & Restricted Users)
 */
import type { BlockedUser, RestrictedUser } from '../models/interfaces';
import type { OxyServicesBase } from '../OxyServices.base';
import { isDev } from '../shared/utils/debugUtils';

export function OxyServicesPrivacyMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    /**
     * Extract user ID from blocked/restricted user object
     */
    public extractUserId(userIdField: string | { _id: string; username?: string; avatar?: string }): string {
      return typeof userIdField === 'string' ? userIdField : userIdField._id;
    }

    /**
     * Check if a user is in a list (blocked or restricted)
     */
    public async isUserInList<T extends BlockedUser | RestrictedUser>(
      userId: string,
      getUserList: () => Promise<T[]>,
      getIdField: (item: T) => string | { _id: string; username?: string; avatar?: string }
    ): Promise<boolean> {
      try {
        if (!userId) {
          return false;
        }
        const users = await getUserList();
        return users.some(item => {
          const itemId = this.extractUserId(getIdField(item));
          return itemId === userId;
        });
      } catch (error) {
        // If there's an error, assume not in list to avoid breaking functionality
        if (isDev()) {
          console.warn('Error checking user list:', error);
        }
        return false;
      }
    }

    // ============================================================================
    // BLOCKED USERS METHODS
    // ============================================================================

    /**
     * Get list of blocked users
     * @returns Array of blocked users
     */
    async getBlockedUsers(): Promise<BlockedUser[]> {
      try {
        return await this.makeRequest<BlockedUser[]>('GET', '/api/privacy/blocked', undefined, {
          cache: true,
          cacheTTL: 1 * 60 * 1000, // 1 minute cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Block a user
     * @param userId - The user ID to block
     * @returns Success message
     */
    async blockUser(userId: string): Promise<{ message: string }> {
      try {
        if (!userId) {
          throw new Error('User ID is required');
        }
        return await this.makeRequest<{ message: string }>('POST', `/api/privacy/blocked/${userId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unblock a user
     * @param userId - The user ID to unblock
     * @returns Success message
     */
    async unblockUser(userId: string): Promise<{ message: string }> {
      try {
        if (!userId) {
          throw new Error('User ID is required');
        }
        return await this.makeRequest<{ message: string }>('DELETE', `/api/privacy/blocked/${userId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check if a user is blocked
     * @param userId - The user ID to check
     * @returns True if the user is blocked, false otherwise
     */
    async isUserBlocked(userId: string): Promise<boolean> {
      return this.isUserInList(
        userId,
        () => this.getBlockedUsers(),
        (block) => block.blockedId
      );
    }

    // ============================================================================
    // RESTRICTED USERS METHODS
    // ============================================================================

    /**
     * Get list of restricted users
     * @returns Array of restricted users
     */
    async getRestrictedUsers(): Promise<RestrictedUser[]> {
      try {
        return await this.makeRequest<RestrictedUser[]>('GET', '/api/privacy/restricted', undefined, {
          cache: true,
          cacheTTL: 1 * 60 * 1000, // 1 minute cache
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Restrict a user (limit their interactions without fully blocking)
     * @param userId - The user ID to restrict
     * @returns Success message
     */
    async restrictUser(userId: string): Promise<{ message: string }> {
      try {
        if (!userId) {
          throw new Error('User ID is required');
        }
        return await this.makeRequest<{ message: string }>('POST', `/api/privacy/restricted/${userId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Unrestrict a user
     * @param userId - The user ID to unrestrict
     * @returns Success message
     */
    async unrestrictUser(userId: string): Promise<{ message: string }> {
      try {
        if (!userId) {
          throw new Error('User ID is required');
        }
        return await this.makeRequest<{ message: string }>('DELETE', `/api/privacy/restricted/${userId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check if a user is restricted
     * @param userId - The user ID to check
     * @returns True if the user is restricted, false otherwise
     */
    async isUserRestricted(userId: string): Promise<boolean> {
      return this.isUserInList(
        userId,
        () => this.getRestrictedUsers(),
        (restrict) => restrict.restrictedId
      );
    }
  };
}

