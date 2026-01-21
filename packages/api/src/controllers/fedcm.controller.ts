import { Request, Response } from 'express';
import fedcmService from '../services/fedcm.service';
import { logger } from '../utils/logger';

/**
 * Get approved FedCM client origins
 */
export async function getApprovedClients(req: Request, res: Response) {
  try {
    const origins = await fedcmService.getApprovedClientOrigins();

    return res.json({
      success: true,
      clients: origins,
    });
  } catch (error) {
    logger.error('Get approved FedCM clients error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Add a new approved client (admin only)
 */
export async function addApprovedClient(req: Request, res: Response) {
  try {
    const { origin, name, description } = req.body;
    const userId = (req as any).user?.id;

    if (!origin || !name) {
      return res.status(400).json({ message: 'Origin and name are required' });
    }

    // Validate origin format
    try {
      const url = new URL(origin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return res.status(400).json({ message: 'Origin must use HTTP or HTTPS protocol' });
      }
    } catch {
      return res.status(400).json({ message: 'Invalid origin URL' });
    }

    const client = await fedcmService.addApprovedClient(
      origin,
      name,
      description,
      userId
    );

    return res.json({
      success: true,
      message: 'Client added successfully',
      client: {
        origin: client.origin,
        name: client.name,
        description: client.description,
      },
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ message: 'Client origin already exists' });
    }

    logger.error('Add approved FedCM client error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Remove an approved client (admin only)
 */
export async function removeApprovedClient(req: Request, res: Response) {
  try {
    const { origin } = req.params;

    if (!origin) {
      return res.status(400).json({ message: 'Origin is required' });
    }

    const removed = await fedcmService.removeApprovedClient(origin);

    if (!removed) {
      return res.status(404).json({ message: 'Client not found' });
    }

    return res.json({
      success: true,
      message: 'Client removed successfully',
    });
  } catch (error) {
    logger.error('Remove approved FedCM client error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}
