# Authentication System

Complete guide to the JWT-based authentication system in the Oxy API.

## Overview

The Oxy API uses JSON Web Tokens (JWT) for stateless authentication with the following features:

- **Access tokens** for API requests (short-lived, 15 minutes)
- **Refresh tokens** for obtaining new access tokens (long-lived, 7 days)
- **Device-based sessions** for isolating authentication per device
- **Automatic token refresh** to maintain seamless user experience

## Token Flow

```
1. User Login
   ├── Validate credentials
   ├── Generate access token (15 min)
   ├── Generate refresh token (7 days)
   └── Return both tokens

2. API Requests
   ├── Include access token in Authorization header
   ├── Server validates token
   └── Grant/deny access

3. Token Refresh
   ├── Access token expires
   ├── Client sends refresh token
   ├── Server validates refresh token
   └── Return new access token

4. Logout
   ├── Invalidate refresh token
   └── Clear client-side tokens
```

## JWT Token Structure

### Access Token Payload

```json
{
  "id": "user_id",
  "userId": "user_id",        // Compatibility field
  "username": "testuser",
  "email": "test@example.com",
  "type": "access",
  "iat": 1623456789,
  "exp": 1623457689
}
```

### Refresh Token Payload

```json
{
  "id": "user_id",
  "userId": "user_id",        // Compatibility field
  "type": "refresh",
  "iat": 1623456789,
  "exp": 1624061589
}
```

## Implementation Details

### Token Generation

```typescript
// src/controllers/secureSession.controller.ts
const generateTokens = (user: User) => {
  const payload = {
    id: user._id.toString(),
    userId: user._id.toString(),  // Compatibility
    username: user.username,
    email: user.email
  };

  const accessToken = jwt.sign(
    { ...payload, type: 'access' },
    process.env.ACCESS_TOKEN_SECRET!,
    { expiresIn: '15m' }
  );

  const refreshToken = jwt.sign(
    { ...payload, type: 'refresh' },
    process.env.REFRESH_TOKEN_SECRET!,
    { expiresIn: '7d' }
  );

  return { accessToken, refreshToken };
};
```

### Token Validation

The API provides a flexible way to handle token validation via an authentication middleware factory.

**New Auth Factory (`authFactory.ts`)**

A new middleware factory `createAuth` has been introduced in `src/middleware/authFactory.ts`. This allows for a more streamlined and configurable way to protect routes.

```typescript
// src/middleware/authFactory.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { IUser } from '../models/User';
import { logger } from '../utils/logger';

export interface AuthFactoryOptions {
  tokenSecret: string;
  userModel?: any;
}

export interface AuthenticatedRequest extends Request {
  user?: IUser | any;
}

export function createAuthMiddleware(options: AuthFactoryOptions) {
  const UserEntity = options.userModel || User;
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // ... (implementation details: checks Bearer token, verifies, fetches user)
    // On success, attaches user to req.user
    // On failure, sends appropriate 401 or 500 response.
  };
}

export function createAuth(options: AuthFactoryOptions) {
  if (!options.tokenSecret) {
    throw new Error('[AuthFactory] Token secret must be provided.');
  }
  return {
    middleware: () => createAuthMiddleware(options),
  };
}
```

**Usage in `server.ts`:**

The `server.ts` file initializes this auth factory and applies the middleware to relevant routes.

```typescript
// In server.ts
import { createAuth } from './middleware/authFactory';

// ...
dotenv.config();

const tokenSecret = process.env.ACCESS_TOKEN_SECRET;
if (!tokenSecret) {
  console.error("ACCESS_TOKEN_SECRET is not defined...");
  process.exit(1);
}
const auth = createAuth({ tokenSecret });

// ...

// Apply to routes that require authentication
app.use("/sessions", auth.middleware(), sessionsRouter);
app.use("/secure-session", auth.middleware(), secureSessionRouter);
// ... and other routes like /analytics, /payments, etc.
```

This new factory standardizes how authentication is applied across different parts of the API. Routes that require simple token-based authentication can use `auth.middleware()`. More complex authentication scenarios (like public sign-up/login routes in `authRouter.ts` or routes with optional authentication) might still use specific internal middleware or checks.

**Previously Used Middleware (`auth.ts`)**

The existing `authMiddleware` in `src/middleware/auth.ts` (and similar patterns in specific route files) is still in use for some routes, particularly those with more granular control requirements or those not yet migrated to the new factory. The goal is to gradually consolidate authentication logic using the new `authFactory` where appropriate.

```typescript
// Example of previously used middleware (still active in some parts)
// src/middleware/auth.ts
export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // ... (older implementation)
};
```

## Session Management

### Device-Based Sessions

Each login creates a unique session associated with a device fingerprint:

```typescript
interface SessionData {
  sessionId: string;
  userId: string;
  deviceFingerprint: string;
  deviceInfo: {
    userAgent: string;
    platform: string;
    lastActive: Date;
  };
  accessToken: string;
  refreshToken: string;
  createdAt: Date;
  expiresAt: Date;
}
```

### Session Storage

Sessions are stored in MongoDB with automatic cleanup:

```javascript
// MongoDB collection: sessions
{
  _id: ObjectId,
  sessionId: String,
  userId: ObjectId,
  deviceFingerprint: String,
  deviceInfo: {
    userAgent: String,
    platform: String,
    lastActive: Date
  },
  refreshToken: String,
  createdAt: Date,
  expiresAt: Date,  // TTL index for automatic cleanup
  isActive: Boolean
}
```

## Security Considerations

### Token Security

1. **Short-lived access tokens** (15 minutes) limit exposure window
2. **Secure refresh tokens** stored separately with longer expiry
3. **Different secrets** for access and refresh tokens
4. **Token type validation** prevents token misuse

### Environment Variables

```env
# Strong, random secrets (minimum 32 characters)
ACCESS_TOKEN_SECRET=64_character_random_string_here
REFRESH_TOKEN_SECRET=different_64_character_random_string_here

# MongoDB connection with authentication
MONGODB_URI=mongodb://username:password@host:port/database
```

### Best Practices

1. **Never log tokens** in server logs
2. **Use HTTPS** in production
3. **Validate token type** in middleware
4. **Implement rate limiting** on auth endpoints
5. **Monitor failed auth attempts**

## Client Integration

### Storing Tokens

**Frontend (Browser):**
```javascript
// Store in memory or sessionStorage (more secure)
sessionStorage.setItem('access_token', accessToken);
sessionStorage.setItem('refresh_token', refreshToken);

// Avoid localStorage for sensitive tokens
```

**React Native:**
```javascript
import AsyncStorage from '@react-native-async-storage/async-storage';

// Secure storage for mobile apps
await AsyncStorage.setItem('access_token', accessToken);
await AsyncStorage.setItem('refresh_token', refreshToken);
```

### Making Authenticated Requests

```javascript
const makeAuthenticatedRequest = async (url, options = {}) => {
  const token = getStoredAccessToken();
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (response.status === 401) {
    // Token expired, try refresh
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      // Retry with new token
      return makeAuthenticatedRequest(url, options);
    } else {
      // Refresh failed, redirect to login
      redirectToLogin();
    }
  }

  return response;
};
```

### Automatic Token Refresh

```javascript
const refreshAccessToken = async () => {
  const refreshToken = getStoredRefreshToken();
  
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });

    if (response.ok) {
      const { accessToken } = await response.json();
      storeAccessToken(accessToken);
      return true;
    }
  } catch (error) {
    console.error('Token refresh failed:', error);
  }

  return false;
};
```

## Multi-User Support

### Session Isolation

Each user can have multiple active sessions across different devices:

```javascript
// User can be logged in on:
// - Web browser (session_1)
// - Mobile app (session_2)  
// - Another device (session_3)

// Each session has independent tokens and can be logged out individually
```

### Session Management API

```javascript
// Get all user sessions
GET /api/secure-session/sessions

// Logout specific session
DELETE /api/secure-session/logout/:sessionId

// Logout all other sessions
DELETE /api/secure-session/logout-all
```

## Error Handling

### Common Auth Errors

| Error | Status | Description | Action |
|-------|--------|-------------|---------|
| `TOKEN_MISSING` | 401 | No token provided | Redirect to login |
| `TOKEN_INVALID` | 401 | Malformed token | Clear tokens, redirect to login |
| `TOKEN_EXPIRED` | 401 | Access token expired | Try refresh token |
| `REFRESH_EXPIRED` | 401 | Refresh token expired | Redirect to login |
| `USER_NOT_FOUND` | 401 | User doesn't exist | Clear tokens, redirect to login |

### Error Response Format

```json
{
  "success": false,
  "error": "Token expired",
  "code": "TOKEN_EXPIRED"
}
```

## Testing Authentication

### Unit Tests

```javascript
describe('Authentication', () => {
  test('should generate valid JWT tokens', () => {
    const tokens = generateTokens(mockUser);
    
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();
    
    const decoded = jwt.verify(tokens.accessToken, ACCESS_TOKEN_SECRET);
    expect(decoded.id).toBe(mockUser._id);
  });

  test('should validate access tokens', () => {
    const token = generateAccessToken(mockUser);
    const decoded = validateAccessToken(token);
    
    expect(decoded.id).toBe(mockUser._id);
    expect(decoded.type).toBe('access');
  });
});
```

### Integration Tests

```javascript
describe('Auth API', () => {
  test('should login and return tokens', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ username: 'test', password: 'password' });

    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
  });

  test('should protect routes with middleware', async () => {
    const response = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${validToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user).toBeTruthy();
  });
});
```

This authentication system provides a secure, scalable foundation for building authenticated applications with proper token management and session isolation.
