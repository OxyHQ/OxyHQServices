# Zero-Config Authentication Guide

OxyHQ Services provides **zero-configuration authentication** that works seamlessly across React, React Native, and Node.js applications. Just wrap your app with `AuthProvider` and use the `useAuth` hook - no manual token management, interceptors, or middleware setup required.

## 🚀 Quick Start

### Frontend (React/React Native)

```tsx
import React from 'react';
import { AuthProvider, useAuth } from '@oxyhq/services';

// 1. Wrap your app with AuthProvider
function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <MainApp />
    </AuthProvider>
  );
}

// 2. Use authentication in any component
function MainApp() {
  const { 
    isAuthenticated, 
    isLoading, 
    user, 
    login, 
    logout, 
    error 
  } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!isAuthenticated) {
    return (
      <LoginForm 
        onLogin={(username, password) => login(username, password)}
        error={error}
      />
    );
  }

  return (
    <div>
      <h1>Welcome, {user?.username}!</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Backend (Express.js)

```typescript
import express from 'express';
import { authenticateRequest, OxyRequest } from '@oxyhq/api/middleware/zero-config-auth';

const app = express();

// Zero-config authentication - just add the middleware
app.get('/profile', authenticateRequest(), (req: OxyRequest, res) => {
  // req.user is automatically populated!
  res.json({
    message: `Hello ${req.user!.username}!`,
    user: req.user
  });
});

// Optional authentication (works for both authenticated and anonymous users)
app.get('/posts', authenticateRequest({ required: false }), (req: OxyRequest, res) => {
  if (req.user) {
    res.json({ posts: getPersonalizedPosts(req.user.id) });
  } else {
    res.json({ posts: getPublicPosts() });
  }
});
```

## ✨ Features

- **🔄 Automatic Token Management**: Tokens are automatically stored, refreshed, and attached to requests
- **🛡️ Built-in Security**: XSS/CSRF protection, secure token storage, automatic retry on auth failures  
- **📱 Cross-Platform**: Works identically on React Native (iOS/Android/Web) and React web
- **⚡ Zero Configuration**: No interceptors, no manual middleware, no token handling required
- **🔥 Hot Reloading Safe**: Authentication state persists across development reloads
- **🚨 Smart Error Handling**: Automatic error recovery with user-friendly messages
- **⚙️ Highly Customizable**: Override any behavior while keeping zero-config defaults

## 📖 Complete API Reference

### Frontend Components & Hooks

#### `AuthProvider`

The main provider component that manages all authentication state.

```tsx
interface AuthProviderProps {
  children: ReactNode;
  baseURL?: string; // Default: 'https://api.oxy.so'
}

<AuthProvider baseURL="https://your-api.com">
  <App />
</AuthProvider>
```

#### `useAuth()`

Primary hook for accessing authentication state and methods.

```tsx
const {
  // State
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  error: string | null;
  
  // Actions
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getCurrentUser: () => Promise<User>;
  
  // Validation
  checkUsernameAvailability: (username: string) => Promise<{ available: boolean; message: string }>;
  checkEmailAvailability: (email: string) => Promise<{ available: boolean; message: string }>;
  
  // Utilities
  clearError: () => void;
} = useAuth();
```

#### `useOxyClient()`

Get an authenticated HTTP client for making API calls.

```tsx
const client = useOxyClient();

// All requests automatically include auth headers
const response = await client.get('/api/data');
const result = await client.post('/api/action', { data });
```

#### `useAuthStatus()`

Lightweight hook that only provides authentication status (minimal re-renders).

```tsx
const { isAuthenticated, isLoading } = useAuthStatus();
```

#### `useCurrentUser()`

Hook specifically for accessing current user data.

```tsx
const { user, isLoading, refetch } = useCurrentUser();
```

#### `withAuth()` HOC

Higher-Order Component for protecting routes/components.

```tsx
// Require authentication
const ProtectedComponent = withAuth(MyComponent, {
  redirectTo: () => navigate('/login'),
  LoadingComponent: () => <div>Authenticating...</div>
});

// Only show to non-authenticated users (e.g., login page)
const LoginPage = withAuth(LoginComponent, {
  requireAuth: false
});
```

### Backend Middleware

#### `authenticateRequest(config?)`

Main authentication middleware with zero configuration required.

```typescript
interface AuthConfig {
  required?: boolean;        // Default: true
  loadFullUser?: boolean;    // Default: true
  onError?: (error, req, res) => void;
  skipIf?: (req) => boolean;
}

// Basic usage - authentication required
app.get('/protected', authenticateRequest(), (req: OxyRequest, res) => {
  res.json({ user: req.user }); // req.user automatically populated
});

// Optional authentication
app.get('/optional', authenticateRequest({ required: false }), (req, res) => {
  // Works for both authenticated and anonymous users
});

// Custom error handling
app.get('/api/data', authenticateRequest({
  onError: (error, req, res) => {
    res.status(error.statusCode).json({ 
      customMessage: 'Please log in to access this resource' 
    });
  }
}), handler);

// Skip authentication for specific conditions
app.use('/api', authenticateRequest({
  skipIf: (req) => req.path === '/api/health'
}));
```

#### `authenticateTokenOnly(config?)`

Lightweight middleware that only validates tokens without loading user data.

```typescript
app.get('/quick-check', authenticateTokenOnly(), (req: OxyRequest, res) => {
  // req.userId is set, but req.user is minimal
  res.json({ userId: req.userId });
});
```

#### `optionalAuthentication(config?)`

Convenience middleware for optional authentication.

```typescript
app.get('/posts', optionalAuthentication(), (req: OxyRequest, res) => {
  if (req.user) {
    // Authenticated user logic
  } else {
    // Anonymous user logic  
  }
});
```

#### `autoAuthenticate(options?)`

Automatically apply authentication to all routes except those excluded.

```typescript
app.use(autoAuthenticate({
  excludePaths: ['/login', '/register', '/health'],
  excludePatterns: [/^\/public\//],
  config: { required: true }
}));

// Now all routes require authentication except excluded ones
app.get('/any-route', (req: OxyRequest, res) => {
  // req.user is automatically available
});
```

#### Utility Functions

```typescript
// Check if request is authenticated
if (isAuthenticated(req)) {
  // Handle authenticated user
}

// Get current user ID
const userId = getCurrentUserId(req); // string | null

// Get current user object  
const user = getCurrentUser(req); // User | null
```

## 🎯 Advanced Usage Patterns

### Custom Authentication Flow

```tsx
function CustomAuth() {
  const { login, register, checkUsernameAvailability } = useAuth();
  const [username, setUsername] = useState('');
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  // Real-time username validation
  useEffect(() => {
    const checkUsername = async () => {
      if (username.length >= 3) {
        const result = await checkUsernameAvailability(username);
        setIsAvailable(result.available);
      }
    };
    
    const timeout = setTimeout(checkUsername, 500);
    return () => clearTimeout(timeout);
  }, [username, checkUsernameAvailability]);

  return (
    <div>
      <input 
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
      />
      {isAvailable === false && <span>Username taken!</span>}
      {isAvailable === true && <span>Username available!</span>}
    </div>
  );
}
```

### Protected Route Component

```tsx
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStatus();
  
  if (isLoading) {
    return <LoadingSpinner />;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return <>{children}</>;
}

// Usage
<Route path="/dashboard" element={
  <ProtectedRoute>
    <Dashboard />
  </ProtectedRoute>
} />
```

### Backend Route Protection Patterns

```typescript
// Method 1: Individual route protection
app.get('/user/profile', authenticateRequest(), handler);
app.get('/user/settings', authenticateRequest(), handler);

// Method 2: Router-level protection
const protectedRouter = express.Router();
protectedRouter.use(authenticateRequest());
protectedRouter.get('/profile', handler);
protectedRouter.get('/settings', handler);
app.use('/user', protectedRouter);

// Method 3: Application-level protection with exclusions  
app.use(autoAuthenticate({
  excludePaths: ['/auth/login', '/auth/register', '/health']
}));
// All routes now require authentication except excluded ones

// Method 4: Conditional protection
app.use('/api', authenticateRequest({
  skipIf: (req) => req.method === 'GET' && req.path.startsWith('/api/public')
}));
```

### Custom Error Handling

```typescript
// Frontend: Handle authentication errors
function LoginForm() {
  const { login, error, clearError } = useAuth();
  
  const handleLogin = async (credentials) => {
    try {
      clearError();
      await login(credentials.username, credentials.password);
    } catch (err) {
      // Error is automatically set in auth state
      console.error('Login failed:', error);
    }
  };
  
  return (
    <form onSubmit={handleLogin}>
      {error && <div className="error">{error}</div>}
      {/* form fields */}
    </form>
  );
}

// Backend: Custom error responses
app.use('/api', authenticateRequest({
  onError: (error, req, res) => {
    // Custom error response format
    res.status(error.statusCode).json({
      success: false,
      message: getCustomMessage(error.code),
      code: error.code,
      timestamp: new Date().toISOString()
    });
  }
}));

function getCustomMessage(code: string): string {
  switch (code) {
    case 'MISSING_TOKEN':
      return 'Please log in to continue';
    case 'TOKEN_EXPIRED':
      return 'Your session has expired. Please log in again';
    case 'INVALID_TOKEN':
      return 'Invalid session. Please log in again';
    default:
      return 'Authentication required';
  }
}
```

## 🌐 React Native Considerations

The zero-config authentication works identically on React Native with a few platform-specific optimizations:

### Installation

```bash
npm install @oxyhq/services @react-native-async-storage/async-storage
```

### Setup

```tsx
// App.tsx
import React from 'react';
import { AuthProvider } from '@oxyhq/services';
import { NavigationContainer } from '@react-navigation/native';
import AppNavigator from './AppNavigator';

export default function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}
```

### Navigation Integration

```tsx
// AppNavigator.tsx
import { useAuthStatus } from '@oxyhq/services';

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuthStatus();
  
  if (isLoading) {
    return <LoadingScreen />;
  }
  
  return (
    <Stack.Navigator>
      {isAuthenticated ? (
        <>
          <Stack.Screen name="Home" component={HomeScreen} />
          <Stack.Screen name="Profile" component={ProfileScreen} />
        </>
      ) : (
        <>
          <Stack.Screen name="Login" component={LoginScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </>
      )}
    </Stack.Navigator>
  );
}
```

### Platform-Specific Features

- **Automatic Token Persistence**: Uses AsyncStorage to persist tokens across app restarts
- **Network State Awareness**: Automatically retries failed auth requests when network returns
- **Expo Compatibility**: Works seamlessly with Expo managed workflow
- **Deep Linking**: Authentication state is preserved during deep link navigation

## 🛠️ Migration from Legacy Authentication

If you're currently using the legacy `OxyServices` class, migration is straightforward:

### Before (Legacy)

```tsx
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Manual token management
const loginResponse = await oxy.login(username, password);
oxy.setTokens(loginResponse.accessToken, loginResponse.refreshToken);

// Manual middleware setup
const authMiddleware = oxy.createAuthenticateTokenMiddleware();
```

### After (Zero-Config)

```tsx
import { AuthProvider, useAuth } from '@oxyhq/services';

// Wrap app
<AuthProvider baseURL="https://api.oxy.so">
  <App />
</AuthProvider>

// Use in components
const { login, user, isAuthenticated } = useAuth();
await login(username, password); // Tokens automatically handled
```

### Gradual Migration Strategy

1. **Add AuthProvider** to your app root while keeping existing code
2. **Start using useAuth** in new components 
3. **Gradually replace** legacy OxyServices usage with hooks
4. **Update backend routes** to use new zero-config middleware
5. **Remove legacy code** once fully migrated

## 🔧 Configuration Options

### Environment Variables (Backend)

```bash
ACCESS_TOKEN_SECRET=your-jwt-secret
REFRESH_TOKEN_SECRET=your-refresh-secret  
MONGODB_URI=mongodb://localhost:27017/oxy
NODE_ENV=production
```

### Advanced Configuration

```tsx
// Frontend: Custom auth provider config
<AuthProvider 
  baseURL="https://api.oxy.so"
  // Future customization options will be added here
>
  <App />
</AuthProvider>
```

```typescript
// Backend: Advanced middleware config
app.use(authenticateRequest({
  required: true,
  loadFullUser: true,
  skipIf: (req) => req.path.startsWith('/webhook'),
  onError: customErrorHandler
}));
```

## 🚨 Security Best Practices

The zero-config authentication implements security best practices by default:

- **JWT Token Security**: Short-lived access tokens with secure refresh mechanism
- **Automatic Token Refresh**: Tokens refresh before expiration to prevent auth interruptions  
- **Secure Storage**: Tokens stored securely (AsyncStorage on mobile, memory on web)
- **CSRF Protection**: Automatic CSRF protection for state-changing operations
- **XSS Prevention**: Secure token handling prevents XSS attacks
- **Request Retry Logic**: Automatic retry of failed requests due to expired tokens
- **Session Management**: Proper session invalidation on logout

## ❓ Troubleshooting

### Common Issues

#### "useAuth must be used within an AuthProvider"

```tsx
// ❌ Wrong
function App() {
  const { isAuthenticated } = useAuth(); // Error!
  return <div>App</div>;
}

// ✅ Correct
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated } = useAuth(); // Works!
  return <div>App</div>;
}
```

#### Authentication not persisting across app restarts

- Ensure AsyncStorage is properly installed on React Native
- Check that AuthProvider is at the root of your component tree
- Verify network connectivity for initial token validation

#### Backend middleware not populating req.user

```typescript
// ❌ Wrong
app.get('/api/user', (req, res) => {
  // req.user is undefined
});

// ✅ Correct
import { authenticateRequest, OxyRequest } from '@oxyhq/services/api';

app.get('/api/user', authenticateRequest(), (req: OxyRequest, res) => {
  // req.user is automatically populated
  res.json(req.user);
});
```

#### Token refresh failures

- Verify `ACCESS_TOKEN_SECRET` and `REFRESH_TOKEN_SECRET` are set in backend env
- Check that refresh token endpoint `/auth/refresh` is properly configured
- Ensure MongoDB connection is stable for user lookup during refresh

### Enable Debug Logging

```typescript
// Frontend
localStorage.setItem('debug', '@oxy:auth');

// Backend  
process.env.DEBUG = '@oxy:auth';
```

## 📞 Support

For additional support:

- **Documentation**: [oxy.so/docs](https://oxy.so/docs)
- **GitHub Issues**: [github.com/oxyhq/services/issues](https://github.com/oxyhq/services/issues)
- **Community Discord**: [discord.gg/oxy](https://discord.gg/oxy)
- **Email**: support@oxy.so

---

**Ready to get started?** Check out our [integration examples](./examples/) or jump right into the [Quick Start](#quick-start) guide above! 🚀