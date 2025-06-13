# Express Middleware Guide

This guide covers using OxyHQServices middleware in Express.js applications for server-side authentication.

## Table of Contents

- [Overview](#overview)
- [Installation](#installation)
- [Basic Usage](#basic-usage)
- [Middleware Configuration](#middleware-configuration)
- [Advanced Usage](#advanced-usage)
- [Error Handling](#error-handling)
- [Examples](#examples)
- [Best Practices](#best-practices)

## Overview

The OxyHQServices Express middleware provides server-side authentication and authorization for your Express.js applications. It automatically validates JWT tokens, manages user sessions, and provides user context to your route handlers.

### Features

- 🔐 **Automatic Token Validation**: Validates JWT tokens from requests
- 👤 **User Context**: Adds authenticated user to request object
- 🔄 **Token Refresh**: Handles automatic token refresh
- 🛡️ **Session Management**: Manages user sessions and device fingerprinting
- ⚡ **Performance**: Optimized for high-traffic applications
- 🔧 **Configurable**: Flexible configuration options

## Installation

```bash
npm install @oxyhq/services express
```

For TypeScript support:
```bash
npm install --save-dev @types/express
```

## Basic Usage

### Simple Authentication Middleware

```javascript
const express = require('express');
const { OxyServices } = require('@oxyhq/services');

const app = express();
const oxy = new OxyServices({
  baseURL: 'https://your-oxy-api-server.com'
});

// Apply middleware to protected routes
app.use('/api/protected', oxy.middleware());

// Protected route - user will be available in req.user
app.get('/api/protected/profile', (req, res) => {
  res.json({
    message: 'This is a protected route',
    user: req.user
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### TypeScript Usage

```typescript
import express, { Request, Response } from 'express';
import { OxyServices } from '@oxyhq/services';

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    username: string;
    email: string;
    // Add other user properties as needed
  };
}

const app = express();
const oxy = new OxyServices({
  baseURL: 'https://your-oxy-api-server.com'
});

app.use('/api/protected', oxy.middleware());

app.get('/api/protected/profile', (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  res.json({
    message: 'Welcome to your profile',
    user: req.user
  });
});
```

## Middleware Configuration

### Configuration Options

```javascript
const middleware = oxy.middleware({
  // Token extraction
  tokenExtractor: (req) => {
    // Custom token extraction logic
    return req.headers.authorization?.replace('Bearer ', '');
  },
  
  // Error handling
  onError: (error, req, res, next) => {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  },
  
  // Success callback
  onSuccess: (user, req, res, next) => {
    console.log('User authenticated:', user.username);
    next();
  },
  
  // Skip authentication for certain conditions
  skip: (req) => {
    return req.path === '/api/health';
  },
  
  // Cache settings
  cache: {
    enabled: true,
    ttl: 300 // 5 minutes
  }
});

app.use('/api/protected', middleware);
```

### Token Extraction Strategies

#### From Authorization Header (Default)
```javascript
// Authorization: Bearer <token>
const middleware = oxy.middleware(); // Uses default extractor
```

#### From Cookie
```javascript
const middleware = oxy.middleware({
  tokenExtractor: (req) => {
    return req.cookies.auth_token;
  }
});
```

#### From Query Parameter
```javascript
const middleware = oxy.middleware({
  tokenExtractor: (req) => {
    return req.query.token;
  }
});
```

#### Multiple Sources
```javascript
const middleware = oxy.middleware({
  tokenExtractor: (req) => {
    // Try header first, then cookie, then query
    return req.headers.authorization?.replace('Bearer ', '') ||
           req.cookies.auth_token ||
           req.query.token;
  }
});
```

## Advanced Usage

### Conditional Authentication

```javascript
// Different middleware for different routes
app.use('/api/public', (req, res, next) => {
  // No authentication required
  next();
});

app.use('/api/protected', oxy.middleware());

app.use('/api/admin', oxy.middleware({
  // Additional authorization check
  onSuccess: (user, req, res, next) => {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }
}));
```

### Role-Based Access Control

```javascript
function requireRole(role) {
  return oxy.middleware({
    onSuccess: (user, req, res, next) => {
      if (!user.roles.includes(role)) {
        return res.status(403).json({ 
          error: `${role} role required` 
        });
      }
      next();
    }
  });
}

// Usage
app.use('/api/admin', requireRole('admin'));
app.use('/api/moderator', requireRole('moderator'));
```

### Session Validation

```javascript
const middleware = oxy.middleware({
  validateSession: true,
  onSuccess: async (user, req, res, next) => {
    // Check if user session is still valid
    try {
      const session = await oxy.sessions.validateSession(user.sessionId);
      if (!session.valid) {
        return res.status(401).json({ error: 'Session expired' });
      }
      req.session = session;
      next();
    } catch (error) {
      return res.status(401).json({ error: 'Session validation failed' });
    }
  }
});
```

### Custom User Loading

```javascript
const middleware = oxy.middleware({
  loadUser: async (userId) => {
    // Load additional user data from your database
    const user = await UserModel.findById(userId);
    return {
      ...user,
      permissions: await getUserPermissions(userId)
    };
  }
});
```

## Error Handling

### Default Error Handling

By default, authentication failures return a 401 status:

```javascript
// Default behavior
app.use('/api/protected', oxy.middleware());

// Request without valid token returns:
// Status: 401
// Body: { error: 'Unauthorized' }
```

### Custom Error Handling

```javascript
const middleware = oxy.middleware({
  onError: (error, req, res, next) => {
    console.error('Authentication error:', error);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }
    
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token',
        code: 'INVALID_TOKEN'
      });
    }
    
    // Generic error
    res.status(401).json({
      error: 'Authentication failed',
      code: 'AUTH_FAILED'
    });
  }
});
```

### Error Types

Common error types you might encounter:

- `TokenExpiredError`: JWT token has expired
- `JsonWebTokenError`: Invalid JWT token
- `NotBeforeError`: JWT not active yet
- `NetworkError`: Unable to reach Oxy API server
- `AuthenticationError`: Invalid credentials

## Examples

### Complete Express App with Authentication

```javascript
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { OxyServices } = require('@oxyhq/services');

const app = express();
const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());

// Public routes
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await oxy.auth.login({ email, password });
    
    // Set HTTP-only cookie
    res.cookie('auth_token', result.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    });
    
    res.json({ success: true, user: result.user });
  } catch (error) {
    res.status(401).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true });
});

// Protected routes
app.use('/api/protected', oxy.middleware({
  tokenExtractor: (req) => req.cookies.auth_token,
  onError: (error, req, res, next) => {
    res.status(401).json({ error: 'Authentication required' });
  }
}));

app.get('/api/protected/profile', (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/protected/data', async (req, res) => {
  try {
    // Use req.user.userId to fetch user-specific data
    const data = await getUserData(req.user.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// Admin routes
app.use('/api/admin', oxy.middleware({
  tokenExtractor: (req) => req.cookies.auth_token,
  onSuccess: (user, req, res, next) => {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  }
}));

app.get('/api/admin/users', async (req, res) => {
  // Admin-only endpoint
  const users = await getAllUsers();
  res.json(users);
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### File Upload with Authentication

```javascript
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

app.post('/api/protected/upload', 
  oxy.middleware(), 
  upload.single('file'), 
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    // Associate file with authenticated user
    const fileRecord = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      userId: req.user.userId,
      uploadDate: new Date()
    };
    
    // Save to database
    saveFileRecord(fileRecord);
    
    res.json({ 
      success: true, 
      file: fileRecord 
    });
  }
);
```

### WebSocket Authentication

```javascript
const { Server } = require('socket.io');
const http = require('http');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    credentials: true
  }
});

// Authenticate socket connections
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const user = await oxy.auth.validateToken(token);
    
    if (user.valid) {
      socket.userId = user.userId;
      socket.user = user;
      next();
    } else {
      next(new Error('Authentication failed'));
    }
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.user.username} connected`);
  
  // Join user to their personal room
  socket.join(`user:${socket.userId}`);
  
  socket.on('disconnect', () => {
    console.log(`User ${socket.user.username} disconnected`);
  });
});
```

## Best Practices

### 1. Environment Configuration

```javascript
// Use environment variables
const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL,
  timeout: parseInt(process.env.OXY_TIMEOUT) || 5000,
  debug: process.env.NODE_ENV === 'development'
});
```

### 2. Error Logging

```javascript
const middleware = oxy.middleware({
  onError: (error, req, res, next) => {
    // Log authentication failures for security monitoring
    console.error('Auth failure:', {
      error: error.message,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      timestamp: new Date().toISOString()
    });
    
    res.status(401).json({ error: 'Authentication failed' });
  }
});
```

### 3. Rate Limiting

```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: 'Too many authentication attempts',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth', authLimiter);
```

### 4. Security Headers

```javascript
const helmet = require('helmet');

app.use(helmet());
app.use((req, res, next) => {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '1; mode=block');
  next();
});
```

### 5. HTTPS in Production

```javascript
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

## Troubleshooting

### Common Issues

1. **401 Unauthorized**: Check token format and expiration
2. **Token not found**: Verify token extraction logic
3. **CORS errors**: Configure CORS properly for your frontend
4. **Performance issues**: Enable caching and optimize token validation

### Debugging

Enable debug mode for detailed logging:

```javascript
const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL,
  debug: true
});
```

For more help, see the [Troubleshooting Guide](./troubleshooting.md).

## Related Documentation

- [Core API Reference](./core-api.md)
- [Quick Start Guide](./quick-start.md)
- [Examples](./examples/)
- [Installation Guide](./installation.md)