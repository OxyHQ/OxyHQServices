# API Reference

Complete API reference for OxyHQServices client library.

## Table of Contents

- [OxyServices Class](#oxyservices-class)
- [Authentication API](#authentication-api)
- [User Management API](#user-management-api)
- [Session Management API](#session-management-api)
- [Events API](#events-api)
- [Middleware API](#middleware-api)
- [Error Handling](#error-handling)

## OxyServices Class

### Constructor

```typescript
new OxyServices(config: OxyConfig)
```

Creates a new OxyServices client instance.

**Parameters:**
- `config` (OxyConfig): Configuration object

**Example:**
```typescript
const oxy = new OxyServices({
  baseURL: 'https://your-api-server.com',
  timeout: 5000,
  autoRefresh: true,
  storage: 'localStorage',
  debug: false
});
```

### Configuration

#### getConfig()

```typescript
getConfig(): OxyConfig
```

Returns the current client configuration.

**Returns:** Current configuration object

**Example:**
```typescript
const config = oxy.getConfig();
console.log('Base URL:', config.baseURL);
```

#### updateConfig()

```typescript
updateConfig(newConfig: Partial<OxyConfig>): void
```

Updates the client configuration.

**Parameters:**
- `newConfig` (Partial<OxyConfig>): New configuration values

**Example:**
```typescript
oxy.updateConfig({
  timeout: 10000,
  debug: true
});
```

## Authentication API

Access via `oxy.auth`

### login()

```typescript
login(credentials: LoginCredentials): Promise<AuthResponse>
```

Authenticates a user with email/username and password.

**Parameters:**
- `credentials` (LoginCredentials): User credentials

**Returns:** Promise<AuthResponse> - Authentication result with tokens and user data

**Example:**
```typescript
const response = await oxy.auth.login({
  email: 'user@example.com',
  password: 'password123',
  rememberMe: true
});

console.log('Access token:', response.accessToken);
console.log('User:', response.user);
```

**Error handling:**
```typescript
try {
  await oxy.auth.login(credentials);
} catch (error) {
  if (error instanceof OxyAuthError) {
    console.error('Authentication failed:', error.message);
  }
}
```

### logout()

```typescript
logout(): Promise<void>
```

Logs out the current user and clears stored tokens.

**Example:**
```typescript
await oxy.auth.logout();
console.log('User logged out');
```

### refresh()

```typescript
refresh(): Promise<AuthResponse>
```

Refreshes the current access token using the stored refresh token.

**Returns:** Promise<AuthResponse> - New tokens and user data

**Example:**
```typescript
try {
  const response = await oxy.auth.refresh();
  console.log('Token refreshed:', response.accessToken);
} catch (error) {
  console.error('Refresh failed:', error);
  // Redirect to login
}
```

### validate()

```typescript
validate(): Promise<boolean>
```

Validates the current access token with the server.

**Returns:** Promise<boolean> - True if token is valid

**Example:**
```typescript
const isValid = await oxy.auth.validate();
if (isValid) {
  console.log('Token is valid');
} else {
  console.log('Token is invalid or expired');
}
```

### validateToken()

```typescript
validateToken(token: string): Promise<TokenValidationResult>
```

Validates a specific token.

**Parameters:**
- `token` (string): JWT token to validate

**Returns:** Promise<TokenValidationResult> - Validation result with user data

**Example:**
```typescript
const result = await oxy.auth.validateToken(token);
if (result.valid) {
  console.log('Token is valid for user:', result.user.username);
} else {
  console.log('Token is invalid:', result.error);
}
```

### Token Management

#### setTokens()

```typescript
setTokens(accessToken: string, refreshToken: string): void
```

Manually sets authentication tokens.

**Parameters:**
- `accessToken` (string): JWT access token
- `refreshToken` (string): JWT refresh token

**Example:**
```typescript
oxy.auth.setTokens(accessToken, refreshToken);
```

#### clearTokens()

```typescript
clearTokens(): void
```

Clears all stored authentication tokens.

**Example:**
```typescript
oxy.auth.clearTokens();
```

#### getAccessToken()

```typescript
getAccessToken(): string | null
```

Gets the current access token.

**Returns:** Current access token or null if not authenticated

**Example:**
```typescript
const token = oxy.auth.getAccessToken();
if (token) {
  console.log('Current token:', token);
}
```

#### hasStoredTokens()

```typescript
hasStoredTokens(): boolean
```

Checks if authentication tokens are stored.

**Returns:** True if tokens are stored

**Example:**
```typescript
if (oxy.auth.hasStoredTokens()) {
  console.log('User has stored credentials');
}
```

#### isAuthenticated()

```typescript
isAuthenticated(): boolean
```

Checks if the user is currently authenticated.

**Returns:** True if user is authenticated

**Example:**
```typescript
if (oxy.auth.isAuthenticated()) {
  console.log('User is authenticated');
}
```

#### getCurrentUserId()

```typescript
getCurrentUserId(): string | null
```

Gets the current user's ID from the stored token.

**Returns:** User ID or null if not authenticated

**Example:**
```typescript
const userId = oxy.auth.getCurrentUserId();
if (userId) {
  console.log('Current user ID:', userId);
}
```

## User Management API

Access via `oxy.users`

### getCurrentUser()

```typescript
getCurrentUser(): Promise<User>
```

Gets the current authenticated user's profile.

**Returns:** Promise<User> - Current user data

**Example:**
```typescript
const user = await oxy.users.getCurrentUser();
console.log('Username:', user.username);
console.log('Email:', user.email);
```

### getUserById()

```typescript
getUserById(id: string): Promise<User>
```

Gets a user's profile by their ID.

**Parameters:**
- `id` (string): User ID

**Returns:** Promise<User> - User data

**Example:**
```typescript
const user = await oxy.users.getUserById('user123');
console.log('User profile:', user);
```

### updateProfile()

```typescript
updateProfile(data: Partial<UserProfile>): Promise<User>
```

Updates the current user's profile.

**Parameters:**
- `data` (Partial<UserProfile>): Profile data to update

**Returns:** Promise<User> - Updated user data

**Example:**
```typescript
const updatedUser = await oxy.users.updateProfile({
  bio: 'New bio text',
  location: 'San Francisco, CA'
});
console.log('Profile updated:', updatedUser);
```

### updatePreferences()

```typescript
updatePreferences(preferences: Partial<UserPreferences>): Promise<User>
```

Updates the current user's preferences.

**Parameters:**
- `preferences` (Partial<UserPreferences>): Preferences to update

**Returns:** Promise<User> - Updated user data

**Example:**
```typescript
const updatedUser = await oxy.users.updatePreferences({
  theme: 'dark',
  notifications: {
    email: true,
    push: false
  }
});
```

### uploadAvatar()

```typescript
uploadAvatar(file: File | Buffer): Promise<{ avatarUrl: string }>
```

Uploads a new avatar image for the current user.

**Parameters:**
- `file` (File | Buffer): Image file to upload

**Returns:** Promise<{ avatarUrl: string }> - New avatar URL

**Example:**
```typescript
// Web
const file = document.getElementById('avatar-input').files[0];
const result = await oxy.users.uploadAvatar(file);
console.log('New avatar URL:', result.avatarUrl);

// React Native
const result = await oxy.users.uploadAvatar({
  uri: 'file://path/to/image.jpg',
  type: 'image/jpeg',
  name: 'avatar.jpg'
});
```

### Social Features

#### followUser()

```typescript
followUser(userId: string): Promise<void>
```

Follow another user.

**Parameters:**
- `userId` (string): User ID to follow

**Example:**
```typescript
await oxy.users.followUser('user123');
console.log('Now following user');
```

#### unfollowUser()

```typescript
unfollowUser(userId: string): Promise<void>
```

Unfollow a user.

**Parameters:**
- `userId` (string): User ID to unfollow

**Example:**
```typescript
await oxy.users.unfollowUser('user123');
console.log('Unfollowed user');
```

#### getFollowers()

```typescript
getFollowers(userId?: string): Promise<User[]>
```

Get a user's followers.

**Parameters:**
- `userId` (string, optional): User ID (defaults to current user)

**Returns:** Promise<User[]> - Array of follower users

**Example:**
```typescript
const followers = await oxy.users.getFollowers();
console.log('My followers:', followers);

const userFollowers = await oxy.users.getFollowers('user123');
console.log('User followers:', userFollowers);
```

#### getFollowing()

```typescript
getFollowing(userId?: string): Promise<User[]>
```

Get users that a user is following.

**Parameters:**
- `userId` (string, optional): User ID (defaults to current user)

**Returns:** Promise<User[]> - Array of users being followed

**Example:**
```typescript
const following = await oxy.users.getFollowing();
console.log('I am following:', following);
```

#### isFollowing()

```typescript
isFollowing(userId: string): Promise<boolean>
```

Check if the current user is following another user.

**Parameters:**
- `userId` (string): User ID to check

**Returns:** Promise<boolean> - True if following

**Example:**
```typescript
const isFollowing = await oxy.users.isFollowing('user123');
if (isFollowing) {
  console.log('You are following this user');
}
```

## Session Management API

Access via `oxy.sessions`

### createSession()

```typescript
createSession(deviceFingerprint: string): Promise<Session>
```

Creates a new session for the current device.

**Parameters:**
- `deviceFingerprint` (string): Unique device identifier

**Returns:** Promise<Session> - New session data

**Example:**
```typescript
const deviceFingerprint = generateDeviceFingerprint();
const session = await oxy.sessions.createSession(deviceFingerprint);
console.log('Session created:', session.id);
```

### getCurrentSession()

```typescript
getCurrentSession(): Promise<Session>
```

Gets the current session information.

**Returns:** Promise<Session> - Current session data

**Example:**
```typescript
const session = await oxy.sessions.getCurrentSession();
console.log('Current session:', session);
console.log('Device:', session.deviceInfo);
console.log('Location:', session.location);
```

### getUserSessions()

```typescript
getUserSessions(userId?: string): Promise<Session[]>
```

Gets all active sessions for a user.

**Parameters:**
- `userId` (string, optional): User ID (defaults to current user)

**Returns:** Promise<Session[]> - Array of active sessions

**Example:**
```typescript
const sessions = await oxy.sessions.getUserSessions();
console.log('Active sessions:', sessions.length);

sessions.forEach(session => {
  console.log(`Session ${session.id}:`);
  console.log(`- Device: ${session.deviceInfo.type}`);
  console.log(`- Location: ${session.location?.city}`);
  console.log(`- Last accessed: ${session.lastAccessedAt}`);
});
```

### validateSession()

```typescript
validateSession(sessionId: string): Promise<{ valid: boolean; session?: Session }>
```

Validates a specific session.

**Parameters:**
- `sessionId` (string): Session ID to validate

**Returns:** Promise<{ valid: boolean; session?: Session }> - Validation result

**Example:**
```typescript
const result = await oxy.sessions.validateSession(sessionId);
if (result.valid) {
  console.log('Session is valid:', result.session);
} else {
  console.log('Session is invalid or expired');
}
```

### logoutSession()

```typescript
logoutSession(sessionId: string): Promise<void>
```

Logs out a specific session.

**Parameters:**
- `sessionId` (string): Session ID to logout

**Example:**
```typescript
await oxy.sessions.logoutSession('session123');
console.log('Session logged out');
```

### logoutAllSessions()

```typescript
logoutAllSessions(): Promise<void>
```

Logs out all sessions for the current user.

**Example:**
```typescript
await oxy.sessions.logoutAllSessions();
console.log('All sessions logged out');
```

### logoutOtherSessions()

```typescript
logoutOtherSessions(): Promise<void>
```

Logs out all sessions except the current one.

**Example:**
```typescript
await oxy.sessions.logoutOtherSessions();
console.log('Other sessions logged out');
```

## Events API

Access via `oxy.events`

The events API uses Node.js EventEmitter pattern for handling authentication and session events.

### on()

```typescript
on<K extends keyof OxyEventMap>(event: K, listener: OxyEventMap[K]): void
```

Registers an event listener.

**Parameters:**
- `event` (string): Event name
- `listener` (function): Event handler function

**Available Events:**
- `authStateChanged`: User authentication state changed
- `tokenRefreshed`: Access token was refreshed
- `refreshFailed`: Token refresh failed
- `userUpdated`: User profile was updated
- `sessionExpired`: User session expired
- `networkError`: Network request failed

**Examples:**

```typescript
// Authentication state changes
oxy.events.on('authStateChanged', (isAuthenticated) => {
  console.log('Auth state changed:', isAuthenticated);
  if (!isAuthenticated) {
    // Redirect to login
  }
});

// Token refresh events
oxy.events.on('tokenRefreshed', (tokens) => {
  console.log('Tokens refreshed successfully');
});

oxy.events.on('refreshFailed', (error) => {
  console.error('Token refresh failed:', error);
  // Redirect to login or show error
});

// User profile updates
oxy.events.on('userUpdated', (user) => {
  console.log('User profile updated:', user.username);
});

// Session events
oxy.events.on('sessionExpired', () => {
  console.log('Session expired, please log in again');
});

// Network errors
oxy.events.on('networkError', (error) => {
  console.error('Network error:', error.message);
  // Show offline indicator or retry logic
});
```

### off()

```typescript
off<K extends keyof OxyEventMap>(event: K, listener: OxyEventMap[K]): void
```

Removes an event listener.

**Parameters:**
- `event` (string): Event name
- `listener` (function): Event handler function to remove

**Example:**
```typescript
const handleAuthChange = (isAuthenticated) => {
  console.log('Auth changed:', isAuthenticated);
};

// Add listener
oxy.events.on('authStateChanged', handleAuthChange);

// Remove listener
oxy.events.off('authStateChanged', handleAuthChange);
```

### once()

```typescript
once<K extends keyof OxyEventMap>(event: K, listener: OxyEventMap[K]): void
```

Registers a one-time event listener.

**Parameters:**
- `event` (string): Event name
- `listener` (function): Event handler function

**Example:**
```typescript
// Listen for the next token refresh only
oxy.events.once('tokenRefreshed', (tokens) => {
  console.log('Token refreshed once:', tokens);
});
```

## Middleware API

For Express.js integration.

### middleware()

```typescript
middleware(options?: MiddlewareOptions): ExpressMiddleware
```

Creates Express.js middleware for authentication.

**Parameters:**
- `options` (MiddlewareOptions, optional): Middleware configuration

**Returns:** Express middleware function

**Example:**
```typescript
const express = require('express');
const app = express();

// Basic usage
app.use('/api/protected', oxy.middleware());

// With custom options
app.use('/api/admin', oxy.middleware({
  onSuccess: (user, req, res, next) => {
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  },
  onError: (error, req, res, next) => {
    console.error('Auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
}));
```

## Error Handling

### Error Types

The library provides specific error classes for different error scenarios:

#### OxyError

Base error class for all OxyHQServices errors.

```typescript
class OxyError extends Error {
  code: string;
  statusCode?: number;
  details?: any;
}
```

#### OxyAuthError

Authentication-specific errors.

```typescript
class OxyAuthError extends OxyError {
  // Thrown for login failures, invalid tokens, etc.
}
```

#### OxyNetworkError

Network and HTTP-related errors.

```typescript
class OxyNetworkError extends OxyError {
  statusCode: number;
  // Thrown for network failures, server errors, etc.
}
```

#### OxyValidationError

Input validation errors.

```typescript
class OxyValidationError extends OxyError {
  field: string;
  // Thrown for invalid input data
}
```

### Error Handling Examples

```typescript
import { 
  OxyError, 
  OxyAuthError, 
  OxyNetworkError, 
  OxyValidationError 
} from '@oxyhq/services';

try {
  await oxy.auth.login(credentials);
} catch (error) {
  if (error instanceof OxyAuthError) {
    console.error('Authentication failed:', error.message);
    // Show login error to user
  } else if (error instanceof OxyNetworkError) {
    console.error('Network error:', error.message, error.statusCode);
    // Show network error to user
  } else if (error instanceof OxyValidationError) {
    console.error('Validation error:', error.message, error.field);
    // Highlight invalid field
  } else if (error instanceof OxyError) {
    console.error('OxyHQ error:', error.code, error.message);
    // Handle other OxyHQ errors
  } else {
    console.error('Unexpected error:', error);
    // Handle unexpected errors
  }
}
```

### Common Error Codes

```typescript
// Authentication errors
'INVALID_CREDENTIALS'    // Wrong username/password
'TOKEN_EXPIRED'          // Access token expired
'TOKEN_INVALID'          // Malformed or invalid token
'REFRESH_FAILED'         // Unable to refresh token

// Authorization errors
'INSUFFICIENT_PERMISSIONS' // User lacks required permissions
'ACCESS_DENIED'           // Access denied for resource

// Network errors
'NETWORK_ERROR'          // General network failure
'TIMEOUT_ERROR'          // Request timeout
'SERVER_ERROR'           // Server-side error (5xx)

// User errors
'USER_NOT_FOUND'         // User doesn't exist
'EMAIL_ALREADY_EXISTS'   // Email already registered
'USERNAME_TAKEN'         // Username not available

// Session errors
'SESSION_EXPIRED'        // Session no longer valid
'SESSION_NOT_FOUND'      // Session doesn't exist
'DEVICE_NOT_TRUSTED'     // Device not recognized
```

## Related Documentation

- [Quick Start Guide](./quick-start.md)
- [TypeScript Types Reference](./typescript-types.md)
- [Express Middleware Guide](./express-middleware.md)
- [UI Components Guide](./ui-components.md)
- [Troubleshooting Guide](./troubleshooting.md)