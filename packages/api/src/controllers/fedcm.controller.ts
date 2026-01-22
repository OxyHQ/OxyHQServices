import { Request, Response } from 'express';
import fedcmService from '../services/fedcm.service';
import { logger } from '../utils/logger';

/**
 * Exchange FedCM ID token for an Oxy session
 *
 * This endpoint enables cross-domain SSO without cookies:
 * - Client receives ID token from FedCM (browser-native identity API)
 * - Client exchanges token here for a full Oxy session with access token
 * - Works across any domain (alia.onl, mention.earth, homiio.com, etc.)
 */
export async function exchangeIdToken(req: Request, res: Response) {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({
        message: 'id_token is required',
      });
    }

    const result = await fedcmService.exchangeIdToken(id_token, req);

    if (!result) {
      return res.status(401).json({
        message: 'Invalid or expired ID token',
      });
    }

    return res.json(result);
  } catch (error) {
    logger.error('FedCM token exchange error:', error);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
}

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
