# OxyHQServices Architecture

This document explains the internal architecture of the OxyHQServices package and how the different components work together.

## 🏗️ Architecture Overview

The package is designed with a layered architecture that provides multiple usage patterns while maintaining a unified core:

```
┌─────────────────────────────────────────────────────────────┐
│                    Usage Layer                              │
├─────────────────────────────────────────────────────────────┤
│  Frontend (React)  │  Backend (Node.js)  │  Mixed Apps     │
│  • useOxy Hook     │  • oxyClient        │  • Both patterns │
│  • OxyProvider     │  • Direct Import    │  • Shared tokens │
├─────────────────────────────────────────────────────────────┤
│                    Service Layer                            │
├─────────────────────────────────────────────────────────────┤
│  OxyServices Class  │  TokenStore Singleton  │  HTTP Client │
│  • API Methods      │  • Shared Tokens       │  • Axios     │
│  • Auth Logic       │  • Cross-Instance      │  • Interceptors │
├─────────────────────────────────────────────────────────────┤
│                    Core Layer                                │
├─────────────────────────────────────────────────────────────┤
│  Models  │  Utils  │  Types  │  Constants  │  Error Classes │
└─────────────────────────────────────────────────────────────┘
```

## 🔧 Core Components

### 1. OxyServices Class

The main service class that provides all API functionality:

```typescript
export class OxyServices {
  protected client: AxiosInstance;
  private tokenStore: TokenStore;

  constructor(config: OxyConfig) {
    this.client = axios.create({ 
      baseURL: config.baseURL,
      timeout: 10000 
    });
    
    this.tokenStore = TokenStore.getInstance();
    this.setupInterceptors();
  }
}
```

**Key Features:**
- **HTTP Client**: Axios instance with interceptors
- **Token Management**: Integration with TokenStore singleton
- **API Methods**: All authentication, user, social, and file operations
- **Error Handling**: Custom error classes and retry logic

### 2. TokenStore Singleton

A singleton class that manages authentication tokens across all instances:

```typescript
class TokenStore {
  private static instance: TokenStore;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  static getInstance(): TokenStore {
    if (!TokenStore.instance) {
      TokenStore.instance = new TokenStore();
    }
    return TokenStore.instance;
  }
}
```

**Key Features:**
- **Singleton Pattern**: Single instance across entire application
- **Token Sharing**: All OxyServices instances share the same tokens
- **Cross-Platform**: Works in React, React Native, and Node.js
- **Automatic Refresh**: Handles token refresh logic

### 3. Pre-configured Client

A ready-to-use instance exported from the package:

```typescript
export const oxyClient = new OxyServices({ baseURL: OXY_CLOUD_URL });
```

**Benefits:**
- **Zero Configuration**: Import and use immediately
- **Production Ready**: Uses default cloud URL
- **TypeScript Support**: Full type safety
- **Shared State**: Uses the same TokenStore as other instances

## 🔄 Usage Patterns

### Pattern 1: React Native Hook (useOxy)

**Purpose**: Full React Native integration with state management and UI features

```typescript
// Setup
<OxyProvider baseURL="https://cloud.oxy.so">
  <YourApp />
</OxyProvider>

// Usage
const { oxyServices, user, isAuthenticated } = useOxy();
```

**What it provides:**
- **Reactive State**: User data, authentication state, loading states
- **UI Integration**: Bottom sheet, loading indicators, error handling
- **Session Management**: Multi-session support with UI
- **Event Callbacks**: Auth state changes, error handling

**Internal Flow:**
1. `OxyProvider` creates an `OxyServices` instance
2. `useOxy` hook provides access to this instance + React Native state
3. State is managed by Zustand store for performance
4. UI components integrate with the context

### Pattern 2: Direct Import (oxyClient)

**Purpose**: Simple API access without React Native dependencies

```typescript
import { oxyClient } from '@oxyhq/services';

const user = await oxyClient.getCurrentUser();
```

**What it provides:**
- **Direct Access**: No React context needed
- **Same Functionality**: All API methods available
- **Shared Tokens**: Uses the same TokenStore as React instances
- **Cross-Platform**: Works in any JavaScript environment

**Internal Flow:**
1. `oxyClient` is a pre-configured `OxyServices` instance
2. Uses the same `TokenStore` singleton as other instances
3. No React Native state management - just API calls
4. Perfect for backend routes and utility functions

## 🔗 How Components Work Together

### Token Sharing

All instances share the same `TokenStore`:

```typescript
// React Native component
const { oxyServices } = useOxy();
await oxyServices.signIn('user', 'pass');

// Backend route
import { oxyClient } from '@oxyhq/services';
const user = await oxyClient.getCurrentUser(); // Uses same tokens!
```

### State Synchronization

React state automatically syncs with the TokenStore:

```typescript
// When tokens change in TokenStore
tokenStore.setTokens(newAccessToken, newRefreshToken);

// React Native state automatically updates
const { isAuthenticated } = useOxy(); // Updates automatically
```

### Error Handling

Unified error handling across all patterns:

```typescript
// Same error classes used everywhere
import { OxyAuthenticationError } from '@oxyhq/services';

try {
  await oxyClient.getCurrentUser();
} catch (error) {
  if (error instanceof OxyAuthenticationError) {
    // Handle auth errors consistently
  }
}
```

## 📁 File Structure

```
packages/services/src/
├── core/
│   ├── OxyServices.ts          # Main service class
│   └── index.ts               # Core exports
├── ui/
│   ├── context/
│   │   └── OxyContext.tsx     # React context and hook
│   ├── components/
│   │   └── OxyProvider.tsx    # Provider component
│   └── index.ts               # UI exports
├── models/
│   └── interfaces.ts          # TypeScript interfaces
├── utils/
│   ├── errorUtils.ts          # Error handling
│   ├── apiUtils.ts            # API utilities
│   └── deviceManager.ts       # Device management
├── node/
│   └── index.ts               # Node.js specific exports
└── index.ts                   # Main exports
```

## 🔄 Data Flow

### Authentication Flow

```
1. User calls login()
   ↓
2. OxyServices.signIn() called
   ↓
3. HTTP request to API
   ↓
4. Response with tokens
   ↓
5. TokenStore.setTokens() called
   ↓
6. React state updates (if using useOxy)
   ↓
7. UI re-renders with new auth state
```

### API Request Flow

```
1. Component calls oxyServices.getCurrentUser()
   ↓
2. Axios interceptor adds Authorization header
   ↓
3. TokenStore.getAccessToken() called
   ↓
4. If token expired, automatic refresh
   ↓
5. HTTP request sent
   ↓
6. Response processed
   ↓
7. Component receives data
```

## 🎯 Design Principles

### 1. **Unified API**
- Single `OxyServices` class provides all functionality
- Consistent method signatures across all patterns
- Shared types and interfaces

### 2. **Flexible Usage**
- Multiple usage patterns for different scenarios
- No forced React dependency for backend usage
- Easy migration between patterns

### 3. **Performance Optimized**
- Singleton TokenStore prevents duplicate instances
- React state management with Zustand for performance
- Automatic token refresh with caching

### 4. **Type Safety**
- Full TypeScript support throughout
- Generated types from API schemas
- IntelliSense support for all methods

### 5. **Error Handling**
- Custom error classes for different scenarios
- Consistent error handling across patterns
- Graceful degradation and retry logic

## 🔧 Configuration Options

### Environment-Based Configuration

```typescript
// Automatic environment detection
const baseURL = process.env.OXY_API_URL || OXY_CLOUD_URL;
const oxyClient = new OxyServices({ baseURL });
```

### Custom Configuration

```typescript
// Full control over configuration
const oxy = new OxyServices({
  baseURL: 'https://custom-api.com',
  timeout: 15000,
  // Additional axios config
});
```

### React Native Provider Configuration

```typescript
<OxyProvider
  baseURL="https://cloud.oxy.so"
  storageKeyPrefix="my_app"
  onAuthStateChange={(user) => {}}
  onError={(error) => {}}
>
  {children}
</OxyProvider>
```

## 🚀 Performance Considerations

### TokenStore Singleton
- Prevents multiple token storage instances
- Reduces memory usage
- Ensures token consistency

### React Native State Optimization
- Zustand store for efficient state updates
- Selective re-rendering based on state changes
- Memoized context values

### HTTP Client Optimization
- Single Axios instance per OxyServices
- Request/response interceptors for common logic
- Automatic retry with exponential backoff

## 🔒 Security Features

### Token Management
- Secure token storage (localStorage/AsyncStorage)
- Automatic token refresh before expiration
- Token validation and cleanup

### Error Handling
- Graceful handling of authentication failures
- Automatic logout on token expiration
- Secure error messages (no sensitive data)

### Cross-Platform Security
- Platform-specific storage implementations
- Secure token transmission
- CSRF protection through headers

This architecture provides a robust, flexible, and performant solution for integrating Oxy API functionality across different platforms and usage patterns. 