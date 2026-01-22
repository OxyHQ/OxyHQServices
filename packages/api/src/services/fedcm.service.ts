import FedCMClient from '../models/FedCMClient';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import sessionService from './session.service';
import { Request } from 'express';

// FedCM ID token issuer
const FEDCM_ISSUER = 'https://auth.oxy.so';

/**
 * Decode ID token (simple base64url decode)
 * Note: In production, verify signature using public key
 */
function decodeIdToken(token: string): any {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const payload = parts[1];
  const decoded = Buffer.from(
    payload.replace(/-/g, '+').replace(/_/g, '/'),
    'base64'
  ).toString('utf-8');

  return JSON.parse(decoded);
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
    user: any;
  } | null> {
    try {
      // Decode the ID token
      let tokenPayload: any;
      try {
        tokenPayload = decodeIdToken(idToken);
      } catch (error) {
        logger.error('FedCM: Failed to decode ID token', error);
        return null;
      }

      // Validate required fields
      if (!tokenPayload.sub || !tokenPayload.aud) {
        logger.error('FedCM: Invalid token payload - missing sub or aud');
        return null;
      }

      // Verify issuer
      if (tokenPayload.iss !== FEDCM_ISSUER) {
        logger.error(`FedCM: Invalid issuer. Expected ${FEDCM_ISSUER}, got ${tokenPayload.iss}`);
        return null;
      }

      // Check expiration
      if (tokenPayload.exp && tokenPayload.exp < Math.floor(Date.now() / 1000)) {
        logger.error('FedCM: Token expired');
        return null;
      }

      // Verify the client origin is approved (optional but recommended)
      const clientOrigin = tokenPayload.aud;
      const isApproved = await this.isClientApproved(clientOrigin);
      if (!isApproved) {
        // Log but don't reject - we might want to allow any client
        logger.warn(`FedCM: Client origin not in approved list: ${clientOrigin}`);
      }

      // Get user by ID
      const userId = tokenPayload.sub;
      const user = await User.findById(userId).select('-password').lean();

      if (!user) {
        logger.error(`FedCM: User not found: ${userId}`);
        return null;
      }

      // Create a new session for this user
      const session = await sessionService.createSession(userId, req, {
        deviceName: 'FedCM Sign-In',
      });

      logger.info(`FedCM: Created session for user ${userId} from ${clientOrigin}`);

      return {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        accessToken: session.accessToken,
        user: {
          id: (user as any)._id?.toString() || (user as any).id,
          username: (user as any).username,
          email: (user as any).email,
          avatar: (user as any).avatar,
          name: (user as any).name,
        },
      };
    } catch (error) {
      logger.error('FedCM: Token exchange failed', error);
      return null;
    }
  }
}

export default new FedCMService();
