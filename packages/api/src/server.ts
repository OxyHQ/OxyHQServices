import express from "express";
import http from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
import path from 'path';

// Import routes
import profilesRouter from "./routes/profiles";
import usersRouter from "./routes/users";
import authRouter from "./routes/auth";
import notificationsRouter from "./routes/notifications.routes";
import sessionsRouter from "./routes/sessions";
import secureSessionRouter from "./routes/secureSession";
import fileRoutes from "./routes/files";
import searchRoutes from "./routes/search";
import privacyRoutes from "./routes/privacy";
import analyticsRoutes from "./routes/analytics.routes";
import paymentRoutes from './routes/payment.routes';
import walletRoutes from './routes/wallet.routes';
import karmaRoutes from './routes/karma.routes';

// Import utilities and middleware
import { logger, requestLogger } from "./utils/logger";
import { cacheService } from "./utils/cache";
import { connectToDatabase, checkDatabaseHealth } from "./utils/database";
import { 
  rateLimiter, 
  bruteForceProtection, 
  authRateLimiter,
  fileUploadRateLimiter,
  securityHeaders,
  compressionMiddleware,
  corsMiddleware,
  errorHandler,
  notFoundHandler
} from "./middleware/security";
import { authMiddleware, SimpleAuthRequest } from "./middleware/auth";

// Load environment variables
dotenv.config();

// Create Express app
const app = express();

// Create HTTP server
const server = http.createServer(app);

// Setup Socket.IO with improved configuration
const io = new SocketIOServer(server, {
  cors: {
    origin: [
      "https://mention.earth", 
      "https://homiio.com", 
      "https://api.oxy.so", 
      "http://localhost:8081", 
      "http://localhost:8082", 
      "http://localhost:19006", 
      /\.homiio\.com$/, 
      /\.mention\.earth$/, 
      /\.oxy\.so$/
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 1e6, // 1MB
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
  logger.info(`User connected: ${socket.id}`);
  
  if (socket.user?.id) {
    socket.join(`user:${socket.user.id}`);
    logger.info(`User ${socket.user.id} joined their notification room`);
  }
  
  socket.on('disconnect', () => {
    logger.info(`User disconnected: ${socket.id}`);
  });
});

// Apply security and performance middleware
app.use(securityHeaders);
app.use(compressionMiddleware);
app.use(corsMiddleware);
app.use(requestLogger);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files (including favicon)
app.use(express.static(path.join(__dirname, '../public')));

// Chrome DevTools configuration (suppresses 404 warnings)
app.get('/.well-known/appspecific/com.chrome.devtools.json', (req, res) => {
  res.json({
    "name": "OxyHQ API",
    "description": "OxyHQ Backend API",
    "version": "1.0.0",
    "homepage_url": "https://oxy.so",
            "api_url": "http://localhost:3001",
    "endpoints": {
      "health": "https://api.oxy.so/health",
      "docs": "https://api.oxy.so/",
      "auth": "https://api.oxy.so/auth",
      "users": "https://api.oxy.so/users"
    }
  });
});

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    const cacheHealth = await cacheService.exists('health-check');
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: dbHealth,
      cache: cacheHealth,
      environment: process.env.NODE_ENV || 'development'
    };
    
    res.status(200).json(health);
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// API versioning and documentation
app.get("/", async (req, res) => {
  try {
    const dbHealth = await checkDatabaseHealth();
    res.json({
      message: "Welcome to OxyHQ API",
      version: "1.0.0",
      status: "running",
      database: dbHealth.status,
      endpoints: {
        auth: "/auth",
        users: "/users", 
        profiles: "/profiles",
        sessions: "/sessions",
        files: "/files",
        search: "/search",
        notifications: "/notifications",
        payments: "/payments",
        wallet: "/wallet",
        analytics: "/analytics",
        privacy: "/privacy"
      },
      documentation: "/docs"
    });
  } catch (error) {
    logger.error("Error in root endpoint:", error);
    res.status(500).json({ 
      message: "Error fetching API info", 
      error: error instanceof Error ? error.message : String(error) 
    });
  }
});

// Apply rate limiting based on route type
app.use('/auth', authRateLimiter);
app.use('/files/upload', fileUploadRateLimiter);
app.use(rateLimiter);
app.use(bruteForceProtection);

// API Routes with caching where appropriate
app.use("/search", cacheService.cacheMiddleware(300), searchRoutes);
app.use("/profiles", profilesRouter);
app.use("/users", usersRouter);
app.use("/auth", authRouter);
app.use("/sessions", sessionsRouter);
app.use("/secure-session", secureSessionRouter);
app.use("/privacy", privacyRoutes);
app.use("/analytics", analyticsRoutes);
app.use('/payments', paymentRoutes);
app.use('/notifications', notificationsRouter);
app.use('/wallet', walletRoutes);

// File routes with special handling
app.use("/files", (req, res, next) => {
  if (req.path === "/upload" && req.method === "POST") {
    logger.info("File upload request:", {
      method: req.method,
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
      origin: req.headers.origin,
      authorization: !!req.headers.authorization,
    });
  }
  next();
});
app.use("/files", fileRoutes);

// Error handling middleware
app.use(errorHandler);

// 404 handler for undefined routes
app.use(notFoundHandler);

// Initialize database connection
const initializeServer = async () => {
  try {
    // Connect to database
    await connectToDatabase();
    
    // Initialize cache (optional for development)
    try {
      await cacheService.connect();
      if (cacheService.isAvailable()) {
        logger.info('Redis cache connected successfully');
      }
    } catch (error) {
      // Only show warning if Redis was actually configured
      if (process.env.REDIS_URL && process.env.REDIS_URL !== 'redis://localhost:6379') {
        logger.warn('Redis cache not available, continuing without caching');
        logger.warn('To enable caching, ensure REDIS_URL points to a valid Redis instance');
      }
    }
    
    // Set up periodic health checks
    setInterval(async () => {
      try {
        await checkDatabaseHealth();
      } catch (error) {
        logger.error('Periodic health check failed:', error);
      }
    }, 30000); // Every 30 seconds
    
    logger.info('Server initialization completed successfully');
  } catch (error) {
    logger.error('Server initialization failed:', error);
    process.exit(1);
  }
};

// Start server
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  initializeServer().then(() => {
    server.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`📊 Health check available at http://localhost:${PORT}/health`);
      logger.info(`🔗 API documentation at http://localhost:${PORT}/`);
    });
  });
}

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      await cacheService.disconnect();
      logger.info('Cache disconnected');
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force close after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;
