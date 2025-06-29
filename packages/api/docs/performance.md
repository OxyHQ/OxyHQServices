# Performance Optimization Guide

Comprehensive guide to optimizing performance in the OxyHQ API.

## Overview

The OxyHQ API is designed for high performance with multiple optimization layers:
- **Redis Caching**: Intelligent caching with graceful fallback
- **Database Optimization**: Connection pooling, indexing, and query monitoring
- **Rate Limiting**: Advanced rate limiting strategies
- **Compression**: Gzip compression for all responses
- **CDN Ready**: Optimized for content delivery networks

## Caching Strategy

### Redis Caching

Redis is used for multiple caching layers with graceful fallback when Redis is unavailable.

#### Cache Configuration

```typescript
// Redis configuration
const redisConfig = {
  url: process.env.REDIS_URL,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  maxRetriesPerRequest: 3,
  lazyConnect: true
};

// Cache TTL settings
const CACHE_TTL = {
  USER_PROFILE: 3600,        // 1 hour
  SEARCH_RESULTS: 1800,      // 30 minutes
  API_RESPONSES: 900,        // 15 minutes
  SESSION_DATA: 7200,        // 2 hours
  FILE_METADATA: 3600        // 1 hour
};
```

#### Cache Middleware

```typescript
import { Request, Response, NextFunction } from 'express';
import { redis } from '../config/redis';

interface CacheOptions {
  ttl?: number;
  key?: string;
  condition?: (req: Request) => boolean;
}

export const cacheMiddleware = (options: CacheOptions = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip caching for non-GET requests
    if (req.method !== 'GET') {
      return next();
    }

    // Skip caching if condition is not met
    if (options.condition && !options.condition(req)) {
      return next();
    }

    const cacheKey = options.key || `cache:${req.originalUrl}`;
    const ttl = options.ttl || CACHE_TTL.API_RESPONSES;

    try {
      // Try to get from cache
      const cached = await redis.get(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        return res.json(data);
      }

      // Cache miss - intercept response
      const originalSend = res.json;
      res.json = function(data) {
        // Store in cache
        redis.setex(cacheKey, ttl, JSON.stringify(data))
          .catch(err => logger.warn('Cache set failed:', err));
        
        // Send response
        return originalSend.call(this, data);
      };

      next();
    } catch (error) {
      // Redis error - continue without caching
      logger.warn('Cache middleware error:', error);
      next();
    }
  };
};
```

#### Cache Invalidation

```typescript
// Cache invalidation patterns
export const invalidateCache = {
  // Invalidate user-related cache
  user: async (userId: string) => {
    const patterns = [
      `cache:users:${userId}`,
      `cache:profile:${userId}`,
      `cache:search:*`
    ];
    
    for (const pattern of patterns) {
      try {
        const keys = await redis.keys(pattern);
        if (keys.length > 0) {
          await redis.del(...keys);
        }
      } catch (error) {
        logger.warn('Cache invalidation failed:', error);
      }
    }
  },

  // Invalidate search cache
  search: async () => {
    try {
      const keys = await redis.keys('cache:search:*');
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      logger.warn('Search cache invalidation failed:', error);
    }
  }
};
```

### Application-Level Caching

#### In-Memory Caching

```typescript
import NodeCache from 'node-cache';

// Application cache instance
const appCache = new NodeCache({
  stdTTL: 600, // 10 minutes default
  checkperiod: 120, // Check for expired keys every 2 minutes
  useClones: false
});

// Cache decorator
export const cache = (ttl: number = 600) => {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${propertyName}:${JSON.stringify(args)}`;
      
      // Try to get from cache
      const cached = appCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // Execute method and cache result
      const result = await method.apply(this, args);
      appCache.set(cacheKey, result, ttl);
      
      return result;
    };
  };
};
```

## Database Optimization

### Connection Pooling

```typescript
// MongoDB connection configuration
const dbConfig = {
  maxPoolSize: 10,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  maxIdleTimeMS: 30000,
  retryWrites: true,
  w: 'majority'
};

// Connection monitoring
mongoose.connection.on('connected', () => {
  logger.info('MongoDB connected');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});
```

### Indexing Strategy

#### User Model Indexes

```typescript
// User schema with optimized indexes
const userSchema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  firstName: String,
  lastName: String,
  bio: String,
  location: String,
  isOnline: {
    type: Boolean,
    default: false,
    index: true
  },
  lastSeen: {
    type: Date,
    default: Date.now,
    index: true
  },
  followers: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  following: [{
    type: Schema.Types.ObjectId,
    ref: 'User',
    index: true
  }],
  privacySettings: {
    isPrivateAccount: {
      type: Boolean,
      default: false,
      index: true
    }
  }
}, {
  timestamps: true
});

// Compound indexes for common queries
userSchema.index({ username: 1, email: 1 });
userSchema.index({ 'privacySettings.isPrivateAccount': 1, createdAt: -1 });
userSchema.index({ isOnline: 1, lastSeen: -1 });
userSchema.index({ followers: 1, createdAt: -1 });
userSchema.index({ following: 1, createdAt: -1 });

// Text search index
userSchema.index({
  username: 'text',
  'name.first': 'text',
  'name.last': 'text',
  bio: 'text',
  description: 'text',
  location: 'text'
}, {
  weights: {
    username: 10,
    'name.first': 8,
    'name.last': 8,
    bio: 5,
    description: 3,
    location: 2
  },
  name: 'user_search_index'
});
```

### Query Optimization

#### Query Monitoring

```typescript
// Query performance monitoring
mongoose.set('debug', process.env.NODE_ENV === 'development');

// Slow query detection
const slowQueryThreshold = 100; // 100ms

mongoose.connection.on('query', (query) => {
  const duration = Date.now() - query.startTime;
  
  if (duration > slowQueryThreshold) {
    logger.warn('Slow query detected:', {
      collection: query.collection,
      operation: query.op,
      duration: `${duration}ms`,
      query: query.query
    });
  }
});
```

#### Optimized Queries

```typescript
// Optimized user queries
export class UserService {
  // Get user with minimal fields
  async getUserById(id: string, fields: string[] = ['username', 'firstName', 'lastName', 'avatar']) {
    return User.findById(id)
      .select(fields.join(' '))
      .lean()
      .cache(300); // 5 minutes cache
  }

  // Search users with pagination
  async searchUsers(query: string, page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find(
        { $text: { $search: query } },
        { score: { $meta: 'textScore' } }
      )
        .sort({ score: { $meta: 'textScore' } })
        .skip(skip)
        .limit(limit)
        .select('username firstName lastName avatar location')
        .lean(),
      
      User.countDocuments({ $text: { $search: query } })
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  // Get user followers with efficient pagination
  async getUserFollowers(userId: string, page: number = 1, limit: number = 20) {
    const user = await User.findById(userId)
      .select('followers')
      .populate({
        path: 'followers',
        select: 'username firstName lastName avatar',
        options: {
          skip: (page - 1) * limit,
          limit: limit
        }
      })
      .lean();

    return user?.followers || [];
  }
}
```

## Rate Limiting

### Advanced Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';

// Different rate limits for different endpoint types
export const rateLimits = {
  // General API rate limit
  general: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // 1000 requests per window
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // Authentication rate limit
  auth: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per window
    message: {
      success: false,
      error: {
        code: 'AUTH_RATE_LIMIT_EXCEEDED',
        message: 'Too many authentication attempts'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
  }),

  // File upload rate limit
  fileUpload: rateLimit({
    store: new RedisStore({
      sendCommand: (...args: string[]) => redis.call(...args),
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 uploads per hour
    message: {
      success: false,
      error: {
        code: 'FILE_UPLOAD_RATE_LIMIT_EXCEEDED',
        message: 'Too many file uploads'
      }
    },
    standardHeaders: true,
    legacyHeaders: false,
  })
};
```

### Progressive Rate Limiting

```typescript
// Progressive rate limiting for failed attempts
export const progressiveRateLimit = rateLimit({
  store: new RedisStore({
    sendCommand: (...args: string[]) => redis.call(...args),
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: (req) => {
    const key = `failed_attempts:${req.ip}`;
    const failedAttempts = redis.get(key) || 0;
    
    // Progressive limits
    if (failedAttempts >= 10) return 1;      // 1 request per 15 minutes
    if (failedAttempts >= 5) return 5;       // 5 requests per 15 minutes
    if (failedAttempts >= 3) return 10;      // 10 requests per 15 minutes
    return 100;                              // 100 requests per 15 minutes
  },
  message: {
    success: false,
    error: {
      code: 'PROGRESSIVE_RATE_LIMIT_EXCEEDED',
      message: 'Rate limit exceeded due to previous violations'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});
```

## Compression

### Gzip Compression

```typescript
import compression from 'compression';

// Compression configuration
const compressionOptions = {
  level: 6, // Compression level (0-9)
  threshold: 1024, // Only compress responses larger than 1KB
  filter: (req: Request, res: Response) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Use compression for all responses
    return compression.filter(req, res);
  }
};

app.use(compression(compressionOptions));
```

## Performance Monitoring

### Request/Response Monitoring

```typescript
// Performance monitoring middleware
export const performanceMonitor = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  
  // Monitor response time
  res.on('finish', () => {
    const duration = Date.now() - start;
    const { method, path, statusCode } = req;
    
    // Log slow requests
    if (duration > 1000) {
      logger.warn('Slow request detected:', {
        method,
        path,
        statusCode,
        duration: `${duration}ms`,
        userAgent: req.headers['user-agent']
      });
    }
    
    // Track metrics
    metrics.recordRequest({
      method,
      path,
      statusCode,
      duration,
      timestamp: new Date()
    });
  });
  
  next();
};
```

### Memory Monitoring

```typescript
// Memory usage monitoring
export const memoryMonitor = () => {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    
    logger.info('Memory usage:', {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    });
    
    // Alert if memory usage is high
    if (memUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
      logger.warn('High memory usage detected');
    }
  }, 60000); // Check every minute
};
```

### Database Performance Metrics

```typescript
// Database performance tracking
export const dbPerformanceMonitor = () => {
  let queryCount = 0;
  let slowQueries: any[] = [];
  
  mongoose.connection.on('query', (query) => {
    queryCount++;
    const duration = Date.now() - query.startTime;
    
    if (duration > 100) {
      slowQueries.push({
        collection: query.collection,
        operation: query.op,
        duration,
        query: query.query,
        timestamp: new Date()
      });
      
      // Keep only last 100 slow queries
      if (slowQueries.length > 100) {
        slowQueries = slowQueries.slice(-100);
      }
    }
  });
  
  // Export metrics
  return {
    getQueryCount: () => queryCount,
    getSlowQueries: () => slowQueries,
    resetMetrics: () => {
      queryCount = 0;
      slowQueries = [];
    }
  };
};
```

## CDN Optimization

### Static Asset Optimization

```typescript
// Static file serving with caching headers
app.use('/static', express.static('public', {
  maxAge: '1y', // Cache for 1 year
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Set appropriate cache headers based on file type
    if (path.endsWith('.css') || path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
    } else if (path.endsWith('.jpg') || path.endsWith('.png') || path.endsWith('.gif')) {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
    }
  }
}));
```

### API Response Optimization

```typescript
// Optimize API responses for CDN
export const optimizeForCDN = (req: Request, res: Response, next: NextFunction) => {
  // Set cache headers for GET requests
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes
    res.setHeader('Vary', 'Accept-Encoding');
  }
  
  // Enable CORS for CDN
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  next();
};
```

## Performance Testing

### Load Testing

```typescript
// Load testing utilities
export const loadTest = {
  // Test endpoint performance
  testEndpoint: async (url: string, requests: number = 100) => {
    const results = [];
    const startTime = Date.now();
    
    for (let i = 0; i < requests; i++) {
      const requestStart = Date.now();
      try {
        const response = await fetch(url);
        const duration = Date.now() - requestStart;
        
        results.push({
          status: response.status,
          duration,
          success: response.ok
        });
      } catch (error) {
        results.push({
          status: 0,
          duration: Date.now() - requestStart,
          success: false,
          error: error.message
        });
      }
    }
    
    const totalTime = Date.now() - startTime;
    const successful = results.filter(r => r.success).length;
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    
    return {
      totalRequests: requests,
      successfulRequests: successful,
      failedRequests: requests - successful,
      averageResponseTime: avgDuration,
      totalTime,
      requestsPerSecond: requests / (totalTime / 1000)
    };
  }
};
```

### Benchmarking

```typescript
// Benchmark utilities
export const benchmark = {
  // Benchmark function execution time
  time: async (fn: Function, iterations: number = 1000) => {
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      await fn();
      const end = process.hrtime.bigint();
      times.push(Number(end - start) / 1000000); // Convert to milliseconds
    }
    
    const avg = times.reduce((sum, time) => sum + time, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    
    return {
      iterations,
      average: avg,
      minimum: min,
      maximum: max,
      times
    };
  }
};
```

## Best Practices

### 1. Query Optimization

- Use `lean()` for read-only queries
- Select only needed fields with `.select()`
- Use compound indexes for common query patterns
- Implement pagination for large result sets
- Use aggregation pipelines for complex queries

### 2. Caching Strategy

- Cache frequently accessed data
- Implement cache invalidation on data updates
- Use appropriate TTL values
- Monitor cache hit rates
- Implement graceful fallback when cache is unavailable

### 3. Response Optimization

- Compress responses with gzip
- Set appropriate cache headers
- Minimize response payload size
- Use pagination for large datasets
- Implement partial responses

### 4. Monitoring

- Monitor response times
- Track error rates
- Monitor memory usage
- Log slow queries
- Set up alerts for performance issues

### 5. Rate Limiting

- Implement different limits for different endpoints
- Use progressive rate limiting for failed attempts
- Monitor rate limit violations
- Provide clear error messages

## Performance Checklist

- [ ] Redis caching implemented with graceful fallback
- [ ] Database indexes optimized for common queries
- [ ] Connection pooling configured
- [ ] Rate limiting implemented
- [ ] Compression enabled
- [ ] Performance monitoring in place
- [ ] Cache invalidation strategy implemented
- [ ] CDN headers configured
- [ ] Load testing completed
- [ ] Memory usage optimized
- [ ] Slow query monitoring active
- [ ] Error tracking implemented 