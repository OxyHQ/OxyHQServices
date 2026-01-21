import FedCMClient from '../models/FedCMClient';
import { logger } from '../utils/logger';

/**
 * FedCM Service
 * Manages Federated Credential Management approved clients
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
}

export default new FedCMService();
