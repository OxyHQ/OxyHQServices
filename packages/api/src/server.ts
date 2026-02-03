import express from "express";
import http from "http";
import mongoose from "mongoose";
import { Server as SocketIOServer, Socket } from "socket.io";
import profilesRouter from "./routes/profiles";
import usersRouter from "./routes/users";
import notificationsRouter from "./routes/notifications.routes";
import sessionRouter from "./routes/session";
import dotenv from "dotenv";
import { User } from "./models/User";
import searchRoutes from "./routes/search";
import { rateLimiter, authRateLimiter, userRateLimiter, bruteForceProtection, securityHeaders } from "./middleware/security";
import privacyRoutes from "./routes/privacy";
import analyticsRoutes from "./routes/analytics.routes";
import paymentRoutes from './routes/payment.routes';
import walletRoutes from './routes/wallet.routes';
import karmaRoutes from './routes/karma.routes';
import linkMetadataRoutes from './routes/linkMetadata';
import locationSearchRoutes from './routes/locationSearch';
import authRoutes from './routes/auth';
import assetRoutes from './routes/assets';
import storageRoutes from './routes/storage';
import developerRoutes from './routes/developer';
import devicesRouter from './routes/devices';
import securityRoutes from './routes/security';
import subscriptionRoutes from './routes/subscription.routes';
import fedcmRoutes from './routes/fedcm';
import authLinkingRoutes from './routes/authLinking';
import fedcmService from './services/fedcm.service';
import emailRoutes from './routes/email';
import { startSmtpInbound, stopSmtpInbound } from './services/smtp.inbound';
import { smtpOutbound } from './services/smtp.outbound';
import { getEnvBoolean } from './config/env';
import jwt from 'jsonwebtoken';
import { logger } from './utils/logger';
import { Response } from 'express';
import { authMiddleware } from './middleware/auth';
import cookieParser from 'cookie-parser';
import { csrfProtection, getCsrfToken } from './middleware/csrf';
import { createCorsMiddleware, SOCKET_IO_CORS_CONFIG } from './config/cors';
import { validateRequiredEnvVars, getSanitizedConfig, getEnvNumber } from './config/env';
import performanceMiddleware, { getMemoryStats, getConnectionPoolStats } from './middleware/performance';
import { performanceMonitor } from './utils/performanceMonitor';
import { waitForMongoConnection } from './utils/dbConnection';
import { errorHandler } from './middleware/errorHandler';

// Load environment variables
dotenv.config();

// Validate configuration early - fail fast with clear errors
try {
  validateRequiredEnvVars();
  logger.info('Environment configuration validated', getSanitizedConfig());
} catch (error) {
  logger.error('Configuration error:', error);
  process.exit(1);
}

const app = express();

// Trust proxy - required when behind a reverse proxy (Cloudflare, nginx, etc.)
// This is needed for express-rate-limit to work correctly with X-Forwarded-For headers
app.set('trust proxy', 1);

// Security headers middleware (first, before any other middleware)
app.use(securityHeaders);

// Cookie parser middleware (before CSRF and body parsing)
app.use(cookieParser());

// Body parsing middleware - IMPORTANT: Add this before any routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Performance monitoring middleware (before routes)
app.use(performanceMiddleware);

// CORS middleware - centralized configuration
app.use(createCorsMiddleware({
  allowAllOriginsInDev: true,
  credentials: true,
}));

// Create server for local development and testing
const server = http.createServer(app);

// Setup Socket.IO with centralized CORS config
const io = new SocketIOServer(server, {
  cors: SOCKET_IO_CORS_CONFIG as any,
});

// Store io instance in app for use in controllers
app.set('io', io);

// Custom socket interface to include user property
interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    [key: string]: any;
  };
}

// Socket.IO rate limiting (applied before auth to protect against unauthenticated floods)
import { createSocketRateLimiter } from './middleware/socketRateLimit';
io.use(createSocketRateLimiter(100, 10_000)); // 100 events per 10s

// Socket.IO authentication middleware
io.use((socket: AuthenticatedSocket, next) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    return next(new Error('Authentication error'));
  }

  try {
    // Verify the token
    if (!process.env.ACCESS_TOKEN_SECRET) {
      throw new Error('ACCESS_TOKEN_SECRET is not configured');
    }
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET) as any;
    // Normalize userId: tokens use 'userId' field, but socket interface expects 'id'
    const userId = decoded.userId || decoded.id;
    if (!userId) {
      return next(new Error('Token missing user ID'));
    }
    socket.user = { id: userId, ...decoded };
    next();
  } catch (error) {
    logger.error('Socket authentication error:', error);
    next(new Error('Authentication error'));
  }
});

// Socket connection handling for authenticated users
io.on('connection', (socket: AuthenticatedSocket) => {
  logger.debug('Socket connected', { socketId: socket.id });

  if (socket.user?.id) {
    const room = `user:${socket.user.id}`;
    socket.join(room);
    logger.debug('User joined notification room', { userId: socket.user.id, room });
  }
  
  socket.on('disconnect', () => {
    logger.debug('Socket disconnected', { socketId: socket.id });
  });

  // For debugging in development only
  if (process.env.NODE_ENV === 'development') {
    socket.onAny((event, ...args) => {
      logger.debug('Socket event received', { socketId: socket.id, event, args });
    });
  }
});

// ============================================
// Auth Session Socket Namespace (Unauthenticated)
// Used for cross-app authentication via QR code
// ============================================
import { initAuthSessionNamespace } from './utils/authSessionSocket';

const authSessionNamespace = io.of('/auth-session');
authSessionNamespace.use(createSocketRateLimiter(20, 10_000)); // Stricter: 20 events per 10s
initAuthSessionNamespace(authSessionNamespace);

// No authentication required for this namespace
authSessionNamespace.on('connection', (socket) => {
  logger.debug('Auth session socket connected', { socketId: socket.id });
  
  // Client joins a room for their session token
  socket.on('join', (sessionToken: string) => {
    if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length < 10) {
      socket.emit('error', { message: 'Invalid session token' });
      return;
    }
    
    const room = `auth:${sessionToken}`;
    socket.join(room);
    logger.debug('Client joined auth session room', { socketId: socket.id, room });
    socket.emit('joined', { room: sessionToken });
  });
  
  socket.on('leave', (sessionToken: string) => {
    const room = `auth:${sessionToken}`;
    socket.leave(room);
    logger.debug('Client left auth session room', { socketId: socket.id, room });
  });
  
  socket.on('disconnect', () => {
    logger.debug('Auth session socket disconnected', { socketId: socket.id });
  });
});

// Helper for emitting session_update
export function emitSessionUpdate(userId: string, payload: any) {
  const room = `user:${userId}`;
  logger.debug('Emitting session_update', { room, payload });
  io.to(room).emit('session_update', payload);
}

// MongoDB Connection with optimized connection pooling for scale
const mongoOptions = {
  autoIndex: true,
  autoCreate: true,
  // Connection pool settings for handling millions of users
  maxPoolSize: 50, // Maximum number of connections in the pool
  minPoolSize: 5, // Minimum number of connections to maintain
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  serverSelectionTimeoutMS: 5000, // How long to try selecting a server before timing out
  socketTimeoutMS: 45000, // How long a send or receive on a socket can take before timing out
  connectTimeoutMS: 10000, // How long to wait for initial connection
  heartbeatFrequencyMS: 10000, // Frequency of server heartbeat checks
  retryWrites: true, // Retry write operations on network errors
  retryReads: true, // Retry read operations on network errors
  // Disable command buffering to fail fast instead of timing out
  bufferCommands: false, // Don't buffer commands if not connected - fail fast
};

mongoose.connect(process.env.MONGODB_URI as string, mongoOptions)
.then(() => {
  logger.info("Connected to MongoDB successfully", {
    maxPoolSize: mongoOptions.maxPoolSize,
    minPoolSize: mongoOptions.minPoolSize,
  });
})
.catch((error) => {
  logger.error("MongoDB connection error:", error);
  process.exit(1);
});

// MongoDB connection event handlers for monitoring
mongoose.connection.on('connected', () => {
  logger.info('MongoDB connection established');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await stopSmtpInbound();
  smtpOutbound.shutdown();
  await mongoose.connection.close();
  logger.info('MongoDB connection closed through app termination');
  process.exit(0);
});

// API Routes
app.get("/", async (req, res) => {
  try {
    const usersCount = await User.countDocuments();
    res.json({
      message: "Welcome to the API",
      users: usersCount,
    });
  } catch (error) {
    logger.error("Error in root endpoint:", error);
    res.status(500).json({ message: "Error fetching stats", error: error instanceof Error ? error.message : String(error) });
  }
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    // Check MongoDB connection
    const isMongoConnected = mongoose.connection.readyState === 1;
    
    if (isMongoConnected) {
      res.status(200).json({
        status: "operational",
        timestamp: new Date().toISOString(),
        database: "connected"
      });
    } else {
      res.status(503).json({
        status: "degraded",
        timestamp: new Date().toISOString(),
        database: "disconnected"
      });
    }
  } catch (error) {
    logger.error("Health check error:", error);
    res.status(503).json({
      status: "down",
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Performance monitoring endpoint (protected, for admin/internal use)
app.get("/api/metrics", authMiddleware, (req: any, res: Response) => {
  try {
    const memoryStats = getMemoryStats();
    const connectionStats = getConnectionPoolStats(mongoose.connection);
    const perfSummary = performanceMonitor.getSummary();
    const slowOperations = performanceMonitor.getSlowOperations(1000);
    
    res.json({
      timestamp: new Date().toISOString(),
      memory: memoryStats,
      database: connectionStats,
      performance: {
        summary: perfSummary,
        slowOperations: slowOperations.map(op => ({
          operation: op.operation,
          avgDuration: op.avgDuration,
          count: op.count,
          maxDuration: op.maxDuration,
        })),
      },
    });
  } catch (error) {
    logger.error("Metrics endpoint error:", error);
    res.status(500).json({
      error: "Failed to retrieve metrics",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Apply rate limiting middleware globally (before routes)
// Note: Auth routes have their own stricter rate limiting
app.use(rateLimiter);
app.use(bruteForceProtection);

// CSRF token endpoint (must be before CSRF protection)
app.get('/api/csrf-token', getCsrfToken);

// API Routes with /api prefix
// Apply stricter rate limiting to auth routes
app.use("/auth", authRateLimiter, authRoutes);
app.use("/api/auth", authRateLimiter, authRoutes);
app.use("/api/auth", userRateLimiter, csrfProtection, authLinkingRoutes); // Auth linking (requires auth)
app.use("/api/assets", assetRoutes);
app.use("/api/storage", userRateLimiter, csrfProtection, storageRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/profiles", csrfProtection, profilesRouter);
app.use("/api/users", userRateLimiter, csrfProtection, usersRouter); // Per-user rate limiting for authenticated routes
app.use("/api/session", userRateLimiter, sessionRouter); // No CSRF on session routes (auth flow)
app.use("/api/privacy", userRateLimiter, csrfProtection, privacyRoutes);
app.use("/api/analytics", userRateLimiter, analyticsRoutes);
app.use('/api/payments', userRateLimiter, csrfProtection, paymentRoutes);
app.use('/api/notifications', userRateLimiter, csrfProtection, notificationsRouter);
app.use('/api/karma', csrfProtection, karmaRoutes);
app.use('/api/wallet', userRateLimiter, csrfProtection, walletRoutes);
app.use('/api/link-metadata', userRateLimiter, linkMetadataRoutes);
app.use('/api/location-search', locationSearchRoutes);
app.use('/api/developer', csrfProtection, developerRoutes);
app.use('/api/devices', userRateLimiter, csrfProtection, devicesRouter);
app.use('/api/security', userRateLimiter, csrfProtection, securityRoutes);
app.use('/api/subscription', userRateLimiter, csrfProtection, subscriptionRoutes);
app.use('/api/fedcm', fedcmRoutes);
app.use('/email', userRateLimiter, csrfProtection, emailRoutes);

// Add a protected route for testing
app.get('/api/protected-server-route', authMiddleware, (req: any, res: Response) => {
  res.json({ 
    message: 'Protected server route accessed successfully',
    user: req.user 
  });
});

// Global error handler — standardised { error, message, details? } format
app.use(errorHandler);

// 404 handler for undefined routes
app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: 'NOT_FOUND', message: 'Resource not found' });
});

// Only call listen if this module is run directly
const PORT = getEnvNumber('PORT', 3001);
if (require.main === module) {
  // Wait for MongoDB connection before starting server
  // This prevents queries from executing before the database is ready
  waitForMongoConnection(30000)
    .then(async () => {
      // Seed FedCM approved clients (idempotent - only inserts if not exists)
      await fedcmService.seedApprovedClients();

      // Start SMTP inbound server if enabled
      if (getEnvBoolean('SMTP_ENABLED', false)) {
        startSmtpInbound();
        logger.info('SMTP inbound server enabled');
      }

      server.listen(PORT, '0.0.0.0', () => {
        logger.info(`Server running on port ${PORT}`, {
          mongodb: 'connected',
        });
      });
    })
    .catch((error) => {
      logger.error('Failed to start server - MongoDB connection failed:', error);
      process.exit(1);
    });
}

export default server;
