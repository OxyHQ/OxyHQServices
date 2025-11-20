/**
 * Authentication Methods Mixin
 */
import type { User } from '../../models/interfaces';
import type { SessionLoginResponse } from '../../models/session';
import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';

export function OxyServicesAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }
    /**
     * Sign up a new user
     */
    async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
      try {
        const res = await this.makeRequest<{ message: string; token: string; user: User }>('POST', '/api/auth/signup', {
          username,
          email,
          password
        }, { cache: false });
        if (!res || (typeof res === 'object' && Object.keys(res).length === 0)) {
          throw new OxyAuthenticationError('Sign up failed', 'SIGNUP_FAILED', 400);
        }
        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Request account recovery (send verification code)
     */
    async requestRecovery(identifier: string): Promise<{ delivery?: string; destination?: string }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/request', { identifier }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    /**
     * Verify recovery code
     */
    async verifyRecoveryCode(identifier: string, code: string): Promise<{ verified: boolean }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/verify', { identifier, code }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    /**
     * Reset password using verified code
     */
    async resetPassword(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/reset', { identifier, code, newPassword }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    /**
     * Reset password using TOTP code (recommended recovery)
     */
    async resetPasswordWithTotp(identifier: string, code: string, newPassword: string): Promise<{ success: boolean }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/totp/reset', { identifier, code, newPassword }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    async resetPasswordWithBackupCode(identifier: string, backupCode: string, newPassword: string): Promise<{ success: boolean }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/backup/reset', { identifier, backupCode, newPassword }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    async resetPasswordWithRecoveryKey(identifier: string, recoveryKey: string, newPassword: string): Promise<{ success: boolean; nextRecoveryKey?: string }> {
      try {
        return await this.makeRequest('POST', '/api/auth/recover/recovery-key/reset', { identifier, recoveryKey, newPassword }, { cache: false });
      } catch (error: any) {
        throw this.handleError(error);
      }
    }

    /**
     * Sign in with device management
     */
    async signIn(
      username: string,
      password: string,
      deviceName?: string,
      deviceFingerprint?: any
    ): Promise<SessionLoginResponse | { mfaRequired: true; mfaToken: string; expiresAt: string }> {
      try {
        return await this.makeRequest<SessionLoginResponse | { mfaRequired: true; mfaToken: string; expiresAt: string }>('POST', '/api/auth/login', {
          username,
          password,
          deviceName,
          deviceFingerprint
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Complete login by verifying TOTP with MFA token
     */
    async verifyTotpLogin(mfaToken: string, code: string): Promise<SessionLoginResponse> {
      try {
        return await this.makeRequest<SessionLoginResponse>('POST', '/api/auth/totp/verify-login', { mfaToken, code }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user by session ID
     */
    async getUserBySession(sessionId: string): Promise<User> {
      try {
        return await this.makeRequest<User>('GET', `/api/session/user/${sessionId}`, undefined, {
          cache: true,
          cacheTTL: 2 * 60 * 1000, // 2 minutes cache for user data
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Batch get multiple user profiles by session IDs (optimized for account switching)
     * Returns array of { sessionId, user } objects
     */
    async getUsersBySessions(sessionIds: string[]): Promise<Array<{ sessionId: string; user: User | null }>> {
      try {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          return [];
        }
        
        // Deduplicate and sort sessionIds for consistent cache keys
        const uniqueSessionIds = Array.from(new Set(sessionIds)).sort();
        
        return await this.makeRequest<Array<{ sessionId: string; user: User | null }>>(
          'POST',
          '/api/session/users/batch',
          { sessionIds: uniqueSessionIds },
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000, // 2 minutes cache
            deduplicate: true, // Important for batch requests
          }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get access token by session ID and set it in the token store
     */
    async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
      try {
        const res = await this.makeRequest<{ accessToken: string; expiresAt: string }>('GET', `/api/session/token/${sessionId}`, undefined, {
          cache: false,
          retry: false,
        });
        
        // Set the token in the centralized token store
        this.setTokens(res.accessToken);
        
        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get sessions by session ID
     */
    async getSessionsBySessionId(sessionId: string): Promise<any[]> {
      try {
        return await this.makeRequest('GET', `/api/session/sessions/${sessionId}`, undefined, {
          cache: false,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Logout from a specific session
     */
    async logoutSession(sessionId: string, targetSessionId?: string): Promise<void> {
      try {
        const url = targetSessionId 
          ? `/api/session/logout/${sessionId}/${targetSessionId}`
          : `/api/session/logout/${sessionId}`;
        
        await this.makeRequest('POST', url, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Logout from all sessions
     */
    async logoutAllSessions(sessionId: string): Promise<void> {
      try {
        await this.makeRequest('POST', `/api/session/logout-all/${sessionId}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Validate session
     */
    async validateSession(
      sessionId: string, 
      options: {
        deviceFingerprint?: string;
        useHeaderValidation?: boolean;
      } = {}
    ): Promise<{ 
      valid: boolean; 
      expiresAt: string; 
      lastActivity: string; 
      user: User;
      sessionId?: string;
      source?: string;
    }> {
      try {
        const urlParams: any = {};
        if (options.deviceFingerprint) urlParams.deviceFingerprint = options.deviceFingerprint;
        if (options.useHeaderValidation) urlParams.useHeaderValidation = 'true';
        return await this.makeRequest('GET', `/api/session/validate/${sessionId}`, urlParams, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check username availability
     */
    async checkUsernameAvailability(username: string): Promise<{ available: boolean; message: string }> {
      try {
        return await this.makeRequest('GET', `/api/auth/check-username/${username}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check email availability
     */
    async checkEmailAvailability(email: string): Promise<{ available: boolean; message: string }> {
      try {
        return await this.makeRequest('GET', `/api/auth/check-email/${email}`, undefined, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}

