/**
 * Authentication Methods Mixin
 * 
 * Public key authentication using ECDSA signatures.
 * No passwords required - authentication is done via challenge-response.
 */
import type { User } from '../../models/interfaces';
import type { SessionLoginResponse } from '../../models/session';
import type { OxyServicesBase } from '../OxyServices.base';
import { OxyAuthenticationError } from '../OxyServices.errors';

export interface ChallengeResponse {
  challenge: string;
  expiresAt: string;
}

export interface RegistrationRequest {
  publicKey: string;
  username: string;
  email?: string;
  signature: string;
  timestamp: number;
}

export interface ChallengeVerifyRequest {
  publicKey: string;
  challenge: string;
  signature: string;
  timestamp: number;
  deviceName?: string;
  deviceFingerprint?: string;
}

export interface PublicKeyCheckResponse {
  registered: boolean;
  message: string;
}

export function OxyServicesAuthMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Register a new identity with public key authentication
     * Identity is purely cryptographic - username and profile data are optional
     * 
     * @param publicKey - The user's ECDSA public key (hex)
     * @param signature - Signature of the registration request
     * @param timestamp - Timestamp when the signature was created
     * @param username - Optional username to set during registration
     */
    async register(
      publicKey: string,
      signature: string,
      timestamp: number,
      username?: string
    ): Promise<{ message: string; user: User }> {
      try {
        const payload: any = {
          publicKey,
          signature,
          timestamp,
        };
        
        // Include username if provided
        if (username && username.trim()) {
          payload.username = username.trim();
        }

        const res = await this.makeRequest<{ message: string; user: User }>('POST', '/api/auth/register', payload, { cache: false });

        if (!res || (typeof res === 'object' && Object.keys(res).length === 0)) {
          throw new OxyAuthenticationError('Registration failed', 'REGISTER_FAILED', 400);
        }

        return res;
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Request an authentication challenge
     * The client must sign this challenge with their private key
     * 
     * @param publicKey - The user's public key
     */
    async requestChallenge(publicKey: string): Promise<ChallengeResponse> {
      try {
        return await this.makeRequest<ChallengeResponse>('POST', '/api/auth/challenge', {
          publicKey,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Verify a signed challenge and create a session
     * 
     * @param publicKey - The user's public key
     * @param challenge - The challenge string from requestChallenge
     * @param signature - Signature of the auth message
     * @param timestamp - Timestamp when the signature was created
     * @param deviceName - Optional device name
     * @param deviceFingerprint - Optional device fingerprint
     */
    async verifyChallenge(
      publicKey: string,
      challenge: string,
      signature: string,
      timestamp: number,
      deviceName?: string,
      deviceFingerprint?: string
    ): Promise<SessionLoginResponse> {
      try {
        return await this.makeRequest<SessionLoginResponse>('POST', '/api/auth/verify', {
          publicKey,
          challenge,
          signature,
          timestamp,
          deviceName,
          deviceFingerprint,
        }, { cache: false });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Check if a public key is already registered
     */
    async checkPublicKeyRegistered(publicKey: string): Promise<PublicKeyCheckResponse> {
      try {
        return await this.makeRequest<PublicKeyCheckResponse>(
          'GET',
          `/api/auth/check-publickey/${encodeURIComponent(publicKey)}`,
          undefined,
          { cache: false }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get user by public key
     */
    async getUserByPublicKey(publicKey: string): Promise<User> {
      try {
        return await this.makeRequest<User>(
          'GET',
          `/api/auth/user/${encodeURIComponent(publicKey)}`,
          undefined,
          { cache: true, cacheTTL: 2 * 60 * 1000 }
        );
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
          cacheTTL: 2 * 60 * 1000,
        });
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Batch get multiple user profiles by session IDs
     */
    async getUsersBySessions(sessionIds: string[]): Promise<Array<{ sessionId: string; user: User | null }>> {
      try {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          return [];
        }
        
        const uniqueSessionIds = Array.from(new Set(sessionIds)).sort();
        
        return await this.makeRequest<Array<{ sessionId: string; user: User | null }>>(
          'POST',
          '/api/session/users/batch',
          { sessionIds: uniqueSessionIds },
          {
            cache: true,
            cacheTTL: 2 * 60 * 1000,
            deduplicate: true,
          }
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Get access token by session ID
     */
    async getTokenBySession(sessionId: string): Promise<{ accessToken: string; expiresAt: string }> {
      try {
        const res = await this.makeRequest<{ accessToken: string; expiresAt: string }>(
          'GET',
          `/api/session/token/${sessionId}`,
          undefined,
          { cache: false, retry: false }
        );
        
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

    // ==========================================
    // Deprecated methods - kept for reference
    // ==========================================

    /**
     * @deprecated Use register() with public key authentication instead
     */
    async signUp(username: string, email: string, password: string): Promise<{ message: string; token: string; user: User }> {
      throw new OxyAuthenticationError(
        'Password-based signup is no longer supported. Use register() with public key.',
        'DEPRECATED',
        410
      );
    }

    /**
     * @deprecated Use requestChallenge() and verifyChallenge() instead
     */
    async signIn(
      username: string,
      password: string,
      deviceName?: string,
      deviceFingerprint?: any
    ): Promise<SessionLoginResponse | { mfaRequired: true; mfaToken: string; expiresAt: string }> {
      throw new OxyAuthenticationError(
        'Password-based login is no longer supported. Use challenge-response authentication.',
        'DEPRECATED',
        410
      );
    }
  };
}
