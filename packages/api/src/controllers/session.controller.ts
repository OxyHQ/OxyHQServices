import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { ISession } from '../models/Session';
import Session from '../models/Session'; // Import the default export
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { SessionAuthResponse, ClientSession } from '../types/session';
import { 
  extractDeviceInfo, 
  generateDeviceFingerprint, 
  registerDevice,
  getDeviceActiveSessions,
  logoutAllDeviceSessions,
  DeviceFingerprint 
} from '../utils/deviceUtils';
import { emitSessionUpdate } from '../server';
import Notification from '../models/Notification'; // Added import for Notification

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET!;
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;
const ACCESS_TOKEN_EXPIRES_IN = '1h';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

// Generate device ID
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

export class SessionController {
  
  // Register a new user account
  static async register(req: Request, res: Response) {
    try {
      const { username, email, password } = req.body;

      if (!username || !email || !password) {
        return res.status(400).json({ error: 'Username, email, and password are required' });
      }

      // Check if user already exists
      const existingUser = await User.findOne({
        $or: [{ username }, { email }]
      });

      if (existingUser) {
        return res.status(409).json({
          error: 'User already exists',
          details: {
            username: existingUser.username === username ? 'Username is already taken' : null,
            email: existingUser.email === email ? 'Email is already registered' : null
          }
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create new user
      const user = new User({
        username,
        email,
        password: hashedPassword,
      });

      await user.save();

      // Create welcome notification
      await new Notification({
        recipientId: user._id,
        actorId: user._id,
        type: 'welcome',
        entityId: user._id,
        entityType: 'profile',
        read: false
      }).save();

      return res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          name: user.name,
          privacySettings: user.privacySettings
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
  
  // Sign in that returns only session data
  static async signIn(req: Request, res: Response) {
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
          sessionId, // Store the UUID in the sessionId field
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
          isActive: true,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          accessToken,
          refreshToken
        });
        
        await session.save();
        console.log(`Created new session for user ${user.username} on device ${deviceInfo.deviceId}`);
      }

      // Emit session update for real-time updates
      emitSessionUpdate(user._id.toString(), {
        type: 'session_created',
        sessionId: session.sessionId,
        deviceId: session.deviceId
      });

      // Return session data (no tokens in response for security)
      const response: SessionAuthResponse = {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        user: {
          id: user._id.toString(),
          username: user.username,
          avatar: user.avatar
        }
      };

      res.json(response);
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get user data by session ID
  static async getUserBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find active session using sessionId field and populate user data
      const session = await Session.findOne({
        sessionId: sessionId,
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
      await session.save();

      // Transform user data to include id field for frontend compatibility
      const userData = (session.userId as any).toObject();
      userData.id = (session.userId as any)._id.toString();

      res.json(userData);
    } catch (error) {
      console.error('Get user by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get access token by session ID
  static async getTokenBySession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find active session using sessionId field
      const session = await Session.findOne({
        sessionId: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (!session) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Check if access token is expired
      try {
        const decoded = jwt.verify(session.accessToken, ACCESS_TOKEN_SECRET) as any;
        const currentTime = Math.floor(Date.now() / 1000);
        
        if (decoded.exp && decoded.exp < currentTime) {
          // Token is expired, generate new tokens
          const { accessToken, refreshToken } = generateTokens(session.userId.toString(), session.sessionId);
          
          session.accessToken = accessToken;
          session.refreshToken = refreshToken;
          session.deviceInfo.lastActive = new Date();
          await session.save();
          
          console.log(`Refreshed tokens for session ${sessionId.substring(0, 8)}...`);
        }
      } catch (tokenError) {
        // Token is invalid, generate new tokens
        const { accessToken, refreshToken } = generateTokens(session.userId.toString(), session.sessionId);
        
        session.accessToken = accessToken;
        session.refreshToken = refreshToken;
        session.deviceInfo.lastActive = new Date();
        await session.save();
        
        console.log(`Regenerated tokens for session ${sessionId.substring(0, 8)}...`);
      }

      res.json({
        accessToken: session.accessToken,
        expiresAt: session.expiresAt.toISOString()
      });
    } catch (error) {
      console.error('Get token by session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get all sessions for a user
  static async getUserSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID using sessionId field
      const currentSession = await Session.findOne({
        sessionId: sessionId,
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
      }).sort({ 'deviceInfo.lastActive': -1 });

      // Transform sessions for client
      const clientSessions: ClientSession[] = sessions.map(session => ({
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        deviceName: session.deviceInfo.deviceName,
        isActive: session.isActive,
        userId: session.userId.toString()
      }));

      res.json(clientSessions);
    } catch (error) {
      console.error('Get user sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout from a specific session
  static async logoutSession(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;
      const { targetSessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find and deactivate session using sessionId field
      const session = await Session.findOne({
        sessionId: sessionId,
        isActive: true
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      session.isActive = false;
      await session.save();

      console.log(`Logged out session: ${sessionId}`);
      res.json({ success: true, message: 'Session logged out successfully' });
    } catch (error) {
      console.error('Logout session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions for current user
  static async logoutAllSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get user ID using sessionId field
      const currentSession = await Session.findOne({
        sessionId: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Deactivate all sessions for this user except the current one
      const result = await Session.updateMany(
        { 
          userId: currentSession.userId, 
          isActive: true,
          sessionId: { $ne: sessionId } // Exclude current session
        },
        { isActive: false }
      );

      console.log(`Logged out ${result.modifiedCount} sessions for user ${currentSession.userId}`);
      
      res.json({ 
        success: true, 
        message: `Logged out ${result.modifiedCount} sessions`,
        sessionsLoggedOut: result.modifiedCount
      });
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

      // Find active session using sessionId field and populate user data
      const session = await Session.findOne({
        sessionId: sessionId,
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
        expiresAt: session.expiresAt.toISOString(),
        lastActivity: session.deviceInfo.lastActive.toISOString(),
        user: userData
      });
    } catch (error) {
      console.error('Validate session error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Validate session from header with device fingerprint validation
  static async validateSessionFromHeader(req: Request, res: Response) {
    try {
      const sessionId = req.header('x-session-id');

      if (!sessionId) {
        return res.status(400).json({ 
          error: 'Session ID is required',
          hint: 'Provide sessionId in x-session-id header'
        });
      }

      // Find active session using sessionId field and populate user data
      const session = await Session.findOne({
        sessionId: sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      }).populate('userId', '-password'); // Exclude password field

      if (!session) {
        return res.status(401).json({ 
          error: 'Invalid or expired session',
          sessionId: sessionId.substring(0, 8) + '...'
        });
      }

      // Optional device fingerprint validation
      const deviceFingerprint = req.header('x-device-fingerprint');
      if (deviceFingerprint && session.deviceInfo.fingerprint) {
        const expectedFingerprint = generateDeviceFingerprint(session.deviceInfo.fingerprint);
        if (deviceFingerprint !== expectedFingerprint) {
          console.log(`Device fingerprint mismatch for session ${sessionId.substring(0, 8)}...`);
          // Don't reject the request, just log the mismatch
        }
      }

      // Update last activity
      session.deviceInfo.lastActive = new Date();
      await session.save();

      // Transform user data to include id field for frontend compatibility
      const userData = (session.userId as any).toObject();
      userData.id = (session.userId as any)._id.toString();

      res.json({ 
        valid: true,
        expiresAt: session.expiresAt.toISOString(),
        lastActivity: session.deviceInfo.lastActive.toISOString(),
        user: userData,
        sessionId: session.sessionId
      });
    } catch (error) {
      console.error('Validate session from header error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get device sessions for a specific device
  static async getDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get device ID
      const currentSession = await Session.findOne({
        sessionId: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Get all sessions for this device
      const deviceSessions = await getDeviceActiveSessions(currentSession.deviceId);

      res.json(deviceSessions);
    } catch (error) {
      console.error('Get device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Logout all sessions for a specific device
  static async logoutAllDeviceSessions(req: Request, res: Response) {
    try {
      const { sessionId } = req.params;

      if (!sessionId) {
        return res.status(400).json({ error: 'Session ID is required' });
      }

      // Find current session to get device ID
      const currentSession = await Session.findOne({
        sessionId: sessionId,
        isActive: true
      });

      if (!currentSession) {
        return res.status(401).json({ error: 'Invalid session', code: 'INVALID_SESSION' });
      }

      // Logout all sessions for this device
      const result = await logoutAllDeviceSessions(currentSession.deviceId);

      res.json(result);
    } catch (error) {
      console.error('Logout all device sessions error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Update device name for a session
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

      // Find and update session
      const session = await Session.findOne({
        sessionId: sessionId,
        isActive: true
      });

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      session.deviceInfo.deviceName = deviceName;
      await session.save();

      res.json({ 
        success: true, 
        message: 'Device name updated successfully',
        deviceName: deviceName
      });
    } catch (error) {
      console.error('Update device name error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
} 