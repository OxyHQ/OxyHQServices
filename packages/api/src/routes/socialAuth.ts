/**
 * Social Authentication Routes
 *
 * Unauthenticated endpoints for signing in or signing up via OAuth providers
 * (Google, Apple, GitHub). If the social account is already linked to a user,
 * a session is created. Otherwise a new user is created and linked.
 *
 * These are separate from the authLinking routes, which require an existing
 * authenticated session and let users ADD social accounts to their profile.
 */

import { Router } from 'express';
import { User } from '../models/User';
import type { AuthMethod } from '../models/User';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, UnauthorizedError } from '../utils/error';
import { formatUserResponse } from '../utils/userTransform';
import { logger } from '../utils/logger';
import sessionService from '../services/session.service';
import securityActivityService from '../services/securityActivityService';
import socialAuthService from '../services/socialAuth.service';
import type { SocialProfile } from '../services/socialAuth.service';

const router = Router();

// Rate limit social sign-in: 10 attempts per minute per IP (relaxed in dev)
const socialLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 100 : 10,
  message: 'Too many sign-in attempts, please try again later.',
});

router.use(socialLimiter);

// ---- helpers ----------------------------------------------------------------

type ProviderType = 'google' | 'apple' | 'github';

/**
 * Core flow shared by all social sign-in endpoints:
 *   1. Find existing user by provider + providerId
 *   2. If not found, create a new user and link the auth method
 *   3. Create a session and return SessionAuthResponse
 */
async function handleSocialSignIn(
  provider: ProviderType,
  profile: SocialProfile,
  req: import('express').Request,
  res: import('express').Response,
) {
  const { providerId, email, name, avatar, username } = profile;

  // 1. Look up by auth method
  let user = await User.findOne({
    'authMethods.type': provider,
    'authMethods.metadata.providerId': providerId,
  });

  let isNewUser = false;

  if (!user) {
    // 2. Check if a user already exists with the same email
    if (email) {
      user = await User.findOne({ email: email.trim().toLowerCase() });
    }

    if (user) {
      // Link this social account to the existing email-based user
      if (!user.authMethods) {
        user.authMethods = [];
      }
      user.authMethods.push({
        type: provider,
        linkedAt: new Date(),
        metadata: { providerId, email },
      } as AuthMethod);
      if (avatar && !user.avatar) {
        user.avatar = avatar;
      }
      await user.save();
    } else {
      // 3. Create a brand-new user
      isNewUser = true;

      // Generate a unique username from provider data or email prefix
      let desiredUsername = username || email?.split('@')[0];
      if (desiredUsername) {
        // Sanitize to alphanumeric
        desiredUsername = desiredUsername.replace(/[^a-zA-Z0-9]/g, '');
        if (desiredUsername.length < 3) {
          desiredUsername = undefined;
        }
      }

      // Make sure username is unique if provided
      if (desiredUsername) {
        const existing = await User.findOne({ username: desiredUsername }).select('_id').lean();
        if (existing) {
          // Append random digits to make it unique
          desiredUsername = `${desiredUsername}${Math.floor(1000 + Math.random() * 9000)}`;
        }
      }

      user = new User({
        email: email ? email.trim().toLowerCase() : undefined,
        username: desiredUsername,
        avatar,
        name: name ? { first: name.split(' ')[0], last: name.split(' ').slice(1).join(' ') || undefined } : undefined,
        authMethods: [
          {
            type: provider,
            linkedAt: new Date(),
            metadata: { providerId, email },
          },
        ],
      });
      await user.save();
    }
  }

  // 4. Create session
  const session = await sessionService.createSession(user._id.toString(), req, {
    deviceName: `${provider.charAt(0).toUpperCase() + provider.slice(1)} Sign-In`,
  });

  // 5. Build response (same shape as password sign-in)
  const userData = formatUserResponse(user);
  if (!userData) {
    throw new Error('Failed to format user data');
  }

  const response = {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    expiresAt: session.expiresAt.toISOString(),
    accessToken: session.accessToken,
    user: {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
    },
  };

  // 6. Log security event (non-blocking)
  try {
    await securityActivityService.logSignIn(user._id.toString(), req, session.deviceId, {
      deviceName: session.deviceInfo?.deviceName,
      deviceType: session.deviceInfo?.deviceType,
      platform: session.deviceInfo?.platform,
    });
  } catch (error) {
    logger.error('[SocialAuth] Failed to log security event', error instanceof Error ? error : new Error(String(error)), {
      component: 'socialAuth',
      provider,
      userId: user._id.toString(),
    });
  }

  logger.info('[SocialAuth] Social sign-in successful', {
    provider,
    userId: user._id.toString(),
    isNewUser,
  });

  return res.json(response);
}

// ---- routes -----------------------------------------------------------------

/**
 * POST /auth/social/google
 * Body: { idToken, deviceName?, deviceFingerprint? }
 */
router.post('/google', asyncHandler(async (req, res) => {
  const { idToken } = req.body;
  if (!idToken || typeof idToken !== 'string') {
    throw new BadRequestError('idToken is required');
  }

  const profile = await socialAuthService.verifyGoogleToken(idToken);
  if (!profile) {
    throw new UnauthorizedError('Invalid Google token');
  }

  return handleSocialSignIn('google', profile, req, res);
}));

/**
 * POST /auth/social/apple
 * Body: { idToken, name?, deviceName?, deviceFingerprint? }
 *
 * Apple only sends the user's name on the very first authorization.
 * Clients should forward it in the request body so we can store it.
 */
router.post('/apple', asyncHandler(async (req, res) => {
  const { idToken, name } = req.body;
  if (!idToken || typeof idToken !== 'string') {
    throw new BadRequestError('idToken is required');
  }

  const profile = await socialAuthService.verifyAppleToken(idToken);
  if (!profile) {
    throw new UnauthorizedError('Invalid Apple token');
  }

  // Apple only provides name on first auth; merge client-provided name
  if (name && typeof name === 'string' && !profile.name) {
    profile.name = name;
  }

  return handleSocialSignIn('apple', profile, req, res);
}));

/**
 * POST /auth/social/github
 * Body: { code, deviceName?, deviceFingerprint? }
 */
router.post('/github', asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    throw new BadRequestError('code is required');
  }

  const profile = await socialAuthService.verifyGitHubCode(code);
  if (!profile) {
    throw new UnauthorizedError('Invalid GitHub authorization code');
  }

  return handleSocialSignIn('github', profile, req, res);
}));

export default router;
