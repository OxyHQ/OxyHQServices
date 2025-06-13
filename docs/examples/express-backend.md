# Express.js Backend Integration

Complete example of integrating OxyHQServices with an Express.js backend.

## Overview

This example shows how to:
- Set up authentication middleware
- Protect routes with JWT validation
- Handle user sessions
- Integrate with frontend applications

## Setup

### Install Dependencies

```bash
npm install express @oxyhq/services cors helmet morgan
npm install -D @types/express @types/cors nodemon typescript
```

### Basic Server Setup

```typescript
// server.ts
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { OxyServices } from '@oxyhq/services';

const app = express();
const PORT = process.env.PORT || 4000;

// Initialize OxyServices client
const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001'
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Create authentication middleware
const authenticateToken = oxy.middleware.authenticate({
  loadUser: true,           // Load full user data
  required: true,           // Fail if no token provided
  onError: (error, req, res, next) => {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// Optional authentication (for routes that work with or without auth)
const optionalAuth = oxy.middleware.authenticate({
  loadUser: true,
  required: false           // Don't fail if no token
});

// Routes
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public route
app.get('/api/public', (req, res) => {
  res.json({ message: 'This is a public endpoint' });
});

// Protected route
app.get('/api/protected', authenticateToken, (req, res) => {
  res.json({
    message: 'Access granted to protected resource',
    user: req.user,
    userId: req.userId
  });
});

// Optional auth route (works for both authenticated and anonymous users)
app.get('/api/optional', optionalAuth, (req, res) => {
  if (req.user) {
    res.json({
      message: 'Hello authenticated user',
      user: req.user
    });
  } else {
    res.json({
      message: 'Hello anonymous user'
    });
  }
});

// User-specific data
app.get('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    // req.user already contains user data due to loadUser: true
    res.json({ profile: req.user });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
app.put('/api/user/profile', authenticateToken, async (req, res) => {
  try {
    // Use the OxyServices client to update user
    const updatedUser = await oxy.users.updateProfile(req.body);
    res.json({ user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Session management
app.get('/api/user/sessions', authenticateToken, async (req, res) => {
  try {
    const sessions = await oxy.sessions.getUserSessions();
    res.json({ sessions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// Logout from specific session
app.delete('/api/user/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    await oxy.sessions.logoutSession(req.params.sessionId);
    res.json({ message: 'Session logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout session' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}`);
});

export default app;
```

## Advanced Authentication Patterns

### Custom Middleware

```typescript
// middleware/auth.ts
import { Request, Response, NextFunction } from 'express';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001'
});

// Custom authentication middleware with role checking
export const requireRole = (roles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const result = await oxy.auth.validateToken(token);
      if (!result.valid) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      // Check user role (assuming user object has roles)
      const userRoles = result.user.roles || [];
      const hasRequiredRole = roles.some(role => userRoles.includes(role));
      
      if (!hasRequiredRole) {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }

      req.user = result.user;
      req.userId = result.user.id;
      next();
    } catch (error) {
      res.status(401).json({ error: 'Authentication failed' });
    }
  };
};

// Usage
app.get('/api/admin', requireRole(['admin']), (req, res) => {
  res.json({ message: 'Admin access granted' });
});
```

### Rate Limiting with User Context

```typescript
import rateLimit from 'express-rate-limit';

// Different rate limits for authenticated vs anonymous users
const createAuthRateLimit = () => {
  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: async (req) => {
      // Higher limits for authenticated users
      return req.userId ? 200 : 50;
    },
    keyGenerator: (req) => {
      // Use user ID for authenticated requests, IP for anonymous
      return req.userId || req.ip;
    },
    message: 'Too many requests'
  });
};

app.use('/api', createAuthRateLimit());
```

### Websocket Authentication

```typescript
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  // Extract token from query string or headers
  const token = new URL(req.url!, `http://${req.headers.host}`).searchParams.get('token');
  
  if (!token) {
    ws.close(1008, 'Authentication required');
    return;
  }

  try {
    const result = await oxy.auth.validateToken(token);
    if (!result.valid) {
      ws.close(1008, 'Invalid token');
      return;
    }

    // Store user info for this connection
    (ws as any).userId = result.user.id;
    (ws as any).user = result.user;

    ws.send(JSON.stringify({
      type: 'authenticated',
      user: result.user
    }));

  } catch (error) {
    ws.close(1008, 'Authentication failed');
  }
});

server.listen(PORT);
```

## Frontend Integration

### React/Next.js Frontend

```typescript
// frontend/lib/api.ts
const API_BASE = 'http://localhost:4000';

export class ApiClient {
  private token: string | null = null;

  setToken(token: string) {
    this.token = token;
  }

  private async request(endpoint: string, options: RequestInit = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  // API methods
  async getProfile() {
    return this.request('/api/user/profile');
  }

  async updateProfile(data: any) {
    return this.request('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async getSessions() {
    return this.request('/api/user/sessions');
  }
}
```

### React Native Integration

```typescript
// mobile/services/api.ts
import { OxyServices } from '@oxyhq/services';

class ApiService {
  private oxy: OxyServices;
  private backendUrl = 'http://localhost:4000';

  constructor() {
    this.oxy = new OxyServices({
      baseURL: 'http://localhost:3001' // Oxy API
    });
  }

  // Authenticate with Oxy API
  async login(username: string, password: string) {
    const result = await this.oxy.auth.login({ username, password });
    return result;
  }

  // Make requests to your backend
  async makeBackendRequest(endpoint: string, options: RequestInit = {}) {
    const token = this.oxy.auth.getAccessToken();
    
    const response = await fetch(`${this.backendUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers
      }
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.statusText}`);
    }

    return response.json();
  }

  async getProtectedData() {
    return this.makeBackendRequest('/api/protected');
  }
}

export const apiService = new ApiService();
```

## Environment Configuration

### .env file

```env
# Server Configuration
PORT=4000
NODE_ENV=development

# Oxy API Configuration
OXY_API_URL=http://localhost:3001

# CORS Configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8081

# Database (if using your own database)
DATABASE_URL=mongodb://localhost:27017/myapp

# Logging
LOG_LEVEL=info
```

### Production Considerations

```typescript
// config/production.ts
export const productionConfig = {
  // Use HTTPS in production
  oxyApiUrl: 'https://your-oxy-api.com',
  
  // Secure CORS settings
  cors: {
    origin: ['https://yourdomain.com'],
    credentials: true
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 100
  },
  
  // Security headers
  helmet: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  }
};
```

## Testing

### Unit Tests

```typescript
// tests/auth.test.ts
import request from 'supertest';
import app from '../server';

describe('Authentication', () => {
  let authToken: string;

  beforeAll(async () => {
    // Setup test user and get token
    const loginResponse = await request(app)
      .post('/api/auth/login')
      .send({ username: 'testuser', password: 'testpass' });
    
    authToken = loginResponse.body.accessToken;
  });

  test('should access protected route with valid token', async () => {
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(response.body.message).toBe('Access granted to protected resource');
  });

  test('should reject access without token', async () => {
    await request(app)
      .get('/api/protected')
      .expect(401);
  });
});
```

This example demonstrates a complete Express.js backend integration with OxyHQServices, including authentication middleware, protected routes, session management, and frontend integration patterns.
