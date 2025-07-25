import express, { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User, { IUser } from "../models/User";
import Notification from "../models/Notification";
import { AuthenticationError } from '../utils/authErrors';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';
import { authMiddleware, AuthRequest } from '../middleware/auth';

// Ensure environment variables are loaded
dotenv.config();

const router = express.Router();

// Generate tokens with error handling
const generateTokens = (userId: string, username: string) => {
  try {
    if (!process.env.ACCESS_TOKEN_SECRET || !process.env.REFRESH_TOKEN_SECRET) {
      throw new Error('Token secrets not configured');
    }

    // Ensure consistent ID format
    const id = userId.toString();

    // Include both 'id' and 'userId' for compatibility with different parts of the system
    const tokenPayload = { 
      id, 
      userId: id,  // For OxyHQServices compatibility
      username 
    };

    const accessToken = jwt.sign(
      tokenPayload,
      process.env.ACCESS_TOKEN_SECRET,
      { expiresIn: "1h" }
    );
    
    const refreshToken = jwt.sign(
      tokenPayload,
      process.env.REFRESH_TOKEN_SECRET,
      { expiresIn: "7d" }
    );
    
    return { accessToken, refreshToken };
  } catch (error) {
    logger.error('Token generation error:', error);
    throw new Error('Failed to generate authentication tokens');
  }
};

// Username availability check endpoint
router.get("/check-username/:username", async (req: Request, res: Response) => {
  try {
    const { username } = req.params;

    logger.debug('Username availability check', { username, timestamp: new Date().toISOString() });

    // Basic validation
    if (!username || username.length < 3) {
      return res.status(400).json({
        available: false,
        message: "Username must be at least 3 characters long"
      });
    }

    // Check if username matches allowed pattern
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        available: false,
        message: "Username can only contain letters, numbers, and underscores"
      });
    }

    // Check if username exists (case-insensitive)
    const existingUser = await User.findOne({ 
      username: { $regex: new RegExp(`^${username}$`, 'i') }
    }).select('username email');

    const isAvailable = !existingUser;

    return res.status(200).json({
      available: isAvailable,
      message: existingUser ? "Username is already taken" : "Username is available"
    });

  } catch (error) {
    logger.error('Username check error:', error);
    return res.status(500).json({
      available: false,
      message: "Error checking username availability"
    });
  }
});

// Email availability check endpoint
router.post("/check-email", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    logger.debug('Email availability check', { email, timestamp: new Date().toISOString() });

    // Basic validation
    if (!email || email.length < 5) {
      return res.status(400).json({
        available: false,
        message: "Email must be at least 5 characters long"
      });
    }

    // Check if email matches basic pattern
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        available: false,
        message: "Please enter a valid email address"
      });
    }

    // Check if email exists (case-insensitive)
    const existingUser = await User.findOne({ 
      email: { $regex: new RegExp(`^${email}$`, 'i') }
    }).select('username email');

    const isAvailable = !existingUser;

    return res.status(200).json({
      available: isAvailable,
      message: existingUser ? "Email is already registered" : "Email is available"
    });

  } catch (error) {
    logger.error('Email check error:', error);
    return res.status(500).json({
      available: false,
      message: "Error checking email availability"
    });
  }
});

// User signup API
router.post("/signup", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;
    
    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ 
        message: "Missing required fields",
        details: {
          username: !username ? "Username is required" : null,
          email: !email ? "Email is required" : null,
          password: !password ? "Password is required" : null
        }
      });
    }

    // Check if user already exists
    const existing = await User.findOne({ $or: [{email}, {username}] });
    if (existing) {
      return res.status(400).json({ 
        message: existing.email === email ? "Email already in use" : "Username already taken" 
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create user using model with schema defaults
    const user = new User({
      username,
      email,
      password: hashedPassword,
    });

    const savedUser = await user.save();

    if (!savedUser.email || !savedUser.password) {
      throw new Error("Critical fields missing after save");
    }

    logger.debug('User saved successfully', { userId: savedUser._id });    // Create welcome notification
    await new Notification({
      recipientId: savedUser._id,
      actorId: savedUser._id, // Self-notification for welcome message
      type: 'welcome', // Add 'welcome' to the type enum in Notification model
      entityId: savedUser._id,
      entityType: 'profile',
      read: false
    }).save();

    // Generate initial token
    const token = jwt.sign(
      { id: savedUser._id, username: savedUser.username },
      process.env.ACCESS_TOKEN_SECRET || "default_secret",
      { expiresIn: "24h" }
    );

    // Return success with sanitized user data
    return res.status(200).json({ 
      message: "User signed up successfully",
      token,
      user: {
        id: savedUser._id,
        username: savedUser.username,
        email: savedUser.email,
        createdAt: savedUser.createdAt,
        updatedAt: savedUser.updatedAt
      }
    });
  } catch (error) {
    logger.error('Signup error:', error);
    return res.status(500).json({ 
      message: "Signup error", 
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Enhanced login route with detailed error handling
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    
    // Validate input with detailed errors
    const validationErrors: { [key: string]: string | null } = {
      username: !username ? "Username is required" : null,
      password: !password ? "Password is required" : null
    };

    const hasErrors = Object.values(validationErrors).some(error => error !== null);
    if (hasErrors) {
      return res.status(400).json({ 
        success: false,
        message: "Username and password are required",
        details: validationErrors
      });
    }

    // Find user with password and profile fields
    const user = await User.findOne({ username })
      .select('+password +refreshToken name avatar privacySettings');
      
    if (!user) {
      logger.warn(`Login attempt failed: User not found - ${username}`);
      return res.status(401).json({ 
        success: false,
        message: "Invalid username or password"
      });
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      logger.warn(`Login attempt failed: Invalid password for user - ${username}`);
      return res.status(401).json({ 
        success: false,
        message: "Invalid username or password"
      });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString(), user.username);

    // Store refresh token hash
    try {
      const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
      user.refreshToken = refreshTokenHash;
      await user.save();
    } catch (tokenError) {
      logger.error('Error storing refresh token:', tokenError);
      return res.status(500).json({ 
        success: false,
        message: "Login failed - Unable to complete authentication"
      });
    }
    
    // Return success response
    return res.status(200).json({
      success: true,
      message: "Login successful",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name && typeof user.toObject === 'function' ? user.toObject({ virtuals: true }).name : user.name || {},
        avatar: user.avatar,
        privacySettings: user.privacySettings
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    return res.status(500).json({ 
      success: false,
      message: "An unexpected error occurred during login",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Enhanced refresh token endpoint
router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      logger.warn('Refresh attempt without token');
      throw new AuthenticationError("Refresh token required", 400);
    }

    if (!process.env.REFRESH_TOKEN_SECRET) {
      logger.error('REFRESH_TOKEN_SECRET not configured');
      throw new AuthenticationError("Server configuration error", 500);
    }

    try {
      const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET) as { id: string; username: string };
      const user = await User.findById(decoded.id).select('+refreshToken') as IUser;

      if (!user) {
        logger.warn(`Refresh failed: User not found - ${decoded.id}`);
        throw new AuthenticationError("Invalid session", 401, 'INVALID_SESSION');
      }

      // Verify stored refresh token
      const isValidToken = await bcrypt.compare(refreshToken, user.refreshToken || '');
      if (!isValidToken) {
        logger.warn(`Refresh failed: Invalid token for user ${decoded.id}`);
        throw new AuthenticationError("Invalid refresh token", 401);
      }

      const tokens = generateTokens(user._id.toString(), user.username);
      
      // Update stored refresh token
      const newRefreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
      user.refreshToken = newRefreshTokenHash;
      await user.save();

      logger.info(`Refresh successful for user ${decoded.id}`);
      return res.status(200).json({
        success: true,
        message: "Tokens refreshed successfully",
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken
      });
    } catch (jwtError) {
      if (jwtError instanceof jwt.TokenExpiredError) {
        logger.info('Refresh failed: Token expired');
        throw new AuthenticationError("Refresh token expired", 401);
      }
      if (jwtError instanceof jwt.JsonWebTokenError) {
        logger.warn('Refresh failed: Invalid token');
        throw new AuthenticationError("Invalid refresh token", 401);
      }
      throw jwtError;
    }
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return res.status(error.statusCode || 401).json({ 
        success: false,
        message: error.message 
      });
    }
    logger.error('Unexpected refresh error:', error);
    return res.status(500).json({ 
      success: false,
      message: "Token refresh failed",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Enhanced logout endpoint
router.post("/logout", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token required" });
    }

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET!) as { id: string };
    const user = await User.findById(decoded.id);

    if (user) {
      user.refreshToken = null;
      await user.save();
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

// Enhanced validate session endpoint with better error handling
router.get("/validate", async (req: Request, res: Response) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      logger.warn('Token validation failed: No token provided');
      return res.status(401).json({ 
        valid: false,
        message: "No token provided" 
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as { id: string };
      const user = await User.findById(decoded.id).select('+refreshToken');

      if (!user) {
        logger.warn('Token validation failed: User not found', { userId: decoded.id });
        return res.status(404).json({ 
          valid: false,  
          message: "User not found" 
        });
      }

      if (!user.refreshToken) {
        logger.warn('Token validation failed: Session invalidated', { userId: decoded.id });
        return res.status(401).json({ 
          valid: false, 
          message: "Session invalidated" 
        });
      }

      return res.status(200).json({ valid: true });
      
    } catch (jwtError) {
      logger.error('Token verification failed:', jwtError);
      if (jwtError instanceof jwt.TokenExpiredError) {
        return res.status(401).json({ 
          valid: false, 
          message: "Token has expired" 
        });
      }
      if (jwtError instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({ 
          valid: false, 
          message: "Token signature is invalid" 
        });
      }
      throw jwtError;
    }
  } catch (error) {
    logger.error('Unexpected error during token validation:', error);
    return res.status(500).json({ 
      valid: false, 
      message: "Validation error" 
    });
  }
});

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
        details: {
          username: !username ? "Username is required" : null,
          email: !email ? "Email is required" : null,
          password: !password ? "Password is required" : null
        }
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "User already exists",
        details: {
          username: existingUser.username === username ? "Username is already taken" : null,
          email: existingUser.email === email ? "Email is already registered" : null
        }
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create new user using model with schema defaults
    const user = new User({
      username,
      email,
      password: hashedPassword,
    });

    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user._id.toString(), username);

    // Store refresh token hash
    const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
    user.refreshToken = refreshTokenHash;
    await user.save();

    // Return success response
    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        name: user.name && typeof user.toObject === 'function' ? user.toObject({ virtuals: true }).name : user.name || {},
        privacySettings: user.privacySettings
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred during registration",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// User profile endpoint - returns the current authenticated user's profile
router.get("/me", authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // User is already authenticated by authMiddleware
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
        message: "No user found in request"
      });
    }

    // Return the user profile
    return res.status(200).json({
      success: true,
      data: {
        id: req.user.id || req.user._id,
        username: req.user.username,
        email: req.user.email,
        name: req.user.name && typeof req.user.toObject === 'function' ? req.user.toObject({ virtuals: true }).name : req.user.name || {},
        avatar: req.user.avatar,
        privacySettings: req.user.privacySettings,
        description: req.user.description
      }
    });
  } catch (error) {
    logger.error('Error fetching user profile:', error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      message: "Failed to retrieve user profile"
    });
  }
});

export default router;