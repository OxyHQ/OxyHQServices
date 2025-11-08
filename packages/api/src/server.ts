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
import { rateLimiter, bruteForceProtection } from "./middleware/security";
import privacyRoutes from "./routes/privacy";
import analyticsRoutes from "./routes/analytics.routes";
import paymentRoutes from './routes/payment.routes';
import walletRoutes from './routes/wallet.routes';
import karmaRoutes from './routes/karma.routes';
import linkMetadataRoutes from './routes/linkMetadata';
import locationSearchRoutes from './routes/locationSearch';
import authRoutes from './routes/auth';
import assetRoutes from './routes/assets';
import developerRoutes from './routes/developer';
import jwt from 'jsonwebtoken';
import { logger } from './utils/logger';
import { Response } from 'express';
import { authMiddleware } from './middleware/auth';
import { createCorsMiddleware, SOCKET_IO_CORS_CONFIG } from './config/cors';
import { validateRequiredEnvVars, getSanitizedConfig, getEnvNumber } from './config/env';

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

// Body parsing middleware - IMPORTANT: Add this before any routes
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// Socket.IO authentication middleware
io.use((socket: AuthenticatedSocket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error('Authentication error'));
  }
  
  try {
    // Verify the token
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET || 'default_secret');
    socket.user = decoded as { id: string, [key: string]: any };
    next();
  } catch (error) {
    logger.error('Socket authentication error:', error);
    next(new Error('Authentication error'));
  }
});

// Socket connection handling
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

// Helper for emitting session_update
export function emitSessionUpdate(userId: string, payload: any) {
  const room = `user:${userId}`;
  logger.debug('Emitting session_update', { room, payload });
  io.to(room).emit('session_update', payload);
}

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI as string, {
  autoIndex: true,
  autoCreate: true,
})
.then(() => {
  logger.info("Connected to MongoDB successfully");
})
.catch((error) => {
  logger.error("MongoDB connection error:", error);
  process.exit(1);
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

// API Routes with /api prefix
app.use("/api/assets", assetRoutes);
app.use("/api/search", searchRoutes);
app.use("/api/profiles", profilesRouter);
app.use("/api/users", usersRouter);
app.use("/api/session", sessionRouter);
app.use("/api/privacy", privacyRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationsRouter);
app.use('/api/karma', karmaRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/link-metadata', linkMetadataRoutes);
app.use('/api/location-search', locationSearchRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/developer', developerRoutes);

// Add a protected route for testing
app.get('/api/protected-server-route', authMiddleware, (req: any, res: Response) => {
  res.json({ 
    message: 'Protected server route accessed successfully',
    user: req.user 
  });
});

// Global error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('Unhandled error:', err);
  const statusCode = err?.status || 500;
  res.status(statusCode).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message
  });
});

// 404 handler for undefined routes
app.use((req: express.Request, res: express.Response) => {
  res.status(404).json({ message: 'Resource not found' });
});

// Only call listen if this module is run directly
const PORT = getEnvNumber('PORT', 3001);
if (require.main === module) {
  server.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

export default server;
