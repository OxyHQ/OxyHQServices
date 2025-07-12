import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { ISession } from '../models/Session';
import Session from '../models/Session'; // Import the default export
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { SessionAuthResponse, ClientSession } from '../types/secureSession';
import { 
  extractDeviceInfo, 
  generateDeviceFingerprint, 
  registerDevice,
  getDeviceActiveSessions,
  logoutAllDeviceSessions,
  DeviceFingerprint 
} from '../utils/deviceUtils';
import { emitSessionUpdate } from '../server';

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

// Generate secure device ID
const generateDeviceId = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

// Generate session tokens
const generateTokens = (userId: string, sessionId: string) => {
  // Include both 'id' and 'userId' for compatibility
  // 'id' is expected by auth.ts routes
  // 'userId' is expected by OxyHQServices library
  const accessPayload = { 
    id: userId,
    userId: userId,  // For OxyHQServices compatibility
    sessionId
  };
  
  const refreshPayload = {
    id: userId,
    userId: userId,  // For OxyHQServices compatibility
    sessionId,
    type: 'refresh'
  };
  
  const accessToken = jwt.sign(accessPayload, ACCESS_TOKEN_SECRET, { 
    expiresIn: ACCESS_TOKEN_EXPIRES_IN 
  });
  
  const refreshToken = jwt.sign(
    refreshPayload, 
    REFRESH_TOKEN_SECRET, 
    { expiresIn: REFRESH_TOKEN_EXPIRES_IN }
  );
  
  return { accessToken, refreshToken };
};

export class SecureSessionController {
  
  // Secure login that returns only session data
  static async secureLogin(req: Request, res: Response) {
    try {
      const { username, password, deviceName, deviceFingerprint } = req.body;

      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
      }

      // Find user by username or email
      const user = await User.findOne({
        $or: [{ username }, { email: username }]
      }).select('+password'); // Explicitly select password field since it's set to select: false

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      if (!user.password) {
        console.error('User found but no password field:', user.username);
        return res.status(500).json({ error: 'Server configuration error' });
      }

      if (!password) {
        return res.status(400).json({ error: 'Password is required' });
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Extract device info with potential fingerprint reuse
      let deviceInfo = extractDeviceInfo(req, undefined, deviceName);
      
      // Handle device fingerprinting for device ID reuse
      if (deviceFingerprint) {
        const fingerprint = generateDeviceFingerprint(deviceFingerprint);
        deviceInfo = await registerDevice(deviceInfo, fingerprint);
      }

      // Check for existing active session for this user on this device
      const existingSession = await Session.findOne({
        userId: user._id,
        deviceId: deviceInfo.deviceId,
        isActive: true,
        expiresAt: { $gt: new Date() } // Still valid
      });

      let session: any;

      if (existingSession) {
        // Reuse existing session - update activity and extend expiration
        existingSession.deviceInfo.lastActive = new Date();
        existingSession.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // Extend 7 days
        
        // Update device name if provided
        if (deviceName) {
          existingSession.deviceInfo.deviceName = deviceName;
        }
        
        // Update IP address and user agent
        existingSession.deviceInfo.ipAddress = deviceInfo.ipAddress;
        existingSession.deviceInfo.userAgent = deviceInfo.userAgent;
        
        await existingSession.save();
        session = existingSession;
        
        console.log(`Reusing existing session for user ${user.username} on device ${deviceInfo.deviceId}`);
      } else {
        // Generate session ID for new session
        const sessionId = crypto.randomUUID();
        
        // Generate tokens first
        const { accessToken, refreshToken } = generateTokens(user._id.toString(), sessionId);
        
        // Create new session
        session = new Session({
          userId: user._id,
          deviceId: deviceInfo.deviceId,
          deviceInfo: {
            deviceName: deviceInfo.deviceName,
            deviceType: deviceInfo.deviceType,
            platform: deviceInfo.platform,
            browser: deviceInfo.browser,
            os: deviceInfo.os,
            ipAddress: deviceInfo.ipAddress,
            userAgent: deviceInfo.userAgent,
            location: deviceInfo.location,
            fingerprint: deviceInfo.fingerprint,
            lastActive: new Date()
          },
          accessToken,
          refreshToken,
          isActive: true,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        });

        await session.save();
        
        console.log(`Created new session for user ${user.username} on device ${deviceInfo.deviceId}`);
      }

      // Return only session data and minimal user info
      const response: SessionAuthResponse = {
        sessionId: (session._id as mongoose.Types.ObjectId).toString(),
        deviceId: deviceInfo.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        user: {
          id: user._id.toString(),
          username: user.username,
          avatar: user.avatar
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Secure login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get full user data by session
  static async getUserBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find active session using MongoDB _id
      const session = await Session.findOne({
        _id: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      // Get user data
      const user = await User.findById(session.userId).select('-password');
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update last activity
      session.deviceInfo.lastActive = new Date();
      await session.save();

      // Transform user data to include id field for frontend compatibility
      const userData = user.toObject();
      userData.id = user._id.toString();

      res.json({ user: userData });
    } catch (error) {
      console.error('Get user by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get access token by session (for API calls)
  static async getTokenBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      console.log('[getTokenBySession] Received sessionId:', sessionId);

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find active session using MongoDB _id
      const session = await Session.findOne({
        _id: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      console.log('[getTokenBySession] Found session:', !!session);
      if (session) {
        console.log('[getTokenBySession] Session details:', {
          id: session._id,
          userId: session.userId,
          isActive: session.isActive,
          expiresAt: session.expiresAt
        });
      }

      if (!session) {
        return res.status(401).json({ error: 'Invalid or expired session' });
      }

      // Check if token is still valid
      try {
        jwt.verify(session.accessToken, ACCESS_TOKEN_SECRET);
        
        // Update last activity
        session.deviceInfo.lastActive = new Date();
        await session.save();
        
        return res.json({ 
          accessToken: session.accessToken,
          expiresAt: session.expiresAt 
        });
      } catch (tokenError) {
        // Token expired, generate new one
        try {
          // Generate new token
          const { accessToken } = generateTokens(
            session.userId.toString(), 
            sessionId
          );
          
          // Update session with new token
          session.accessToken = accessToken;
          session.deviceInfo.lastActive = new Date();
          await session.save();
          
          return res.json({ 
            accessToken,
            expiresAt: session.expiresAt 
          });
        } catch (refreshError) {
          // Token expired and cannot be refreshed, invalidate session
          session.isActive = false;
          await session.save();
          
          return res.status(401).json({ error: 'Session expired' });
        }
      }
    } catch (error) {
      console.error('Get token by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get user sessions
  static async getUserSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID using MongoDB _id
      const currentSession = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Get all active sessions for this user
      const sessions = await Session.find({
        userId: currentSession.userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).select('deviceInfo token isActive expiresAt');

      const clientSessions: ClientSession[] = sessions.map((session: ISession) => ({
        sessionId: (session._id as any).toString(),
        deviceId: session.deviceId,
        deviceName: session.deviceInfo?.deviceName || 'Unknown Device',
        isActive: (session._id as any).toString() === sessionId
      }));

      res.json({ sessions: clientSessions });
    } catch (error) {
      console.error('Get user sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout specific session
  static async logoutSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { targetSessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to verify user using MongoDB _id
      const currentSession = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Logout target session (default to current session)
      const targetId = targetSessionId || sessionId;
      await Session.updateOne(
        { _id: targetId, userId: currentSession.userId },
        { isActive: false, loggedOutAt: new Date() }
      );

      // Emit session_update event to user room
      emitSessionUpdate(currentSession.userId.toString(), { type: 'logout', sessionId: targetId });

      res.json({ message: 'Session logged out successfully' });
    } catch (error) {
      console.error('Logout session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions for user
  static async logoutAllSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID using MongoDB _id
      const currentSession = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Logout all sessions for this user
      await Session.updateMany(
        { userId: currentSession.userId, isActive: true },
        { isActive: false, loggedOutAt: new Date() }
      );

      // Emit session_update event to user room
      emitSessionUpdate(currentSession.userId.toString(), { type: 'logout_all' });

      res.json({ message: 'All sessions logged out successfully' });
    } catch (error) {
      console.error('Logout all sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Validate session with user data included - automatically reads from header or URL param
  static async validateSession(req: Request, res: Response) {
    try {
      // Try to get session ID from header first, then fallback to URL parameter
      const sessionId = req.header('x-session-id') || req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          error: 'Session ID is required',
          hint: 'Provide sessionId in URL parameter or x-session-id header'
        });
      }

      // Find active session using MongoDB _id and populate user data
      const session = await Session.findOne({
        _id: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).populate('userId', '-password'); // Exclude password field

      if (!session) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Update last activity
      session.deviceInfo.lastActive = new Date();
      
      // Optional: Log device fingerprint if provided
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint) {
        console.log(`Session ${sessionId.substring(0, 8)}... validated with device fingerprint: ${deviceFingerprint.substring(0, 16)}...`);
      }
      
      await session.save();

      // Transform user data to include id field for frontend compatibility
      const userData = (session.userId as any).toObject();
      userData.id = (session.userId as any)._id.toString();

      res.json({ 
        valid: true,
        expiresAt: session.expiresAt,
        lastActivity: session.deviceInfo.lastActive,
        user: userData,
        source: req.header('x-session-id') ? 'header' : 'parameter' // Debug info
      });
    } catch (error) {
      console.error('Validate session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Validate session using header (convenience method for middleware usage)
  static async validateSessionFromHeader(req: Request, res: Response) {
    try {
      // Try to get session ID from header first, then fallback to param
      const sessionId = req.header('x-session-id') || req.params.sessionId;

      if (!sessionId) {
        return res.status(400).json({ 
          error: 'Session ID is required',
          hint: 'Provide sessionId in URL parameter or x-session-id header'
        });
      }

      // Find active session using MongoDB _id and populate user data
      const session = await Session.findOne({
        _id: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).populate('userId', '-password'); // Exclude password field

      if (!session) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Update last activity and optionally log device fingerprint
      session.deviceInfo.lastActive = new Date();
      
      // Extract device fingerprint if provided for enhanced security logging
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint) {
        console.log(`Session ${sessionId.substring(0, 8)}... validated with device fingerprint: ${deviceFingerprint.substring(0, 16)}...`);
      }
      
      await session.save();

      // Transform user data to include id field for frontend compatibility
      const userData = (session.userId as any).toObject();
      userData.id = (session.userId as any)._id.toString();

      res.json({ 
        valid: true,
        expiresAt: session.expiresAt,
        lastActivity: session.deviceInfo.lastActive,
        user: userData,
        sessionId: sessionId.substring(0, 8) + '...' // Masked session ID for reference
      });
    } catch (error) {
      console.error('Validate session from header error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get all active sessions for a specific device
  static async getDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const deviceIdQuery = req.query.deviceId;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Verify current session
      const currentSession = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Use provided deviceId or current session's deviceId
      const targetDeviceId = (typeof deviceIdQuery === 'string' ? deviceIdQuery : undefined) || currentSession.deviceId;
      
      // Get all sessions for the device
      const deviceSessions = await getDeviceActiveSessions(targetDeviceId);

      res.json({ 
        deviceId: targetDeviceId,
        sessions: deviceSessions 
      });
    } catch (error) {
      console.error('Get device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions on a specific device
  static async logoutAllDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { deviceId, excludeCurrent } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Verify current session
      const currentSession = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Use provided deviceId or current session's deviceId
      const targetDeviceId = deviceId || currentSession.deviceId;
      
      // Logout all device sessions
      const excludeSessionId = excludeCurrent ? sessionId : undefined;
      const loggedOutCount = await logoutAllDeviceSessions(targetDeviceId, excludeSessionId);

      res.json({ 
        message: `Logged out ${loggedOutCount} sessions from device`,
        deviceId: targetDeviceId,
        sessionsTerminated: loggedOutCount
      });
    } catch (error) {
      console.error('Logout device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Update device name
  static async updateDeviceName(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { deviceName } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      if (!deviceName) {
        return res.status(400).json({ error: 'Device name is required' });
      }

      // Find current session
      const session = await Session.findOne({
        _id: sessionId,
        isActive: true
      });

      if (!session) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Update device name for all sessions on this device
      await Session.updateMany(
        { deviceId: session.deviceId },
        { 
          $set: { 
            'deviceInfo.deviceName': deviceName 
          }
        }
      );

      res.json({ 
        message: 'Device name updated successfully',
        deviceName 
      });
    } catch (error) {
      console.error('Update device name error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
