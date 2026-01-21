import { authenticator } from 'otplib';
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '../utils/password';

/**
 * Two-Factor Authentication Service
 * Handles TOTP generation, verification, and backup codes
 */
class TwoFactorService {
  /**
   * Generate a new TOTP secret for a user
   */
  generateSecret(username: string): { secret: string; otpauthUrl: string } {
    const secret = authenticator.generateSecret();

    // Generate otpauth URL for QR code
    const otpauthUrl = authenticator.keyuri(
      username,
      'OxyHQ Services',
      secret
    );

    return { secret, otpauthUrl };
  }

  /**
   * Verify a TOTP token against a secret
   */
  verifyToken(token: string, secret: string): boolean {
    try {
      // Remove any spaces or dashes from token
      const cleanToken = token.replace(/[\s-]/g, '');

      return authenticator.verify({
        token: cleanToken,
        secret: secret,
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate backup codes for account recovery
   * Returns unhashed codes to display to user, and hashed codes to store
   */
  async generateBackupCodes(count: number = 8): Promise<{
    codes: string[];
    hashedCodes: string[];
  }> {
    const codes: string[] = [];
    const hashedCodes: string[] = [];

    for (let i = 0; i < count; i++) {
      // Generate 8-character alphanumeric code
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      codes.push(code);

      // Hash the code before storing
      const hashed = await hashPassword(code);
      hashedCodes.push(hashed);
    }

    return { codes, hashedCodes };
  }

  /**
   * Verify a backup code against stored hashed codes
   * Returns the index of the matched code, or -1 if not found
   */
  async verifyBackupCode(
    code: string,
    hashedCodes: string[]
  ): Promise<number> {
    const cleanCode = code.replace(/[\s-]/g, '').toUpperCase();

    for (let i = 0; i < hashedCodes.length; i++) {
      const isValid = await verifyPassword(cleanCode, hashedCodes[i]);
      if (isValid) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Generate QR code data URL for TOTP setup
   * Note: This returns the otpauth URL - client should generate QR code
   */
  getQRCodeData(otpauthUrl: string): string {
    return otpauthUrl;
  }
}

export default new TwoFactorService();
