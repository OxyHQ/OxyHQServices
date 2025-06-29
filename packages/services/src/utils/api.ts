/**
 * Centralized API utilities
 * All backend calls should go through this module to ensure consistency
 */

import type { OxyServices } from '../core';
import type { User } from '../models/interfaces';
import type { SecureLoginResponse, SecureClientSession } from '../models/secureSession';

export interface ApiUtilsConfig {
  oxyServices: OxyServices;
}

/**
 * Centralized API utilities class
 * Provides consistent error handling and response processing
 */
export class ApiUtils {
  private oxyServices: OxyServices;

  constructor(config: ApiUtilsConfig) {
    this.oxyServices = config.oxyServices;
  }

  /**
   * Authentication API calls
   */
  async login(username: string, password: string, deviceName?: string): Promise<User> {
    try {
      const response = await this.oxyServices.secureLogin(username, password, deviceName);
      return response.user;
    } catch (error) {
      throw this.handleError(error, 'Login failed');
    }
  }

  async logout(targetSessionId?: string): Promise<void> {
    try {
      if (targetSessionId) {
        await this.oxyServices.logoutSecureSession(
          this.getCurrentSessionId() || '',
          targetSessionId
        );
      } else {
        await this.oxyServices.logout();
      }
    } catch (error) {
      throw this.handleError(error, 'Logout failed');
    }
  }

  async logoutAll(): Promise<void> {
    try {
      const sessionId = this.getCurrentSessionId();
      if (sessionId) {
        await this.oxyServices.logoutAllSecureSessions(sessionId);
      } else {
        await this.oxyServices.logoutAllSessions();
      }
    } catch (error) {
      console.warn('Logout all failed, but clearing local state:', error);
      // Always clear tokens even if request fails
      this.oxyServices.clearTokens();
    }
  }

  async signUp(username: string, email: string, password: string): Promise<User> {
    try {
      const response = await this.oxyServices.signUp(username, email, password);
      return response.user;
    } catch (error) {
      throw this.handleError(error, 'Registration failed');
    }
  }

  async getCurrentUser(): Promise<User> {
    try {
      return await this.oxyServices.getCurrentUser();
    } catch (error) {
      throw this.handleError(error, 'Failed to get current user');
    }
  }

  async updateProfile(updates: Record<string, any>): Promise<User> {
    try {
      return await this.oxyServices.updateProfile(updates);
    } catch (error) {
      throw this.handleError(error, 'Profile update failed');
    }
  }

  /**
   * Session management API calls
   */
  async getSessions(): Promise<SecureClientSession[]> {
    try {
      // Try to get secure sessions first, fallback to regular sessions
      const sessionId = this.getCurrentSessionId();
      if (sessionId) {
        const sessions = await this.oxyServices.getSessionsBySessionId(sessionId);
        return sessions.map(s => this.normalizeSession(s));
      } else {
        const sessions = await this.oxyServices.getUserSessions();
        return sessions.map(s => this.normalizeSession(s));
      }
    } catch (error) {
      console.warn('Failed to get sessions:', error);
      return [];
    }
  }

  async switchSession(sessionId: string): Promise<void> {
    try {
      const tokenData = await this.oxyServices.getTokenBySession(sessionId);
      this.oxyServices.setTokens(tokenData.accessToken, ''); // Refresh token not provided in this endpoint
    } catch (error) {
      throw this.handleError(error, 'Session switch failed');
    }
  }

  async removeSession(sessionId: string): Promise<void> {
    try {
      const currentSessionId = this.getCurrentSessionId();
      if (currentSessionId) {
        await this.oxyServices.logoutSecureSession(currentSessionId, sessionId);
      } else {
        await this.oxyServices.logoutSession(sessionId);
      }
    } catch (error) {
      throw this.handleError(error, 'Remove session failed');
    }
  }

  /**
   * Follow API calls
   */
  async followUser(userId: string): Promise<{ success: boolean; isFollowing: boolean }> {
    try {
      await this.oxyServices.followUser(userId);
      return { success: true, isFollowing: true };
    } catch (error: any) {
      // Check if error indicates user is already followed
      if (error.message?.includes('already following')) {
        return { success: true, isFollowing: true };
      }
      throw this.handleError(error, 'Follow user failed');
    }
  }

  async unfollowUser(userId: string): Promise<{ success: boolean; isFollowing: boolean }> {
    try {
      await this.oxyServices.unfollowUser(userId);
      return { success: true, isFollowing: false };
    } catch (error: any) {
      // Check if error indicates user is not followed
      if (error.message?.includes('not following')) {
        return { success: true, isFollowing: false };
      }
      throw this.handleError(error, 'Unfollow user failed');
    }
  }

  async getFollowStatus(userId: string): Promise<{ isFollowing: boolean }> {
    try {
      return await this.oxyServices.getFollowStatus(userId);
    } catch (error) {
      console.warn(`Failed to get follow status for user ${userId}:`, error);
      // Return default state on error
      return { isFollowing: false };
    }
  }

  /**
   * Device management API calls
   */
  async getDeviceSessions(): Promise<any[]> {
    try {
      const sessionId = this.getCurrentSessionId();
      if (sessionId) {
        return await this.oxyServices.getDeviceSessions(sessionId);
      }
      return [];
    } catch (error) {
      console.warn('Failed to get device sessions:', error);
      return [];
    }
  }

  async logoutAllDeviceSessions(): Promise<void> {
    try {
      const sessionId = this.getCurrentSessionId();
      if (sessionId) {
        await this.oxyServices.logoutAllDeviceSessions(sessionId);
      }
    } catch (error) {
      throw this.handleError(error, 'Logout all device sessions failed');
    }
  }

  async updateDeviceName(deviceName: string): Promise<void> {
    try {
      const sessionId = this.getCurrentSessionId();
      if (sessionId) {
        await this.oxyServices.updateDeviceName(sessionId, deviceName);
      }
    } catch (error) {
      throw this.handleError(error, 'Update device name failed');
    }
  }

  /**
   * Utility methods
   */
  async ensureToken(): Promise<void> {
    try {
      const isValid = await this.oxyServices.validate();
      if (!isValid) {
        throw new Error('Token validation failed');
      }
    } catch (error) {
      throw this.handleError(error, 'Token validation failed');
    }
  }

  getCurrentUserId(): string | null {
    return this.oxyServices.getCurrentUserId();
  }

  isAuthenticated(): boolean {
    return !!this.oxyServices.getCurrentUserId();
  }

  /**
   * Private helper methods
   */
  private getCurrentSessionId(): string | null {
    // This would be stored when we do secure login
    // For now, we'll derive from the current user ID
    return this.getCurrentUserId();
  }

  private normalizeSession(session: any): SecureClientSession {
    return {
      sessionId: session.id || session.sessionId,
      deviceName: session.deviceName || 'Unknown Device',
      lastActivity: session.lastActivity || session.lastActive || new Date().toISOString(),
      isCurrentSession: session.isCurrentSession || false,
      minimalUser: session.user ? {
        id: session.user.id,
        username: session.user.username,
        avatar: session.user.avatar
      } : null
    };
  }

  private handleError(error: any, defaultMessage: string): Error {
    const message = error?.message || defaultMessage;
    const errorObj = new Error(message);
    (errorObj as any).code = error?.code || 'API_ERROR';
    (errorObj as any).status = error?.status || 500;
    return errorObj;
  }
}

/**
 * Create API utilities instance
 */
export function createApiUtils(oxyServices: OxyServices): ApiUtils {
  return new ApiUtils({ oxyServices });
}