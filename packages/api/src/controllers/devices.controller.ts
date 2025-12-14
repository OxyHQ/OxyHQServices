import { Request, Response } from 'express';
import Session from '../models/Session';
import { logger } from '../utils/logger';
import { extractTokenFromRequest, decodeToken } from '../middleware/authUtils';
import sessionService from '../services/session.service';
import { AuthRequest } from '../middleware/auth';
import { emitSessionUpdate } from '../server';

export class DevicesController {
  /**
   * Get all unique devices for the authenticated user
   * GET /api/devices
   */
  static async getUserDevices(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const userId = user._id.toString();

      // Get current session to identify current device
      const token = extractTokenFromRequest(req);
      let currentDeviceId: string | null = null;
      if (token) {
        const decoded = decodeToken(token);
        if (decoded?.sessionId) {
          try {
            const sessionResult = await sessionService.validateSessionById(decoded.sessionId, false);
            if (sessionResult?.session) {
              currentDeviceId = sessionResult.session.deviceId;
            }
          } catch (error) {
            logger.debug('Could not get current session for device identification', { error });
          }
        }
      }

      // Query all active sessions for this user
      const now = new Date();
      const sessions = await Session.find({
        userId: user._id,
        isActive: true,
        expiresAt: { $gt: now }
      })
      .sort({ 'deviceInfo.lastActive': -1 })
      .lean()
      .exec();

      // Group by deviceId and get the most recent session info for each device
      const deviceMap = new Map<string, any>();

      for (const session of sessions) {
        const deviceId = session.deviceId;
        if (!deviceId) continue;

        // If we already have this device, keep the one with more recent lastActive
        const existing = deviceMap.get(deviceId);
        if (existing) {
          const existingTime = new Date(existing.lastActive || existing.createdAt || 0).getTime();
          const currentTime = new Date(session.deviceInfo?.lastActive || session.createdAt || 0).getTime();
          if (currentTime <= existingTime) {
            continue; // Keep existing (more recent)
          }
        }

        // Store device info from most recent session
        deviceMap.set(deviceId, {
          id: deviceId,
          deviceId: deviceId,
          name: session.deviceInfo?.deviceName || 'Unknown Device',
          deviceName: session.deviceInfo?.deviceName || 'Unknown Device',
          type: session.deviceInfo?.deviceType || 'unknown',
          deviceType: session.deviceInfo?.deviceType || 'unknown',
          lastActive: session.deviceInfo?.lastActive || session.createdAt || new Date().toISOString(),
          createdAt: session.createdAt || new Date().toISOString(),
          isCurrent: currentDeviceId ? deviceId === currentDeviceId : false
        });
      }

      // Convert map to array
      const devices = Array.from(deviceMap.values());

      res.json(devices);
    } catch (error) {
      logger.error('Get user devices error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Remove a device (logout all sessions on that device)
   * DELETE /api/devices/:deviceId
   */
  static async removeDevice(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { deviceId } = req.params;
      if (!deviceId) {
        return res.status(400).json({ error: 'Device ID is required' });
      }

      // Get current session to check if trying to remove current device
      const token = extractTokenFromRequest(req);
      let currentDeviceId: string | null = null;
      if (token) {
        const decoded = decodeToken(token);
        if (decoded?.sessionId) {
          try {
            const sessionResult = await sessionService.validateSessionById(decoded.sessionId, false);
            if (sessionResult?.session) {
              currentDeviceId = sessionResult.session.deviceId;
            }
          } catch (error) {
            logger.debug('Could not get current session', { error });
          }
        }
      }

      // Prevent removing current device
      if (currentDeviceId && deviceId === currentDeviceId) {
        return res.status(400).json({ 
          error: 'Cannot remove current device',
          message: 'You cannot remove your current device. Please use another device to remove this one.'
        });
      }

      // Only query and remove sessions belonging to the requesting user on this device
      const now = new Date();
      const userDeviceSessions = await Session.find({
        userId: user._id,
        deviceId: deviceId,
        isActive: true,
        expiresAt: { $gt: now }
      }).select('sessionId').lean().exec();

      if (userDeviceSessions.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      // Get sessionIds for the requesting user's sessions on this device
      const sessionIds = userDeviceSessions.map(s => s.sessionId);

      // Logout only the requesting user's sessions on this device
      // Use sessionService to properly deactivate each session
      for (const sessionId of sessionIds) {
        await sessionService.deactivateSession(sessionId);
      }

      // Emit socket notification only for the requesting user
      emitSessionUpdate(user._id.toString(), {
        type: 'device_removed',
        deviceId: deviceId,
        sessionIds: sessionIds
      });

      res.json({ 
        success: true,
        message: 'Device removed successfully'
      });
    } catch (error) {
      logger.error('Remove device error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Get security information
   * GET /api/devices/security
   */
  static async getSecurityInfo(req: AuthRequest, res: Response) {
    try {
      const user = req.user;
      if (!user || !user._id) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      res.json({
        recoveryEmail: user.email || null,
      });
    } catch (error) {
      logger.error('Get security info error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

