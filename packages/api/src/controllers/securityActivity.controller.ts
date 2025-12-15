import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import securityActivityService from '../services/securityActivityService';
import { SecurityEventType, SECURITY_EVENT_TYPES } from '../models/SecurityActivity';
import { validatePagination } from '../utils/validation';
import { sendPaginated } from '../utils/asyncHandler';
import { logger } from '../utils/logger';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Get user's security activity with pagination
 * GET /api/security/activity
 */
export const getSecurityActivity = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userId = req.user._id.toString();
    const { limit: parsedLimit, offset: parsedOffset } = validatePagination(
      req.query.limit,
      req.query.offset,
      MAX_LIMIT,
      DEFAULT_LIMIT
    );

    const eventType = req.query.eventType as SecurityEventType | undefined;
    
    // Validate event type if provided
    if (eventType && !SECURITY_EVENT_TYPES.includes(eventType)) {
      res.status(400).json({ error: 'Invalid event type' });
      return;
    }

    const result = await securityActivityService.getUserSecurityActivity(userId, {
      limit: parsedLimit,
      offset: parsedOffset,
      eventType,
    });

    // Transform activities for response
    const activities = result.activities.map((activity) => ({
      id: activity._id.toString(),
      userId: activity.userId.toString(),
      eventType: activity.eventType,
      eventDescription: activity.eventDescription,
      metadata: activity.metadata || {},
      ipAddress: activity.ipAddress,
      userAgent: activity.userAgent,
      deviceId: activity.deviceId,
      timestamp: activity.timestamp,
      severity: activity.severity,
      createdAt: activity.createdAt,
    }));

    logger.debug('Security activity fetched', {
      userId,
      limit: parsedLimit,
      offset: parsedOffset,
      eventType,
      total: result.total,
    });

    sendPaginated(res, activities, result.total, parsedLimit, parsedOffset);
  } catch (error: any) {
    logger.error('Error fetching security activity', error instanceof Error ? error : new Error(String(error)), {
      component: 'SecurityActivityController',
      method: 'getSecurityActivity',
      userId: req.user?._id?.toString(),
    });
    res.status(500).json({ error: 'Failed to fetch security activity' });
  }
};

