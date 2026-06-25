/**
 * Social Authentication Service
 *
 * Verifies OAuth tokens/codes from Google, Apple, and GitHub.
 * Returns normalized user profile data for sign-in/sign-up flows.
 */

import jwt, { type JwtHeader, type JwtPayload } from 'jsonwebtoken';
import { createPublicKey, type KeyObject } from 'crypto';
import { logger } from '../utils/logger';

export interface SocialProfile {
  email?: string;
  providerId: string;
  name?: string;
  avatar?: string;
  username?: string;
}

type AppleJwk = { kid?: string; alg?: string; kty?: string; use?: string; [key: string]: unknown };

type AppleJwksResponse = {
  keys?: AppleJwk[];
};

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';
const APPLE_JWKS_CACHE_TTL_MS = 60 * 60 * 1000;

class SocialAuthService {
  private appleJwksCache: { keys: AppleJwk[]; expiresAt: number } | null = null;

  /**
   * Verify a Google ID token using Google's tokeninfo endpoint.
   * Returns normalized profile data or null if verification fails.
   */
  async verifyGoogleToken(idToken: string): Promise<SocialProfile | null> {
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      );

      if (!res.ok) {
        logger.warn('[SocialAuth] Google token verification failed', { status: res.status });
        return null;
      }

      const data = await res.json();

      // Validate audience matches our client ID
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (clientId && data.aud !== clientId) {
        logger.warn('[SocialAuth] Google token audience mismatch', {
          expected: clientId?.substring(0, 12) + '...',
          got: (data.aud as string)?.substring(0, 12) + '...',
        });
        return null;
      }

      if (!data.sub) {
        logger.warn('[SocialAuth] Google token missing sub claim');
        return null;
      }

      return {
        email: data.email || undefined,
        providerId: data.sub,
        name: data.name || undefined,
        avatar: data.picture || undefined,
      };
    } catch (error) {
      logger.error('[SocialAuth] Google token verification error', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Verify an Apple ID token (JWT) against Apple's JWKS.
   * Returns normalized profile data only after signature and claim validation.
   */
  async verifyAppleToken(idToken: string): Promise<SocialProfile | null> {
    try {
      const clientId = process.env.APPLE_CLIENT_ID;
      if (!clientId) {
        logger.error('[SocialAuth] APPLE_CLIENT_ID is not configured');
        return null;
      }

      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        logger.warn('[SocialAuth] Apple token is not a valid JWT');
        return null;
      }

      const header = decoded.header as JwtHeader;
      if (header.alg !== 'RS256' || !header.kid) {
        logger.warn('[SocialAuth] Apple token has unsupported header', { alg: header.alg });
        return null;
      }

      const key = await this.getAppleSigningKey(header.kid);
      if (!key) {
        logger.warn('[SocialAuth] Apple signing key not found', { kid: header.kid });
        return null;
      }

      const payload = await new Promise<JwtPayload>((resolve, reject) => {
        jwt.verify(
          idToken,
          key,
          {
            algorithms: ['RS256'],
            audience: clientId,
            issuer: APPLE_ISSUER,
          },
          (error, verified) => {
            if (error) {
              reject(error);
              return;
            }
            if (!verified || typeof verified === 'string') {
              reject(new Error('Apple token payload is invalid'));
              return;
            }
            resolve(verified);
          },
        );
      });

      if (!payload.sub) {
        logger.warn('[SocialAuth] Apple token missing sub claim');
        return null;
      }

      return {
        email: typeof payload.email === 'string' ? payload.email : undefined,
        providerId: payload.sub,
        // Apple only sends name on first authorization; the client must forward it
      };
    } catch (error) {
      logger.error('[SocialAuth] Apple token verification error', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  private async getAppleSigningKey(kid: string): Promise<KeyObject | null> {
    const keys = await this.getAppleJwks();
    const jwk = keys.find((key) => key.kid === kid && key.kty === 'RSA' && (!key.use || key.use === 'sig'));
    if (!jwk) {
      return null;
    }

    return createPublicKey({ key: jwk as any, format: 'jwk' });
  }

  private async getAppleJwks(): Promise<AppleJwk[]> {
    const now = Date.now();
    if (this.appleJwksCache && this.appleJwksCache.expiresAt > now) {
      return this.appleJwksCache.keys;
    }

    const res = await fetch(APPLE_JWKS_URL);
    if (!res.ok) {
      throw new Error(`Apple JWKS fetch failed with status ${res.status}`);
    }

    const data = (await res.json()) as AppleJwksResponse;
    const keys = Array.isArray(data.keys) ? data.keys : [];
    this.appleJwksCache = {
      keys,
      expiresAt: now + APPLE_JWKS_CACHE_TTL_MS,
    };
    return keys;
  }

  /**
   * Exchange a GitHub OAuth authorization code for an access token,
   * then fetch the user's profile and primary email.
   */
  async verifyGitHubCode(code: string): Promise<SocialProfile | null> {
    try {
      const clientId = process.env.GITHUB_CLIENT_ID;
      const clientSecret = process.env.GITHUB_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        logger.error('[SocialAuth] GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET not configured');
        return null;
      }

      // Exchange code for access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
        }),
      });

      if (!tokenRes.ok) {
        logger.warn('[SocialAuth] GitHub token exchange failed', { status: tokenRes.status });
        return null;
      }

      const tokenData = await tokenRes.json();

      if (tokenData.error || !tokenData.access_token) {
        logger.warn('[SocialAuth] GitHub token exchange returned error', {
          error: tokenData.error,
        });
        return null;
      }

      const accessToken = tokenData.access_token as string;

      // Fetch user profile and emails in parallel
      const [userRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
        fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github+json',
          },
        }),
      ]);

      if (!userRes.ok) {
        logger.warn('[SocialAuth] GitHub user fetch failed', { status: userRes.status });
        return null;
      }

      const userData = await userRes.json();

      if (!userData.id) {
        logger.warn('[SocialAuth] GitHub user data missing id');
        return null;
      }

      // Try to get primary verified email
      let email = userData.email as string | undefined;
      if (!email && emailsRes.ok) {
        const emails = await emailsRes.json();
        if (Array.isArray(emails)) {
          const primary = emails.find(
            (e: { primary?: boolean; verified?: boolean; email?: string }) =>
              e.primary && e.verified
          );
          email = primary?.email || emails.find((e: { verified?: boolean }) => e.verified)?.email;
        }
      }

      return {
        email: email || undefined,
        providerId: String(userData.id),
        name: userData.name || undefined,
        avatar: userData.avatar_url || undefined,
        username: userData.login || undefined,
      };
    } catch (error) {
      logger.error('[SocialAuth] GitHub verification error', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }
}

const socialAuthService = new SocialAuthService();
export default socialAuthService;
