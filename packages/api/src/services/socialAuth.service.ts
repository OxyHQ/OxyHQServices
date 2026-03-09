/**
 * Social Authentication Service
 *
 * Verifies OAuth tokens/codes from Google, Apple, and GitHub.
 * Returns normalized user profile data for sign-in/sign-up flows.
 */

import { logger } from '../utils/logger';

export interface SocialProfile {
  email?: string;
  providerId: string;
  name?: string;
  avatar?: string;
  username?: string;
}

class SocialAuthService {
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
   * Verify an Apple ID token (JWT).
   * Decodes the JWT payload to extract sub and email.
   * Apple tokens are signed by Apple's public keys; for production,
   * full JWKS verification should be added.
   */
  async verifyAppleToken(idToken: string): Promise<SocialProfile | null> {
    try {
      // Apple ID tokens are JWTs - decode the payload
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        logger.warn('[SocialAuth] Apple token is not a valid JWT');
        return null;
      }

      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8')
      );

      // Validate issuer
      if (payload.iss !== 'https://appleid.apple.com') {
        logger.warn('[SocialAuth] Apple token issuer mismatch', { iss: payload.iss });
        return null;
      }

      // Validate audience matches our client ID
      const clientId = process.env.APPLE_CLIENT_ID;
      if (clientId && payload.aud !== clientId) {
        logger.warn('[SocialAuth] Apple token audience mismatch');
        return null;
      }

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        logger.warn('[SocialAuth] Apple token expired');
        return null;
      }

      if (!payload.sub) {
        logger.warn('[SocialAuth] Apple token missing sub claim');
        return null;
      }

      return {
        email: payload.email || undefined,
        providerId: payload.sub,
        // Apple only sends name on first authorization; the client must forward it
      };
    } catch (error) {
      logger.error('[SocialAuth] Apple token verification error', error instanceof Error ? error : new Error(String(error)));
      return null;
    }
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
