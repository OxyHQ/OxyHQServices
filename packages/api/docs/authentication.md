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
  "userId": "user_id",        // Compatibility field for OxyHQServices
  "username": "testuser",
  "iat": 1623456789,          // Issued at timestamp
  "exp": 1623460389           // Expiration timestamp (1 hour)
}
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

```typescript
// Middleware for protecting routes
export const authenticateToken = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET!) as JwtPayload;
    req.userId = decoded.id || decoded.userId;
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
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
