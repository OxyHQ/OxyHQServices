/**
 * Centralized API utilities
 * All backend calls should go through this module to ensure consistency
 */

import type { OxyServices } from '../core';
import type { User } from '../models/interfaces';
import type { SecureLoginResponse, SecureClientSession } from '../models/secureSession';
import { useOxyStore } from '../stores';

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
   * Public getter for oxyServices
   */
  public getOxyServices(): OxyServices {
    return this.oxyServices;
  }

  /**
   * Authentication API calls
   */
  async login(username: string, password: string, deviceName?: string): Promise<User> {
    try {
      const response = await this.oxyServices.secureLogin(username, password, deviceName);
      console.log('[ApiUtils] Login response received:', {
        hasSessionId: !!response.sessionId,
        sessionId: response.sessionId?.substring(0, 8) + '...',
        hasUser: !!response.user,
        username: response.user?.username,
      });
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
      console.log('[ApiUtils] ensureToken: Starting token validation');
      
      // First, check if we have tokens
      const accessToken = this.oxyServices.getAccessToken();
      const refreshToken = this.oxyServices.getRefreshToken();
      
      console.log('[ApiUtils] ensureToken: Checking tokens:', {
        hasAccessToken: !!accessToken,
        hasRefreshToken: !!refreshToken,
        accessTokenLength: accessToken?.length || 0,
        refreshTokenLength: refreshToken?.length || 0
      });
      
      // If we have tokens, validate them
      if (accessToken && refreshToken) {
        try {
          const isValid = await this.oxyServices.validate();
          if (isValid) {
            console.log('[ApiUtils] ensureToken: Tokens are valid');
            return;
          }
        } catch (validationError) {
          console.warn('[ApiUtils] ensureToken: Token validation failed:', validationError);
          // Continue to try to refresh tokens
        }
      }
      
      // If we don't have tokens or they're invalid, try to get them from the current session
      let currentUserId = this.getCurrentUserId();
      console.log('[ApiUtils] ensureToken: Current user ID from OxyServices:', currentUserId);
      
      // If OxyServices doesn't have a current user ID, try to get it from the store
      if (!currentUserId) {
        try {
          const storeState = useOxyStore.getState();
          console.log('[ApiUtils] ensureToken: Store state:', {
            hasUser: !!storeState.user,
            isAuthenticated: storeState.isAuthenticated,
            userId: storeState.user?.id,
            username: storeState.user?.username,
          });
          
          if (storeState.user?.id) {
            currentUserId = storeState.user.id;
            console.log('[ApiUtils] ensureToken: Got user ID from store:', currentUserId);
          }
        } catch (storeError) {
          console.warn('[ApiUtils] ensureToken: Failed to get user from store:', storeError);
        }
      }
      
      // Try to get session ID from the store
      const currentSessionId = this.getCurrentSessionId();
      console.log('[ApiUtils] ensureToken: Session ID check:', {
        hasSessionId: !!currentSessionId,
        sessionId: currentSessionId?.substring(0, 8) + '...',
        hasUserId: !!currentUserId,
      });
      
      if (currentSessionId) {
        console.log('[ApiUtils] ensureToken: No valid tokens, trying to get from session:', currentSessionId);
        
        try {
          // Try to get token by session using the actual session ID
          const tokenData = await this.oxyServices.getTokenBySession(currentSessionId);
          console.log('[ApiUtils] ensureToken: Retrieved token from session:', !!tokenData.accessToken);
          
          // Set the tokens on the service
          this.oxyServices.setTokens(tokenData.accessToken, ''); // Refresh token not provided in this endpoint
          
          // Validate the new token
          const isValid = await this.oxyServices.validate();
          if (isValid) {
            console.log('[ApiUtils] ensureToken: Session token is valid');
            return;
          }
        } catch (sessionError) {
          console.warn('[ApiUtils] ensureToken: Failed to get token from session:', sessionError);
        }
      } else if (currentUserId) {
        console.log('[ApiUtils] ensureToken: No session ID found, but user is authenticated. This may indicate a missing session ID.');
      }
      
      // If we have a current user but can't get valid tokens, this might be a temporary issue
      // Check if the user is authenticated in the store
      let isUserAuthenticatedInStore = false;
      try {
        const storeState = useOxyStore.getState();
        isUserAuthenticatedInStore = storeState.isAuthenticated && !!storeState.user;
        console.log('[ApiUtils] ensureToken: Store authentication check:', {
          isAuthenticated: storeState.isAuthenticated,
          hasUser: !!storeState.user,
          isUserAuthenticatedInStore,
        });
      } catch (storeError) {
        console.warn('[ApiUtils] ensureToken: Failed to check store authentication state:', storeError);
      }
      
      if (currentUserId || isUserAuthenticatedInStore) {
        console.warn('[ApiUtils] ensureToken: User is authenticated but cannot validate tokens. This might be a temporary issue.');
        console.log('[ApiUtils] ensureToken: Authentication state:', {
          hasCurrentUserId: !!currentUserId,
          isAuthenticatedInStore: isUserAuthenticatedInStore,
        });
        // Return without throwing - the user is authenticated, just token validation failed
        return;
      }
      
      // Only throw an error if we have no user and no tokens
      console.error('[ApiUtils] ensureToken: No authenticated user found');
      throw new Error('No authenticated user found');
    } catch (error: any) {
      // Only throw the error if it's not about token validation for an authenticated user
      if (error.message === 'No authenticated user found') {
        throw this.handleError(error, 'Token validation failed');
      }
      // For other errors, just log and return - don't break the app
      console.warn('[ApiUtils] ensureToken: Error during token validation:', error);
      return;
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
    // Get the active session ID from the store
    try {
      const storeState = useOxyStore.getState();
      const activeSessionId = storeState.activeSessionId;
      console.log('[ApiUtils] getCurrentSessionId: Retrieved from store:', {
        activeSessionId,
        hasActiveSessionId: !!activeSessionId,
      });
      return activeSessionId;
    } catch (error) {
      console.warn('[ApiUtils] getCurrentSessionId: Failed to get from store:', error);
      // Fallback to null if store access fails
      return null;
    }
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