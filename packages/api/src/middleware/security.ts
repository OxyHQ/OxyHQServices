import rateLimit from "express-rate-limit";
import slowDown from "express-slow-down";
import helmet from "helmet";
import compression from "compression";
import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// Enhanced rate limiting middleware
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per window
  message: {
    error: "Too many requests",
    message: "Too many requests from this IP, please try again later.",
    retryAfter: "15 minutes"
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req: Request) => {
    // Skip rate limiting for health checks and static assets
    return req.path.startsWith('/files/upload') || 
           req.path === '/health' || 
           req.path.startsWith('/static/');
  },
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many requests",
      message: "Too many requests from this IP, please try again later.",
      retryAfter: "15 minutes"
    });
  }
});

// Brute force protection middleware
const bruteForceProtection = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 100, // allow 100 requests per 15 minutes, then...
  delayMs: (hits: number) => Math.min(hits * 100, 2000), // add 100ms delay per request above 100, max 2s
  skip: (req: Request) => {
    return req.path.startsWith('/files/upload') || 
           req.path === '/health' || 
           req.path.startsWith('/static/');
  }
});

// Auth-specific rate limiting
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth attempts per window
  message: {
    error: "Too many authentication attempts",
    message: "Too many login attempts, please try again later.",
    retryAfter: "15 minutes"
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => !req.path.includes('/auth/'),
  handler: (req: Request, res: Response) => {
    logger.warn(`Auth rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many authentication attempts",
      message: "Too many login attempts, please try again later.",
      retryAfter: "15 minutes"
    });
  }
});

// File upload rate limiting
const fileUploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // limit each IP to 50 file uploads per hour
  message: {
    error: "Too many file uploads",
    message: "Too many file uploads, please try again later.",
    retryAfter: "1 hour"
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => !req.path.startsWith('/files/upload'),
  handler: (req: Request, res: Response) => {
    logger.warn(`File upload rate limit exceeded for IP: ${req.ip}`);
    res.status(429).json({
      error: "Too many file uploads",
      message: "Too many file uploads, please try again later.",
      retryAfter: "1 hour"
    });
  }
});

// Security headers middleware
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
});

// Compression middleware
const compressionMiddleware = compression({
  filter: (req: Request, res: Response) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6, // Good balance between compression and CPU usage
  threshold: 1024 // Only compress responses larger than 1KB
});

// CORS middleware with better configuration
const corsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const allowedOrigins = [
    "https://mention.earth", 
    "https://homiio.com", 
    "https://api.oxy.so", 
    "https://authenticator.oxy.so", 
    "https://noted.oxy.so", 
    "http://localhost:8081", 
    "http://localhost:8082", 
    "http://localhost:19006"
  ];
  
  const origin = req.headers.origin as string;

  if (process.env.NODE_ENV !== 'production') {
    // In development allow all origins
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  } else if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else if (origin) {
    // If origin is present but not in allowedOrigins, check if it's a subdomain we want to allow
    const isDomainAllowed = allowedOrigins.some(allowed => 
      origin.endsWith('.oxy.so') || origin.endsWith('.homiio.com') || origin.endsWith('.mention.earth')
    );
    if (isDomainAllowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }
  
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Date, X-Api-Version");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.status(204).end();
  }

  next();
};

// Request logging middleware
const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    
    logger.log(logLevel, `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms - ${req.ip}`);
  });
  
  next();
};

// Error handling middleware
const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error:', err);
  
  // Don't leak error details in production
  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : err.message;
  
  res.status(500).json({
    error: 'Internal server error',
    message: errorMessage
  });
};

// 404 handler
const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ 
    error: 'Not found',
    message: 'Resource not found' 
  });
};

export { 
  rateLimiter, 
  bruteForceProtection, 
  authRateLimiter,
  fileUploadRateLimiter,
  securityHeaders,
  compressionMiddleware,
  corsMiddleware,
  requestLogger,
  errorHandler,
  notFoundHandler
};
