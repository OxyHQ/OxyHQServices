import { Request, Response } from 'express';
import { User } from '../models/User';
import twoFactorService from '../services/twoFactor.service';
import { logger } from '../utils/logger';
import securityActivityService from '../services/securityActivityService';

/**
 * Setup 2FA - Generate secret and return QR code data
 * Step 1: User requests to enable 2FA
 */
export async function setup2FA(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
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
export async function enable2FA(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
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
    await securityActivityService.logActivity({
      userId: user._id,
      eventType: 'security_settings_changed',
      metadata: {
        setting: 'two_factor_auth',
        action: 'enabled',
        deviceInfo: (req as any).deviceInfo,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
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
export async function disable2FA(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
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
    const { verifyPassword } = await import('../utils/password');
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
    await securityActivityService.logActivity({
      userId: user._id,
      eventType: 'security_settings_changed',
      metadata: {
        setting: 'two_factor_auth',
        action: 'disabled',
        deviceInfo: (req as any).deviceInfo,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
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
        await securityActivityService.logActivity({
          userId: user._id,
          eventType: 'security_settings_changed',
          metadata: {
            setting: 'two_factor_auth',
            action: 'backup_code_used',
            remainingCodes: user.twoFactorAuth.backupCodes.length,
          },
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
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
 * Get 2FA status for current user
 */
export async function get2FAStatus(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;

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
export async function regenerateBackupCodes(req: Request, res: Response) {
  try {
    const userId = (req as any).user?.id;
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
    await securityActivityService.logActivity({
      userId: user._id,
      eventType: 'security_settings_changed',
      metadata: {
        setting: 'two_factor_auth',
        action: 'backup_codes_regenerated',
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
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
