# Development Guide

Comprehensive guide for developers working on the OxyHQ API.

## Getting Started

### Prerequisites

- **Node.js**: 18.x or higher
- **npm**: 8.x or higher
- **MongoDB**: 5.x or higher
- **Redis**: 6.x or higher (optional)
- **Git**: Latest version
- **VS Code**: Recommended IDE

### Development Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/oxyhq-services.git
   cd oxyhq-services
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp packages/api/.env.example packages/api/.env
   # Edit .env with your local configuration
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Verify installation**
   ```bash
   curl http://localhost:3001/health
   ```

## Project Structure

```
packages/api/
├── src/
│   ├── config/           # Configuration files
│   │   ├── database.ts   # Database configuration
│   │   ├── redis.ts      # Redis configuration
│   │   └── server.ts     # Server configuration
│   ├── controllers/      # Business logic controllers
│   │   ├── auth.ts       # Authentication controller
│   │   ├── users.ts      # User management
│   │   ├── files.ts      # File handling
│   │   └── ...
│   ├── middleware/       # Express middleware
│   │   ├── auth.ts       # Authentication middleware
│   │   ├── cache.ts      # Caching middleware
│   │   ├── rateLimit.ts  # Rate limiting
│   │   ├── validation.ts # Input validation
│   │   └── ...
│   ├── models/          # MongoDB schemas
│   │   ├── User.ts      # User model
│   │   ├── Session.ts   # Session model
│   │   └── ...
│   ├── routes/          # API route definitions
│   │   ├── auth.ts      # Authentication routes
│   │   ├── users.ts     # User routes
│   │   └── ...
│   ├── services/        # Business services
│   ├── utils/           # Utility functions
│   │   ├── database.ts  # Database utilities
│   │   ├── logger.ts    # Logging utilities
│   │   └── ...
│   ├── types/           # TypeScript type definitions
│   ├── sockets/         # Socket.IO handlers
│   └── server.ts        # Main server file
├── docs/               # Documentation
├── tests/              # Test files
├── package.json        # Package configuration
└── tsconfig.json       # TypeScript configuration
```

## Development Workflow

### 1. Feature Development

1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow coding standards
   - Write tests for new functionality
   - Update documentation

3. **Test your changes**
   ```bash
   npm test
   npm run lint
   npm run build
   ```

4. **Commit your changes**
   ```bash
   git add .
   git commit -m "feat: add your feature description"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   # Create pull request on GitHub
   ```

### 2. Code Review Process

1. **Self-review checklist**
   - [ ] Code follows style guidelines
   - [ ] Tests pass
   - [ ] Documentation updated
   - [ ] No console.log statements
   - [ ] Error handling implemented

2. **Peer review**
   - Request review from team members
   - Address feedback and suggestions
   - Update code as needed

3. **Merge to main**
   - Squash commits if needed
   - Delete feature branch after merge

## Coding Standards

### TypeScript Guidelines

#### Type Definitions

```typescript
// Use interfaces for object shapes
interface User {
  id: string;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  createdAt: Date;
  updatedAt: Date;
}

// Use types for unions and complex types
type UserRole = 'admin' | 'user' | 'moderator';
type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
};

// Use enums for constants
enum ErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR'
}
```

#### Function Definitions

```typescript
// Use async/await for asynchronous operations
export const getUserById = async (id: string): Promise<User | null> => {
  try {
    const user = await User.findById(id).lean();
    return user;
  } catch (error) {
    logger.error('Error fetching user:', error);
    throw new Error('Failed to fetch user');
  }
};

// Use arrow functions for callbacks
const users = await User.find({}).lean();
const usernames = users.map(user => user.username);

// Use destructuring for parameters
export const updateUser = async (
  { id, updates }: { id: string; updates: Partial<User> }
): Promise<User> => {
  const user = await User.findByIdAndUpdate(id, updates, { new: true });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
};
```

### Error Handling

#### Custom Error Classes

```typescript
// Base error class
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}
```

#### Error Handling Middleware

```typescript
// Global error handler
export const errorHandler = (
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      success: false,
      error: {
        code: error.code,
        message: error.message,
        details: (error as any).details
      }
    });
  }

  // Log unexpected errors
  logger.error('Unexpected error:', error);

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal server error' 
    : error.message;

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message
    }
  });
};
```

### Logging Standards

#### Structured Logging

```typescript
import winston from 'winston';

// Logger configuration
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'oxyhq-api' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Usage examples
logger.info('User logged in', {
  userId: user.id,
  email: user.email,
  ip: req.ip
});

logger.error('Database connection failed', {
  error: error.message,
  stack: error.stack,
  timestamp: new Date().toISOString()
});

logger.warn('Rate limit exceeded', {
  ip: req.ip,
  endpoint: req.path,
  userAgent: req.headers['user-agent']
});
```

### API Response Format

#### Standard Response Structure

```typescript
// Success response
interface SuccessResponse<T> {
  success: true;
  data: T;
  message?: string;
}

// Error response
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

// Controller example
export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    
    if (!user) {
      throw new NotFoundError('User');
    }

    const response: SuccessResponse<User> = {
      success: true,
      data: user,
      message: 'Profile retrieved successfully'
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
};
```

## Testing

### Test Structure

```
tests/
├── unit/              # Unit tests
│   ├── controllers/   # Controller tests
│   ├── services/      # Service tests
│   ├── utils/         # Utility tests
│   └── models/        # Model tests
├── integration/       # Integration tests
│   ├── auth/          # Authentication tests
│   ├── users/         # User API tests
│   └── files/         # File upload tests
├── e2e/              # End-to-end tests
└── fixtures/         # Test data
```

### Unit Testing

```typescript
// Example unit test
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { UserService } from '../../src/services/UserService';
import { User } from '../../src/models/User';

// Mock dependencies
jest.mock('../../src/models/User');
jest.mock('../../src/utils/logger');

describe('UserService', () => {
  let userService: UserService;

  beforeEach(() => {
    userService = new UserService();
    jest.clearAllMocks();
  });

  describe('getUserById', () => {
    it('should return user when found', async () => {
      const mockUser = {
        id: '123',
        username: 'testuser',
        email: 'test@example.com'
      };

      (User.findById as jest.Mock).mockResolvedValue(mockUser);

      const result = await userService.getUserById('123');

      expect(result).toEqual(mockUser);
      expect(User.findById).toHaveBeenCalledWith('123');
    });

    it('should return null when user not found', async () => {
      (User.findById as jest.Mock).mockResolvedValue(null);

      const result = await userService.getUserById('123');

      expect(result).toBeNull();
    });

    it('should throw error on database error', async () => {
      const error = new Error('Database error');
      (User.findById as jest.Mock).mockRejectedValue(error);

      await expect(userService.getUserById('123')).rejects.toThrow('Database error');
    });
  });
});
```

### Integration Testing

```typescript
// Example integration test
import request from 'supertest';
import { app } from '../../src/server';
import { connect, disconnect } from '../../src/config/database';
import { createTestUser, generateToken } from '../fixtures/helpers';

describe('User API', () => {
  beforeAll(async () => {
    await connect();
  });

  afterAll(async () => {
    await disconnect();
  });

  beforeEach(async () => {
    // Clean up database
    await User.deleteMany({});
  });

  describe('GET /users/profile', () => {
    it('should return user profile when authenticated', async () => {
      const user = await createTestUser();
      const token = generateToken(user.id);

      const response = await request(app)
        .get('/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.username).toBe(user.username);
      expect(response.body.data.email).toBe(user.email);
    });

    it('should return 401 when not authenticated', async () => {
      const response = await request(app)
        .get('/users/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
```

### Test Helpers

```typescript
// test/fixtures/helpers.ts
import { User } from '../../src/models/User';
import jwt from 'jsonwebtoken';

export const createTestUser = async (overrides = {}) => {
  const defaultUser = {
    username: 'testuser',
    email: 'test@example.com',
    password: 'TestPassword123',
    firstName: 'Test',
    lastName: 'User'
  };

  const userData = { ...defaultUser, ...overrides };
  const user = new User(userData);
  await user.save();
  return user;
};

export const generateToken = (userId: string) => {
  return jwt.sign(
    { userId, type: 'access' },
    process.env.ACCESS_TOKEN_SECRET!,
    { expiresIn: '1h' }
  );
};

export const cleanupDatabase = async () => {
  await User.deleteMany({});
  // Add other models as needed
};
```

## Database Development

### Schema Design

```typescript
// Example schema with proper indexing
import { Schema, model, Document } from 'mongoose';

interface IUser extends Document {
  username: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  bio?: string;
  avatar?: string;
  isOnline: boolean;
  lastSeen: Date;
  followers: Schema.Types.ObjectId[];
  following: Schema.Types.ObjectId[];
  privacySettings: {
    isPrivateAccount: boolean;
    showEmail: boolean;
    showLocation: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  bio: {
    type: String,
    maxlength: 500
  },
  avatar: String,
  isOnline: {
    type: Boolean,
    default: false
  },
  lastSeen: {
    type: Date,
    default: Date.now
  },
  followers: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: Schema.Types.ObjectId,
    ref: 'User'
  }],
  privacySettings: {
    isPrivateAccount: {
      type: Boolean,
      default: false
    },
    showEmail: {
      type: Boolean,
      default: true
    },
    showLocation: {
      type: Boolean,
      default: true
    }
  }
}, {
  timestamps: true
});

// Indexes for performance
userSchema.index({ username: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isOnline: 1, lastSeen: -1 });
userSchema.index({ followers: 1 });
userSchema.index({ following: 1 });
userSchema.index({ 'privacySettings.isPrivateAccount': 1 });

// Text search index
userSchema.index({
  username: 'text',
  firstName: 'text',
  lastName: 'text',
  bio: 'text'
}, {
  weights: {
    username: 10,
    firstName: 8,
    lastName: 8,
    bio: 5
  }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Pre-save middleware
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

export const User = model<IUser>('User', userSchema);
```

### Database Migrations

```typescript
// Example migration
import { connect, disconnect } from '../config/database';
import { User } from '../models/User';

export const addUserIndexes = async () => {
  try {
    await connect();
    
    // Add new indexes
    await User.collection.createIndex(
      { createdAt: -1 },
      { background: true }
    );
    
    await User.collection.createIndex(
      { email: 1, isActive: 1 },
      { background: true }
    );
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    await disconnect();
  }
};

// Run migration
if (require.main === module) {
  addUserIndexes();
}
```

## Performance Optimization

### Query Optimization

```typescript
// Optimized queries
export class UserService {
  // Use lean() for read-only queries
  async getUsers(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;
    
    const [users, total] = await Promise.all([
      User.find({})
        .select('username firstName lastName avatar')
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments({})
    ]);

    return {
      users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  // Use aggregation for complex queries
  async getUserStats(userId: string) {
    const stats = await User.aggregate([
      { $match: { _id: new ObjectId(userId) } },
      {
        $project: {
          followerCount: { $size: '$followers' },
          followingCount: { $size: '$following' },
          accountAge: {
            $floor: {
              $divide: [
                { $subtract: [new Date(), '$createdAt'] },
                1000 * 60 * 60 * 24 // days
              ]
            }
          }
        }
      }
    ]);

    return stats[0];
  }
}
```

### Caching Strategy

```typescript
// Cache service
export class CacheService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL);
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      logger.warn('Cache get failed:', error);
      return null;
    }
  }

  async set(key: string, value: any, ttl: number = 3600): Promise<void> {
    try {
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      logger.warn('Cache set failed:', error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      logger.warn('Cache delete failed:', error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      logger.warn('Cache pattern invalidation failed:', error);
    }
  }
}
```

## Security Best Practices

### Input Validation

```typescript
import { z } from 'zod';

// Validation schemas
export const userSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username must be less than 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores'),
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email too long'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, 'Password must contain uppercase, lowercase, and number'),
  firstName: z.string()
    .min(1, 'First name is required')
    .max(50, 'First name too long'),
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(50, 'Last name too long')
});

// Validation middleware
export const validateRequest = (schema: z.ZodSchema) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.body);
      req.body = validated;
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid input data',
            details: error.errors
          }
        });
      }
      next(error);
    }
  };
};
```

### Rate Limiting

```typescript
import rateLimit from 'express-rate-limit';

// Rate limiting configuration
export const rateLimits = {
  general: rateLimit({
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

  auth: rateLimit({
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
  })
};
```

## Documentation

### API Documentation

```typescript
/**
 * @api {get} /users/profile Get user profile
 * @apiName GetUserProfile
 * @apiGroup Users
 * @apiVersion 1.0.0
 * 
 * @apiHeader {String} Authorization Bearer token
 * 
 * @apiSuccess {Boolean} success Success status
 * @apiSuccess {Object} data User profile data
 * @apiSuccess {String} data.id User ID
 * @apiSuccess {String} data.username Username
 * @apiSuccess {String} data.email Email address
 * @apiSuccess {String} data.firstName First name
 * @apiSuccess {String} data.lastName Last name
 * @apiSuccess {String} data.bio User bio
 * @apiSuccess {String} data.avatar Avatar URL
 * @apiSuccess {Boolean} data.isOnline Online status
 * @apiSuccess {Date} data.lastSeen Last seen timestamp
 * @apiSuccess {Number} data.followers Follower count
 * @apiSuccess {Number} data.following Following count
 * @apiSuccess {Date} data.createdAt Account creation date
 * @apiSuccess {Date} data.updatedAt Last update date
 * 
 * @apiError UNAUTHORIZED No token provided
 * @apiError INVALID_TOKEN Token is invalid or expired
 * @apiError NOT_FOUND User not found
 */
export const getUserProfile = async (req: Request, res: Response) => {
  // Implementation
};
```

### Code Comments

```typescript
/**
 * Creates a new user session and returns authentication tokens
 * 
 * @param userId - The user ID to create session for
 * @param deviceInfo - Information about the device making the request
 * @returns Promise containing access and refresh tokens
 * 
 * @throws {Error} If session creation fails
 * 
 * @example
 * ```typescript
 * const tokens = await createSession(userId, {
 *   browser: 'Chrome',
 *   os: 'Windows',
 *   ip: '192.168.1.1'
 * });
 * ```
 */
export const createSession = async (
  userId: string,
  deviceInfo: DeviceInfo
): Promise<{ accessToken: string; refreshToken: string }> => {
  // Implementation
};
```

## Git Workflow

### Commit Message Format

Use conventional commits format:

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes
- `refactor`: Code refactoring
- `test`: Test changes
- `chore`: Build/tooling changes

Examples:
```
feat(auth): add JWT token refresh endpoint
fix(users): resolve user search pagination issue
docs(api): update authentication guide
refactor(database): optimize user queries
test(integration): add user API tests
```

### Branch Naming

- `feature/feature-name`: New features
- `fix/bug-description`: Bug fixes
- `hotfix/critical-fix`: Critical production fixes
- `docs/documentation-update`: Documentation updates
- `refactor/refactoring-description`: Code refactoring

## Troubleshooting

### Common Development Issues

1. **Port already in use**
   ```bash
   # Find process using port
   lsof -ti:3001
   
   # Kill process
   kill -9 <PID>
   ```

2. **MongoDB connection issues**
   ```bash
   # Check MongoDB status
   sudo systemctl status mongod
   
   # Start MongoDB
   sudo systemctl start mongod
   ```

3. **Redis connection issues**
   ```bash
   # Check Redis status
   redis-cli ping
   
   # Start Redis
   sudo systemctl start redis
   ```

4. **TypeScript compilation errors**
   ```bash
   # Check TypeScript errors
   npx tsc --noEmit
   
   # Fix linting issues
   npm run lint:fix
   ```

### Debug Mode

Enable debug logging:

```bash
# Set debug environment variable
export DEBUG=oxyhq:*

# Or in .env file
DEBUG=oxyhq:*
```

### Performance Profiling

```bash
# Profile Node.js application
node --prof server.js

# Analyze profiling data
node --prof-process isolate-*.log > profile.txt
```

## Resources

### Useful Tools

- **Postman**: API testing
- **MongoDB Compass**: Database GUI
- **Redis Commander**: Redis GUI
- **VS Code Extensions**:
  - ESLint
  - Prettier
  - TypeScript Importer
  - REST Client

### Documentation

- [Express.js Documentation](https://expressjs.com/)
- [Mongoose Documentation](https://mongoosejs.com/)
- [TypeScript Documentation](https://www.typescriptlang.org/)
- [Jest Documentation](https://jestjs.io/)

### Community

- [GitHub Issues](https://github.com/your-org/oxyhq-services/issues)
- [Discussions](https://github.com/your-org/oxyhq-services/discussions)
- [Slack Channel](#)
- [Email Support](#) 