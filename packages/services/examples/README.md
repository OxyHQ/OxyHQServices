# Integration Examples

This directory contains complete examples showing how to integrate OxyHQ Services zero-config authentication in real applications.

## Examples

- **[React Web App](./react-web/)** - Complete React web application with authentication
- **[React Native App](./react-native/)** - React Native Expo app with authentication  
- **[Express Backend](./express-backend/)** - Express.js API server with zero-config auth middleware
- **[Next.js Full-Stack](./nextjs-fullstack/)** - Complete Next.js app with both frontend and backend auth

## Quick Start

Each example includes:
- ✅ **Complete setup instructions**
- ✅ **Zero-config authentication implementation**
- ✅ **Best practices and patterns**
- ✅ **Error handling examples**
- ✅ **Testing examples**

## Running Examples

1. **Clone the repository**
   ```bash
   git clone https://github.com/oxyhq/oxyhqservices
   cd oxyhqservices/packages/services/examples
   ```

2. **Choose an example**
   ```bash
   cd react-web  # or react-native, express-backend, nextjs-fullstack
   ```

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Run the example**
   ```bash
   npm start
   ```

## Features Demonstrated

### Frontend Examples
- Zero-config authentication setup with `AuthProvider`
- Login/logout flows with `useAuth` hook
- Protected routes with `withAuth` HOC
- Real-time username/email validation
- Automatic token management
- Error handling and user feedback
- Cross-platform compatibility (React Native)

### Backend Examples
- Zero-config middleware with `authenticateRequest()`
- Automatic `req.user` population
- Optional authentication for public/private content
- Custom error handling
- Route protection patterns
- Session management
- JWT token validation

## Architecture Patterns

### 1. Basic Authentication Flow
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│   Frontend  │    │     Auth     │    │   Backend   │
│             │    │   Manager    │    │             │
├─────────────┤    ├──────────────┤    ├─────────────┤
│ AuthProvider│◄──►│ Token Store  │◄──►│ JWT Verify  │
│ useAuth()   │    │ Auto Refresh │    │ req.user    │
│ Components  │    │ HTTP Client  │    │ Middleware  │
└─────────────┘    └──────────────┘    └─────────────┘
```

### 2. Protected Route Pattern
```tsx
// Zero-config protected routes
<Route path="/dashboard" element={
  <ProtectedRoute>
    <Dashboard />
  </ProtectedRoute>
} />

// Or using HOC
const ProtectedDashboard = withAuth(Dashboard);
<Route path="/dashboard" element={<ProtectedDashboard />} />
```

### 3. Backend Route Protection
```typescript
// Zero-config route protection
app.get('/api/user', authenticateRequest(), (req: OxyRequest, res) => {
  res.json(req.user); // Automatically populated
});

// Optional authentication
app.get('/api/posts', authenticateRequest({ required: false }), (req, res) => {
  // Handle both authenticated and anonymous users
});
```

## Best Practices

### 1. Provider Placement
```tsx
// ✅ Correct - At app root
function App() {
  return (
    <AuthProvider baseURL="https://api.oxy.so">
      <BrowserRouter>
        <Routes>
          {/* Your routes */}
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
```

### 2. Hook Usage
```tsx
// ✅ Correct - Use specific hooks for specific needs
function UserProfile() {
  const { user } = useCurrentUser(); // Only user data
  const { isAuthenticated } = useAuthStatus(); // Only auth status
  const client = useOxyClient(); // For API calls
  
  return <div>Profile for {user?.username}</div>;
}
```

### 3. Error Handling
```tsx
// ✅ Comprehensive error handling
function LoginForm() {
  const { login, error, clearError } = useAuth();
  
  const handleSubmit = async (data) => {
    try {
      clearError();
      await login(data.username, data.password);
    } catch (err) {
      // Error automatically set in auth state
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      {error && <ErrorAlert message={error} onClose={clearError} />}
      {/* form fields */}
    </form>
  );
}
```

### 4. Backend Middleware Organization
```typescript
// ✅ Organized middleware patterns
// Public routes
app.use('/auth', authRouter); // login, register, etc.
app.use('/health', healthRouter);

// Protected routes
app.use('/api/user', authenticateRequest(), userRouter);
app.use('/api/admin', authenticateRequest(), adminRouter);

// Mixed routes (some protected, some public)
app.use('/api/posts', authenticateRequest({ required: false }), postsRouter);
```

## Common Patterns

### Authentication Guard Component
```tsx
function AuthGuard({ children, fallback = <LoginPage /> }) {
  const { isAuthenticated, isLoading } = useAuthStatus();
  
  if (isLoading) return <LoadingSpinner />;
  if (!isAuthenticated) return fallback;
  
  return <>{children}</>;
}
```

### API Client Hook
```tsx
function useApi() {
  const client = useOxyClient();
  const { isAuthenticated } = useAuthStatus();
  
  const request = useCallback(async (config) => {
    if (!isAuthenticated) {
      throw new Error('Authentication required');
    }
    return client(config);
  }, [client, isAuthenticated]);
  
  return { request };
}
```

### Conditional Rendering
```tsx
function NavBar() {
  const { isAuthenticated, user, logout } = useAuth();
  
  return (
    <nav>
      <Logo />
      {isAuthenticated ? (
        <UserMenu user={user} onLogout={logout} />
      ) : (
        <LoginButton />
      )}
    </nav>
  );
}
```

## Testing Examples

### Frontend Testing
```tsx
// Test with AuthProvider wrapper
function renderWithAuth(ui: React.ReactElement, options = {}) {
  return render(
    <AuthProvider baseURL="http://localhost:3001">
      {ui}
    </AuthProvider>,
    options
  );
}

test('shows user profile when authenticated', () => {
  renderWithAuth(<UserProfile />);
  // Test authenticated behavior
});
```

### Backend Testing
```typescript
import request from 'supertest';
import app from '../app';

describe('Authentication middleware', () => {
  test('requires authentication', async () => {
    const response = await request(app)
      .get('/api/protected')
      .expect(401);
    
    expect(response.body.error).toBe('MISSING_TOKEN');
  });
  
  test('allows authenticated access', async () => {
    const token = generateTestToken();
    
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
      
    expect(response.body.user).toBeDefined();
  });
});
```

## Troubleshooting

### Common Issues and Solutions

1. **Provider not found error**
   - Ensure AuthProvider wraps your entire app
   - Check that useAuth is called within AuthProvider

2. **Tokens not persisting**
   - Verify AsyncStorage is installed (React Native)
   - Check network connectivity for token validation

3. **Backend req.user undefined**
   - Import and use OxyRequest type
   - Apply authenticateRequest() middleware
   - Check JWT secrets are configured

4. **CORS issues**
   - Configure CORS to allow credentials
   - Set withCredentials: true in axios config

See individual example READMEs for specific setup instructions and troubleshooting.