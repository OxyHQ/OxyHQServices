import FedCMClient from '../models/FedCMClient';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import sessionService from './session.service';
import { Request } from 'express';
import * as crypto from 'crypto';

// FedCM ID token issuer
const FEDCM_ISSUER = 'https://auth.oxy.so';

// Shared secret for verifying FedCM tokens - must match auth.oxy.so
if (!process.env.FEDCM_TOKEN_SECRET) {
  throw new Error('FEDCM_TOKEN_SECRET is required but not configured');
}
const FEDCM_TOKEN_SECRET = process.env.FEDCM_TOKEN_SECRET;

interface FedCMTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
}

/**
 * Verify and decode FedCM ID token (JWT with HS256)
 * @throws Error if token is invalid or signature doesn't match
 */
function verifyIdToken(token: string): FedCMTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format: expected 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', FEDCM_TOKEN_SECRET)
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Use timing-safe comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(signatureB64), Buffer.from(expectedSignature))) {
    throw new Error('Invalid token signature');
  }

  // Decode header and verify algorithm
  const header = JSON.parse(
    Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  );
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Decode and return payload
  const payload = JSON.parse(
    Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  );

  return payload as FedCMTokenPayload;
}

/**
 * FedCM Service
 * Manages Federated Credential Management approved clients and token exchange
 */
class FedCMService {
  /**
   * Get all approved client origins
   */
  async getApprovedClientOrigins(): Promise<string[]> {
    try {
      const clients = await FedCMClient.find({ approved: true })
        .select('origin')
        .lean();

      return clients.map(client => client.origin);
    } catch (error) {
      logger.error('Error fetching approved FedCM clients:', error);
      return [];
    }
  }

  /**
   * Check if a client origin is approved
   */
  async isClientApproved(origin: string): Promise<boolean> {
    try {
      const client = await FedCMClient.findOne({
        origin,
        approved: true,
      }).select('_id').lean();

      return !!client;
    } catch (error) {
      logger.error('Error checking FedCM client approval:', error);
      return false;
    }
  }

  /**
   * Seed initial approved clients (run once during setup)
   */
  async seedApprovedClients(): Promise<void> {
    try {
      const defaultClients = [
        {
          origin: 'https://oxy.so',
          name: 'Oxy',
          description: 'Oxy main platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://accounts.oxy.so',
          name: 'Oxy Accounts',
          description: 'Oxy accounts portal',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://homiio.com',
          name: 'Homiio',
          description: 'Homiio social platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://mention.earth',
          name: 'Mention Earth',
          description: 'Mention Earth platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://alia.onl',
          name: 'Alia',
          description: 'Alia platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'http://localhost:3000',
          name: 'Local Development (3000)',
          description: 'Development environment',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'http://localhost:8081',
          name: 'Local Development (8081)',
          description: 'Expo development environment',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
      ];

      for (const clientData of defaultClients) {
        await FedCMClient.findOneAndUpdate(
          { origin: clientData.origin },
          { $setOnInsert: clientData },
          { upsert: true, new: true }
        );
      }

      logger.info(`Seeded ${defaultClients.length} FedCM approved clients`);
    } catch (error) {
      logger.error('Error seeding FedCM clients:', error);
      throw error;
    }
  }

  /**
   * Add a new approved client
   */
  async addApprovedClient(
    origin: string,
    name: string,
    description?: string,
    approvedBy?: string
  ): Promise<typeof FedCMClient.prototype> {
    const client = await FedCMClient.create({
      origin,
      name,
      description,
      approved: true,
      autoSignIn: true,
      approvedAt: new Date(),
      approvedBy,
    });

    logger.info(`Added new FedCM approved client: ${origin}`);
    return client;
  }

  /**
   * Remove approved client
   */
  async removeApprovedClient(origin: string): Promise<boolean> {
    const result = await FedCMClient.deleteOne({ origin });
    return result.deletedCount > 0;
  }

  /**
   * Exchange FedCM ID token for a session
   *
   * This is the core of cross-domain SSO:
   * 1. FedCM provides an ID token (JWT) from auth.oxy.so
   * 2. Client sends token to this endpoint
   * 3. We verify the token and create a session
   * 4. Client gets session with access token - works across any domain
   *
   * @param idToken - The FedCM ID token (JWT from auth.oxy.so)
   * @param req - Express request for device info
   * @returns Session with access token, or null if invalid
   */
  async exchangeIdToken(
    idToken: string,
    req: Request
  ): Promise<{
    sessionId: string;
    deviceId: string;
    expiresAt: string;
    accessToken: string;
    user: { id: string; username?: string; email?: string; avatar?: string; name?: string };
  } | null> {
    logger.info('FedCM: exchangeIdToken called');

    try {
      // Verify and decode the ID token (includes signature verification)
      let tokenPayload: FedCMTokenPayload;
      try {
        tokenPayload = verifyIdToken(idToken);
        logger.debug('FedCM: Token verified successfully');
      } catch (error) {
        logger.warn('FedCM: Token verification failed');
        return null;
      }

      // Validate required fields
      if (!tokenPayload.sub || !tokenPayload.aud) {
        logger.warn('FedCM: Invalid token payload - missing sub or aud');
        return null;
      }

      // Verify issuer
      if (tokenPayload.iss !== FEDCM_ISSUER) {
        logger.warn('FedCM: Invalid issuer');
        return null;
      }

      // Check expiration
      if (tokenPayload.exp && tokenPayload.exp < Math.floor(Date.now() / 1000)) {
        logger.warn('FedCM: Token expired');
        return null;
      }

      // Verify the client origin is approved (optional but recommended)
      const clientOrigin = tokenPayload.aud;
      const isApproved = await this.isClientApproved(clientOrigin);
      if (!isApproved) {
        logger.warn('FedCM: Client origin not in approved list');
      }

      // Get user by ID (with virtuals to get name.full)
      const userId = tokenPayload.sub;
      const user = await User.findById(userId).select('-password').lean({ virtuals: true });

      if (!user) {
        logger.warn('FedCM: User not found for token exchange');
        return null;
      }

      // Create a new session for this user
      const session = await sessionService.createSession(userId, req, {
        deviceName: 'FedCM Sign-In',
      });

      logger.info('FedCM: Session created via token exchange', { clientOrigin });

      const userDoc = user as any;
      const response = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        accessToken: session.accessToken,
        user: {
          id: userDoc._id?.toString() || userDoc.id,
          username: userDoc.username,
          email: userDoc.email,
          avatar: userDoc.avatar,
          name: userDoc.name?.full || userDoc.name,
        },
      };
      return response;
    } catch (error) {
      logger.error('FedCM: Token exchange failed', error);
      return null;
    }
  }
}

export default new FedCMService();
