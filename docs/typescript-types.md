# TypeScript Types Reference

This document provides a comprehensive reference for all TypeScript types and interfaces used in OxyHQServices.

## Table of Contents

- [Core Types](#core-types)
- [Authentication Types](#authentication-types)
- [User Types](#user-types)
- [Session Types](#session-types)
- [UI Component Types](#ui-component-types)
- [Configuration Types](#configuration-types)
- [Error Types](#error-types)
- [Utility Types](#utility-types)

## Core Types

### OxyServices

Main client class interface:

```typescript
interface OxyServices {
  auth: AuthService;
  users: UserService;
  sessions: SessionService;
  events: EventEmitter;
  
  getConfig(): OxyConfig;
  updateConfig(config: Partial<OxyConfig>): void;
  middleware(options?: MiddlewareOptions): ExpressMiddleware;
}
```

### OxyConfig

Client configuration options:

```typescript
interface OxyConfig {
  baseURL: string;
  timeout?: number;
  autoRefresh?: boolean;
  storage?: StorageType;
  retryAttempts?: number;
  debug?: boolean;
  customHeaders?: Record<string, string>;
}

type StorageType = 'localStorage' | 'sessionStorage' | 'memory' | 'asyncStorage';
```

## Authentication Types

### AuthService

Authentication service interface:

```typescript
interface AuthService {
  login(credentials: LoginCredentials): Promise<AuthResponse>;
  logout(): Promise<void>;
  refresh(): Promise<AuthResponse>;
  validate(): Promise<boolean>;
  validateToken(token: string): Promise<TokenValidationResult>;
  
  setTokens(accessToken: string, refreshToken: string): void;
  clearTokens(): void;
  getAccessToken(): string | null;
  hasStoredTokens(): boolean;
  isAuthenticated(): boolean;
  getCurrentUserId(): string | null;
}
```

### LoginCredentials

Login request payload:

```typescript
interface LoginCredentials {
  email?: string;
  username?: string;
  password: string;
  deviceFingerprint?: string;
  rememberMe?: boolean;
}
```

### AuthResponse

Authentication response:

```typescript
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: User;
  session?: Session;
}
```

### TokenValidationResult

Token validation response:

```typescript
interface TokenValidationResult {
  valid: boolean;
  user?: User;
  session?: Session;
  error?: string;
}
```

### JWTPayload

JWT token payload structure:

```typescript
interface JWTPayload {
  sub: string; // User ID
  username: string;
  email: string;
  iat: number; // Issued at
  exp: number; // Expires at
  sessionId?: string;
  deviceId?: string;
  roles?: string[];
}
```

## User Types

### User

User entity interface:

```typescript
interface User {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  bio?: string;
  location?: string;
  website?: string;
  verified: boolean;
  role: UserRole;
  permissions: Permission[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  isActive: boolean;
  preferences: UserPreferences;
  profile: UserProfile;
}
```

### UserRole

User role enumeration:

```typescript
enum UserRole {
  USER = 'user',
  MODERATOR = 'moderator',
  ADMIN = 'admin',
  SUPER_ADMIN = 'super_admin'
}
```

### Permission

Permission interface:

```typescript
interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}
```

### UserPreferences

User preferences:

```typescript
interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  notifications: NotificationPreferences;
  privacy: PrivacySettings;
}

interface NotificationPreferences {
  email: boolean;
  push: boolean;
  sms: boolean;
  marketing: boolean;
}

interface PrivacySettings {
  profileVisibility: 'public' | 'private' | 'friends';
  showEmail: boolean;
  showLastSeen: boolean;
  allowDirectMessages: boolean;
}
```

### UserProfile

Extended user profile:

```typescript
interface UserProfile {
  displayName?: string;
  headline?: string;
  summary?: string;
  skills: string[];
  interests: string[];
  socialLinks: SocialLink[];
  achievements: Achievement[];
  badges: Badge[];
}

interface SocialLink {
  platform: string;
  url: string;
  verified: boolean;
}

interface Achievement {
  id: string;
  title: string;
  description: string;
  unlockedAt: string;
  category: string;
}

interface Badge {
  id: string;
  name: string;
  icon: string;
  color: string;
  earnedAt: string;
}
```

### UserService

User service interface:

```typescript
interface UserService {
  getCurrentUser(): Promise<User>;
  getUserById(id: string): Promise<User>;
  updateProfile(data: Partial<UserProfile>): Promise<User>;
  updatePreferences(preferences: Partial<UserPreferences>): Promise<User>;
  uploadAvatar(file: File | Buffer): Promise<{ avatarUrl: string }>;
  deleteAccount(): Promise<void>;
  
  // Social features
  followUser(userId: string): Promise<void>;
  unfollowUser(userId: string): Promise<void>;
  getFollowers(userId?: string): Promise<User[]>;
  getFollowing(userId?: string): Promise<User[]>;
  isFollowing(userId: string): Promise<boolean>;
}
```

## Session Types

### Session

Session entity:

```typescript
interface Session {
  id: string;
  userId: string;
  deviceId: string;
  deviceFingerprint: string;
  deviceInfo: DeviceInfo;
  ipAddress: string;
  userAgent: string;
  location?: GeoLocation;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
}
```

### DeviceInfo

Device information:

```typescript
interface DeviceInfo {
  type: 'mobile' | 'desktop' | 'tablet' | 'unknown';
  os: string;
  browser: string;
  model?: string;
  vendor?: string;
}
```

### GeoLocation

Geographic location:

```typescript
interface GeoLocation {
  country: string;
  region: string;
  city: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
}
```

### SessionService

Session service interface:

```typescript
interface SessionService {
  createSession(deviceFingerprint: string): Promise<Session>;
  getCurrentSession(): Promise<Session>;
  getUserSessions(userId?: string): Promise<Session[]>;
  validateSession(sessionId: string): Promise<{ valid: boolean; session?: Session }>;
  logoutSession(sessionId: string): Promise<void>;
  logoutAllSessions(): Promise<void>;
  logoutOtherSessions(): Promise<void>;
}
```

## UI Component Types

### OxyProvider Props

Main provider component props:

```typescript
interface OxyProviderProps {
  client: OxyServices;
  children: React.ReactNode;
  theme?: Theme | 'light' | 'dark' | 'auto';
  customFonts?: boolean;
  debugMode?: boolean;
  onAuthStateChange?: (isAuthenticated: boolean) => void;
}
```

### Theme

Theme configuration:

```typescript
interface Theme {
  colors: ColorScheme;
  fonts: FontScheme;
  spacing: SpacingScheme;
  borderRadius: BorderRadiusScheme;
  shadows: ShadowScheme;
}

interface ColorScheme {
  primary: string;
  primaryDark: string;
  secondary: string;
  background: string;
  surface: string;
  card: string;
  text: string;
  textSecondary: string;
  border: string;
  error: string;
  warning: string;
  success: string;
  info: string;
}

interface FontScheme {
  regular: string;
  medium: string;
  bold: string;
  sizes: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    xxl: number;
  };
}

interface SpacingScheme {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}
```

### Avatar Props

Avatar component props:

```typescript
interface AvatarProps {
  user: User | { username: string; avatarUrl?: string; email?: string };
  size?: number;
  onPress?: () => void;
  style?: ViewStyle;
  fallbackIcon?: React.ReactNode;
  showBadge?: boolean;
  badgeColor?: string;
}
```

### FollowButton Props

Follow button component props:

```typescript
interface FollowButtonProps {
  userId: string;
  onFollowChange?: (isFollowing: boolean) => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  size?: 'small' | 'medium' | 'large';
  variant?: 'filled' | 'outlined' | 'text';
}
```

### Auth Hooks

Authentication hook returns:

```typescript
interface UseOxyAuthReturn {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  error: Error | null;
  
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearError: () => void;
}

interface UseOxyUserReturn {
  currentUser: User | null;
  loading: boolean;
  error: Error | null;
  
  updateProfile: (data: Partial<UserProfile>) => Promise<void>;
  updatePreferences: (preferences: Partial<UserPreferences>) => Promise<void>;
  uploadAvatar: (file: File | Buffer) => Promise<void>;
  refetch: () => Promise<void>;
}
```

## Configuration Types

### MiddlewareOptions

Express middleware configuration:

```typescript
interface MiddlewareOptions {
  tokenExtractor?: (req: Request) => string | undefined;
  onError?: (error: Error, req: Request, res: Response, next: NextFunction) => void;
  onSuccess?: (user: User, req: Request, res: Response, next: NextFunction) => void;
  skip?: (req: Request) => boolean;
  cache?: {
    enabled: boolean;
    ttl: number; // Time to live in seconds
  };
  validateSession?: boolean;
  loadUser?: (userId: string) => Promise<User>;
}
```

### RequestConfig

HTTP request configuration:

```typescript
interface RequestConfig {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: any;
  timeout?: number;
  retries?: number;
}
```

## Error Types

### Base Error Classes

```typescript
class OxyError extends Error {
  code: string;
  statusCode?: number;
  details?: any;
  
  constructor(message: string, code: string, statusCode?: number, details?: any);
}

class OxyAuthError extends OxyError {
  constructor(message: string, details?: any);
}

class OxyNetworkError extends OxyError {
  constructor(message: string, statusCode: number, details?: any);
}

class OxyValidationError extends OxyError {
  constructor(message: string, field: string, details?: any);
}
```

### Error Codes

```typescript
enum ErrorCode {
  // Authentication errors
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  REFRESH_FAILED = 'REFRESH_FAILED',
  
  // Authorization errors
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  ACCESS_DENIED = 'ACCESS_DENIED',
  
  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
  
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  MISSING_FIELD = 'MISSING_FIELD',
  INVALID_FORMAT = 'INVALID_FORMAT',
  
  // User errors
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  EMAIL_ALREADY_EXISTS = 'EMAIL_ALREADY_EXISTS',
  USERNAME_TAKEN = 'USERNAME_TAKEN',
  
  // Session errors
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  DEVICE_NOT_TRUSTED = 'DEVICE_NOT_TRUSTED'
}
```

## Utility Types

### API Response Types

```typescript
interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

interface PaginatedResponse<T = any> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

### Event Types

```typescript
interface OxyEventMap {
  'authStateChanged': (isAuthenticated: boolean) => void;
  'tokenRefreshed': (tokens: { accessToken: string; refreshToken: string }) => void;
  'refreshFailed': (error: Error) => void;
  'userUpdated': (user: User) => void;
  'sessionExpired': () => void;
  'networkError': (error: Error) => void;
}

type OxyEventListener<K extends keyof OxyEventMap> = OxyEventMap[K];
```

### Type Guards

```typescript
function isOxyError(error: any): error is OxyError {
  return error instanceof OxyError;
}

function isOxyAuthError(error: any): error is OxyAuthError {
  return error instanceof OxyAuthError;
}

function isUser(obj: any): obj is User {
  return obj && typeof obj.id === 'string' && typeof obj.username === 'string';
}

function isSession(obj: any): obj is Session {
  return obj && typeof obj.id === 'string' && typeof obj.userId === 'string';
}
```

### Generic Types

```typescript
type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

type WithTimestamps<T> = T & {
  createdAt: string;
  updatedAt: string;
};

type WithId<T> = T & {
  id: string;
};
```

## Type Declaration Files

For projects using OxyHQServices, you can extend the Express Request interface:

```typescript
// types/express.d.ts
declare namespace Express {
  interface Request {
    user?: {
      userId: string;
      username: string;
      email: string;
      role: import('@oxyhq/services').UserRole;
      permissions: import('@oxyhq/services').Permission[];
    };
    session?: import('@oxyhq/services').Session;
  }
}
```

## Usage Examples

### Type-safe API calls

```typescript
import { OxyServices, User, LoginCredentials } from '@oxyhq/services';

async function authenticateUser(credentials: LoginCredentials): Promise<User> {
  const oxy = new OxyServices({ baseURL: 'https://api.example.com' });
  
  try {
    const response = await oxy.auth.login(credentials);
    return response.user;
  } catch (error) {
    if (error instanceof OxyAuthError) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
    throw error;
  }
}
```

### Type-safe React components

```typescript
import React from 'react';
import { User, Avatar } from '@oxyhq/services/ui';

interface UserCardProps {
  user: User;
  onFollow?: (userId: string) => void;
}

const UserCard: React.FC<UserCardProps> = ({ user, onFollow }) => {
  return (
    <div>
      <Avatar user={user} size={60} />
      <h3>{user.username}</h3>
      <p>{user.bio}</p>
      {onFollow && (
        <button onClick={() => onFollow(user.id)}>
          Follow
        </button>
      )}
    </div>
  );
};
```

## Related Documentation

- [Core API Reference](./core-api.md)
- [UI Components Guide](./ui-components.md)
- [Express Middleware Guide](./express-middleware.md)
- [Quick Start Guide](./quick-start.md)