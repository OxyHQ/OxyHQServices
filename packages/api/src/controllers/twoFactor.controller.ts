import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import twoFactorService from '../services/twoFactor.service';
import { logger } from '../utils/logger';
import securityActivityService from '../services/securityActivityService';
import sessionService from '../services/session.service';
import { resolveLoginDevice, finalizeDeviceLogin } from '../services/deviceLogin.service';
import { setDeviceCookie } from '../utils/deviceCookie';
import { buildSessionAuthResponse } from './session.controller';
import { AuthRequest } from '../middleware/auth';
import { isLockedOut, recordFailure, clearFailures } from '../services/loginLockout.service';

const TWO_FACTOR_LOCKOUT_SCOPE = '2fa-login';

/**
 * Setup 2FA - Generate secret and return QR code data
 * Step 1: User requests to enable 2FA
 */
export async function setup2FA(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await User.findById(userId).select('+twoFactorAuth');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check if 2FA is already enabled
    if (user.twoFactorAuth?.enabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }

    // Generate new secret
    const identifier = user.username || user.email || user.publicKey?.substring(0, 10) || 'user';
    const { secret, otpauthUrl } = twoFactorService.generateSecret(identifier);

    // Store secret temporarily (not enabled yet)
    if (!user.twoFactorAuth) {
      user.twoFactorAuth = {
        enabled: false,
        secret: secret,
        backupCodes: [],
      };
    } else {
      user.twoFactorAuth.secret = secret;
      user.twoFactorAuth.enabled = false;
    }

    await user.save();

    return res.json({
      success: true,
      message: '2FA setup initiated',
      secret: secret, // Send to user for manual entry if needed
      otpauthUrl: otpauthUrl, // For QR code generation on client
    });
  } catch (error) {
    logger.error('Setup 2FA error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Enable 2FA - Verify token and enable 2FA
 * Step 2: User verifies they can generate valid tokens
 */
export async function enable2FA(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const { token } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!token) {
      return res.status(400).json({ message: 'Token is required' });
    }

    const user = await User.findById(userId).select('+twoFactorAuth');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.twoFactorAuth?.enabled) {
      return res.status(400).json({ message: '2FA is already enabled' });
    }

    if (!user.twoFactorAuth?.secret) {
      return res.status(400).json({ message: 'Please setup 2FA first' });
    }

    // Verify the token
    const isValid = twoFactorService.verifyToken(token, user.twoFactorAuth.secret);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid token' });
    }

    // Generate backup codes
    const { codes, hashedCodes } = await twoFactorService.generateBackupCodes(8);

    // Enable 2FA
    user.twoFactorAuth.enabled = true;
    user.twoFactorAuth.backupCodes = hashedCodes;
    user.twoFactorAuth.verifiedAt = new Date();

    await user.save();

    // Log security activity
    await securityActivityService.logSecurityEvent({
      userId: user._id.toString(),
      eventType: 'security_settings_changed',
      eventDescription: 'Two-factor authentication enabled',
      metadata: {
        setting: 'two_factor_auth',
        action: 'enabled',
      },
      req,
    });

    return res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes: codes, // Show these only once
    });
  } catch (error) {
    logger.error('Enable 2FA error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Disable 2FA - Requires password and optional 2FA token
 */
export async function disable2FA(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const { password, token } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!password) {
      return res.status(400).json({ message: 'Password is required' });
    }

    const user = await User.findById(userId).select('+password +twoFactorAuth');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorAuth?.enabled) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify password
    const { verifyPassword } = await import('../utils/password.js');
    if (!user.password || !(await verifyPassword(password, user.password))) {
      return res.status(401).json({ message: 'Invalid password' });
    }

    // If 2FA is enabled, require token verification
    if (token) {
      const isValid = twoFactorService.verifyToken(token, user.twoFactorAuth.secret!);
      if (!isValid) {
        return res.status(400).json({ message: 'Invalid 2FA token' });
      }
    }

    // Disable 2FA
    user.twoFactorAuth = {
      enabled: false,
      backupCodes: [],
    };

    await user.save();

    // Log security activity
    await securityActivityService.logSecurityEvent({
      userId: user._id.toString(),
      eventType: 'security_settings_changed',
      eventDescription: 'Two-factor authentication disabled',
      metadata: {
        setting: 'two_factor_auth',
        action: 'disabled',
      },
      req,
    });

    return res.json({
      success: true,
      message: '2FA disabled successfully',
    });
  } catch (error) {
    logger.error('Disable 2FA error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Verify 2FA token during login
 */
export async function verify2FAToken(req: Request, res: Response) {
  try {
    const { identifier, token, backupCode } = req.body;

    if (!identifier) {
      return res.status(400).json({ message: 'Identifier is required' });
    }

    if (!token && !backupCode) {
      return res.status(400).json({ message: 'Token or backup code is required' });
    }

    // Find user by email, username, or publicKey
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: identifier },
        { publicKey: identifier },
      ],
    }).select('+twoFactorAuth');

    if (!user || !user.twoFactorAuth?.enabled) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    let isValid = false;

    // Try TOTP token first
    if (token && user.twoFactorAuth.secret) {
      isValid = twoFactorService.verifyToken(token, user.twoFactorAuth.secret);
    }

    // Try backup code if token failed or not provided
    if (!isValid && backupCode && user.twoFactorAuth.backupCodes) {
      const codeIndex = await twoFactorService.verifyBackupCode(
        backupCode,
        user.twoFactorAuth.backupCodes
      );

      if (codeIndex >= 0) {
        isValid = true;

        // Remove used backup code
        user.twoFactorAuth.backupCodes.splice(codeIndex, 1);
        await user.save();

        // Log backup code usage
        await securityActivityService.logSecurityEvent({
          userId: user._id.toString(),
          eventType: 'security_settings_changed',
          eventDescription: 'Two-factor authentication backup code used',
          metadata: {
            setting: 'two_factor_auth',
            action: 'backup_code_used',
            remainingCodes: user.twoFactorAuth.backupCodes.length,
          },
          req,
        });
      }
    }

    if (!isValid) {
      return res.status(400).json({ message: 'Invalid token or backup code' });
    }

    // Update verified timestamp
    user.twoFactorAuth.verifiedAt = new Date();
    await user.save();

    return res.json({
      success: true,
      message: '2FA verified',
      userId: user._id,
    });
  } catch (error) {
    logger.error('Verify 2FA token error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Verify 2FA during login flow - accepts loginToken from signIn + TOTP/backup code
 * Creates a session on success and returns SessionAuthResponse.
 *
 * Lockout (H7): we track failed attempts per-userId (extracted from the
 * verified loginToken). After the configured threshold we return the same
 * generic "Invalid token or backup code" message plus a `Retry-After`
 * header — we never reveal that the account is locked.
 */
export async function verify2FALogin(req: Request, res: Response) {
  try {
    const { loginToken, token, backupCode, deviceName, deviceFingerprint, deviceToken } = req.body;

    if (!loginToken) {
      return res.status(400).json({ message: 'Login token is required' });
    }

    if (!token && !backupCode) {
      return res.status(400).json({ message: 'Token or backup code is required' });
    }

    const accessTokenSecret = process.env.ACCESS_TOKEN_SECRET;
    if (!accessTokenSecret) {
      logger.error('ACCESS_TOKEN_SECRET not configured');
      return res.status(500).json({ message: 'Server configuration error' });
    }

    // Verify the loginToken JWT
    let decoded: { userId: string; purpose: string };
    try {
      decoded = jwt.verify(loginToken, accessTokenSecret) as { userId: string; purpose: string };
    } catch {
      return res.status(401).json({ message: 'Login session expired. Please sign in again.' });
    }

    if (decoded.purpose !== '2fa_challenge') {
      return res.status(400).json({ message: 'Invalid login token' });
    }

    // Lockout check BEFORE looking up the user. Same generic 400 response
    // when locked — only the Retry-After header distinguishes the case.
    const lockoutIdentifier = decoded.userId;
    const lockState = await isLockedOut({
      scope: TWO_FACTOR_LOCKOUT_SCOPE,
      identifier: lockoutIdentifier,
    });
    if (lockState.locked && typeof lockState.retryAfterSeconds === 'number') {
      res.setHeader('Retry-After', String(lockState.retryAfterSeconds));
      return res.status(429).json({ message: 'Invalid token or backup code' });
    }

    const user = await User.findById(decoded.userId).select('+twoFactorAuth');
    if (!user || !user.twoFactorAuth?.enabled) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    let isValid = false;

    // Try TOTP token first
    if (token && user.twoFactorAuth.secret) {
      isValid = twoFactorService.verifyToken(token, user.twoFactorAuth.secret);
    }

    // Try backup code if token failed or not provided
    if (!isValid && backupCode && user.twoFactorAuth.backupCodes) {
      const codeIndex = await twoFactorService.verifyBackupCode(
        backupCode,
        user.twoFactorAuth.backupCodes
      );

      if (codeIndex >= 0) {
        isValid = true;
        user.twoFactorAuth.backupCodes.splice(codeIndex, 1);
        await user.save();

        await securityActivityService.logSecurityEvent({
          userId: user._id.toString(),
          eventType: 'security_settings_changed',
          eventDescription: 'Two-factor authentication backup code used during login',
          metadata: {
            setting: 'two_factor_auth',
            action: 'backup_code_used',
            remainingCodes: user.twoFactorAuth.backupCodes.length,
          },
          req,
        });
      }
    }

    if (!isValid) {
      const failure = await recordFailure({
        scope: TWO_FACTOR_LOCKOUT_SCOPE,
        identifier: lockoutIdentifier,
      });
      if (failure.locked && typeof failure.retryAfterSeconds === 'number') {
        res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        return res.status(429).json({ message: 'Invalid token or backup code' });
      }
      return res.status(400).json({ message: 'Invalid token or backup code' });
    }

    // Success — clear the lockout counter for this user.
    await clearFailures({
      scope: TWO_FACTOR_LOCKOUT_SCOPE,
      identifier: lockoutIdentifier,
    });

    // Update verified timestamp
    user.twoFactorAuth.verifiedAt = new Date();
    await user.save();

    // Device-first attribution (oxy_device cookie > deviceToken > same-site
    // cookie mint > none), resolved before mint so the session carries the
    // central deviceId.
    const twoFactorDevice = await resolveLoginDevice(req, deviceToken);

    // Create session (same as signIn would)
    const session = await sessionService.createSession(
      user._id.toString(),
      req,
      { deviceName, deviceFingerprint, ...(twoFactorDevice.deviceId ? { deviceId: twoFactorDevice.deviceId } : {}) }
    );

    // Plant the freshly-minted device cookie (same-site trusted logins only).
    if (twoFactorDevice.setCookieSecret) {
      setDeviceCookie(res, twoFactorDevice.setCookieSecret);
    }

    const baseTwoFactorResponse = buildSessionAuthResponse(session, user);
    if (!baseTwoFactorResponse) {
      return res.status(500).json({ message: 'Failed to format user data' });
    }
    const response: typeof baseTwoFactorResponse & { refreshToken?: string; deviceSecret?: string } = baseTwoFactorResponse;

    // Register into the device set (add-only) + broadcast, and additively attach
    // a rotating refresh token + deviceSecret when the lane allows it.
    // Best-effort.
    const twoFactorDeviceExtras = await finalizeDeviceLogin({
      req,
      deviceId: twoFactorDevice.deviceId,
      session,
      userId: user._id.toString(),
    });
    if (twoFactorDeviceExtras.refreshToken) {
      response.refreshToken = twoFactorDeviceExtras.refreshToken;
    }
    if (twoFactorDeviceExtras.deviceSecret) {
      response.deviceSecret = twoFactorDeviceExtras.deviceSecret;
    }

    try {
      await securityActivityService.logSignIn(
        user._id.toString(),
        req,
        session.deviceId,
        {
          deviceName: deviceName || session.deviceInfo?.deviceName,
          deviceType: session.deviceInfo?.deviceType,
          platform: session.deviceInfo?.platform,
        }
      );
    } catch (error) {
      logger.error('Failed to log security event for 2FA sign-in', error instanceof Error ? error : new Error(String(error)), {
        component: 'TwoFactorController',
        method: 'verify2FALogin',
        userId: user._id.toString(),
      });
    }

    return res.json(response);
  } catch (error) {
    logger.error('Verify 2FA login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Get 2FA status for current user
 */
export async function get2FAStatus(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const user = await User.findById(userId).select('twoFactorAuth');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      enabled: user.twoFactorAuth?.enabled || false,
      verifiedAt: user.twoFactorAuth?.verifiedAt,
      backupCodesCount: user.twoFactorAuth?.backupCodes?.length || 0,
    });
  } catch (error) {
    logger.error('Get 2FA status error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Regenerate backup codes (requires 2FA verification)
 */
export async function regenerateBackupCodes(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const { token } = req.body;

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    if (!token) {
      return res.status(400).json({ message: '2FA token is required' });
    }

    const user = await User.findById(userId).select('+twoFactorAuth');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.twoFactorAuth?.enabled || !user.twoFactorAuth.secret) {
      return res.status(400).json({ message: '2FA is not enabled' });
    }

    // Verify token
    const isValid = twoFactorService.verifyToken(token, user.twoFactorAuth.secret);
    if (!isValid) {
      return res.status(400).json({ message: 'Invalid 2FA token' });
    }

    // Generate new backup codes
    const { codes, hashedCodes } = await twoFactorService.generateBackupCodes(8);

    user.twoFactorAuth.backupCodes = hashedCodes;
    await user.save();

    // Log activity
    await securityActivityService.logSecurityEvent({
      userId: user._id.toString(),
      eventType: 'security_settings_changed',
      eventDescription: 'Two-factor authentication backup codes regenerated',
      metadata: {
        setting: 'two_factor_auth',
        action: 'backup_codes_regenerated',
      },
      req,
    });

    return res.json({
      success: true,
      message: 'Backup codes regenerated',
      backupCodes: codes, // Show only once
    });
  } catch (error) {
    logger.error('Regenerate backup codes error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
