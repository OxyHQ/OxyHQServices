# Zero-Config OxyHQ Services Integration

OxyHQ Services now provides a truly zero-config experience for both frontend and backend integration. Get authentication working in your app with just 2-3 lines of code.

## 🚀 Quick Start

### Frontend (React/Next.js)

**1. Wrap your app (1 line):**
```jsx
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyZeroConfigProvider>
      <YourApp />
    </OxyZeroConfigProvider>
  );
}
```

**2. Use authentication (1 line):**
```jsx
import { useOxyZeroConfig } from '@oxyhq/services/ui';

function LoginComponent() {
  const { user, login, logout, isAuthenticated } = useOxyZeroConfig();

  if (isAuthenticated) {
    return <div>Welcome, {user?.username}! <button onClick={logout}>Logout</button></div>;
  }

  return <button onClick={() => login('username', 'password')}>Login</button>;
}
```

### Backend (Express.js)

**1. Add authentication middleware (1 line):**
```js
import express from 'express';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();

// Zero-config auth for all /api routes
app.use('/api', createOxyAuth());

// Now all routes automatically have req.user available
app.get('/api/profile', (req, res) => {
  res.json({ user: req.user }); // req.user is automatically available
});
```

**That's it!** No complex setup, no configuration files, no manual token management.

---

## 🔧 How It Works

### Frontend Magic
- **Automatic token storage**: Tokens are saved and restored automatically
- **Auto token refresh**: Expired tokens refresh seamlessly in the background  
- **Cross-platform**: Works in React, React Native, Next.js, etc.
- **Zero setup**: Just wrap your app and start using authentication

### Backend Magic
- **Automatic token validation**: Middleware validates JWT tokens automatically
- **User data injection**: `req.user` contains full user profile automatically
- **Error handling**: Built-in error responses for invalid/missing tokens
- **Zero setup**: Just add the middleware to your routes

---

## 📖 Complete Examples

### React App (Complete working example)

```jsx
// App.js
import React from 'react';
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';
import Dashboard from './Dashboard';

function App() {
  return (
    <OxyZeroConfigProvider>
      <Dashboard />
    </OxyZeroConfigProvider>
  );
}

export default App;
```

```jsx
// Dashboard.js  
import React from 'react';
import { useOxyZeroConfig } from '@oxyhq/services/ui';

function Dashboard() {
  const { user, login, logout, register, isAuthenticated, isLoading } = useOxyZeroConfig();

  if (isLoading) return <div>Loading...</div>;

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Please log in</h1>
        <button onClick={() => login('demo', 'password')}>
          Login as Demo User
        </button>
        <button onClick={() => register('newuser', 'user@example.com', 'password')}>
          Register New User
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <p>Email: {user.email}</p>
      <button onClick={logout}>Logout</button>
    </div>
  );
}

export default Dashboard;
```

### Express.js Backend (Complete working example)

```js
// server.js
import express from 'express';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();

app.use(express.json());

// Public routes (no authentication required)
app.get('/', (req, res) => {
  res.json({ message: 'Public API endpoint' });
});

// Protected routes - zero-config authentication
app.use('/api', createOxyAuth());

// All routes under /api now have req.user automatically
app.get('/api/profile', (req, res) => {
  // req.user is automatically available and populated
  res.json({ 
    user: req.user,
    message: `Hello ${req.user.username}!` 
  });
});

app.get('/api/protected-data', (req, res) => {
  res.json({
    data: 'This is protected data',
    userId: req.userId,  // Also available
    user: req.user       // Full user object
  });
});

app.listen(3000, () => {
  console.log('Server running on port 3000');
});
```

### Next.js App (Complete working example)

```jsx
// pages/_app.js
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';

export default function App({ Component, pageProps }) {
  return (
    <OxyZeroConfigProvider>
      <Component {...pageProps} />
    </OxyZeroConfigProvider>
  );
}
```

```jsx
// pages/dashboard.js
import { useOxyZeroConfig } from '@oxyhq/services/ui';
import { useEffect, useState } from 'react';

export default function Dashboard() {
  const { user, isAuthenticated, api } = useOxyZeroConfig();
  const [serverData, setServerData] = useState(null);

  useEffect(() => {
    // API calls automatically include auth token
    if (isAuthenticated) {
      fetch('/api/user-data', {
        headers: {
          'Authorization': `Bearer ${api.accessToken}`
        }
      })
      .then(res => res.json())
      .then(setServerData);
    }
  }, [isAuthenticated, api]);

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return (
    <div>
      <h1>Dashboard for {user.username}</h1>
      {serverData && <pre>{JSON.stringify(serverData, null, 2)}</pre>}
    </div>
  );
}
```

---

## ⚙️ Configuration Options

### Frontend Configuration

```jsx
<OxyZeroConfigProvider
  apiUrl="https://your-oxy-api.com"  // Optional: defaults to localhost:3001
  onAuthChange={(user) => console.log('Auth changed:', user)}  // Optional
  storagePrefix="myapp"  // Optional: defaults to 'oxy_zero'
>
  <App />
</OxyZeroConfigProvider>
```

### Backend Configuration

```js
app.use('/api', createOxyAuth({
  baseURL: 'https://your-oxy-api.com',  // Optional: defaults to localhost:3001
  loadUser: true,  // Optional: load full user data (default: true)
  publicPaths: ['/api/health'],  // Optional: paths that don't require auth
  onError: (error, req, res) => {  // Optional: custom error handling
    res.status(error.status).json({ error: error.message });
  }
}));
```

### Optional Authentication

For routes that work with or without authentication:

```js
import { createOptionalOxyAuth } from '@oxyhq/services/node';

// This middleware sets req.user if token is present, but doesn't fail if missing
app.use('/api/public', createOptionalOxyAuth());

app.get('/api/public/content', (req, res) => {
  if (req.user) {
    // User is authenticated - show personalized content
    res.json({ content: 'personalized', user: req.user });
  } else {
    // Anonymous user - show public content  
    res.json({ content: 'public' });
  }
});
```

---

## 🔍 Advanced Usage

### Direct API Access

```jsx
import { useOxyApi } from '@oxyhq/services/ui';

function UserProfile() {
  const api = useOxyApi();

  const updateProfile = async (data) => {
    // All API methods automatically include auth token
    const user = await api.updateProfile(data);
    console.log('Updated user:', user);
  };

  return <button onClick={() => updateProfile({ name: 'New Name' })}>Update</button>;
}
```

### Custom Middleware

```js
import { OxyServices } from '@oxyhq/services/node';

const oxy = new OxyServices({ baseURL: 'https://your-api.com' });

const customAuth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const result = await oxy.authenticateToken(token);
    
    if (result.valid) {
      req.user = result.user;
      req.userId = result.userId;
      next();
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Auth failed' });
  }
};

app.use('/api', customAuth);
```

---

## 🐛 Troubleshooting

### Frontend Issues

**"useOxyZeroConfig must be used within an OxyZeroConfigProvider"**
- Make sure your component is wrapped with `<OxyZeroConfigProvider>`

**Tokens not persisting between sessions**  
- Check that localStorage is available in your environment
- For React Native, ensure you've installed `@react-native-async-storage/async-storage`

### Backend Issues

**"req.user is undefined"**
- Make sure the middleware is applied to your route
- Check that the client is sending the `Authorization: Bearer <token>` header

**CORS issues**
- Make sure your frontend and backend URLs are configured correctly
- Add CORS middleware if needed: `app.use(cors())`

---

## 🚀 Migration from Complex Setup

If you're currently using the full OxyProvider/useOxy context system, you can easily migrate:

**Before (complex):**
```jsx
import { OxyProvider, useOxy } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({ baseURL: 'http://localhost:3001' });

function App() {
  return (
    <OxyProvider oxyServices={oxy}>
      <AuthComponent />
    </OxyProvider>
  );
}

function AuthComponent() {
  const { user, login, logout, isAuthenticated } = useOxy();
  // Component code...
}
```

**After (zero-config):**
```jsx
import { OxyZeroConfigProvider, useOxyZeroConfig } from '@oxyhq/services/ui';

function App() {
  return (
    <OxyZeroConfigProvider>
      <AuthComponent />
    </OxyZeroConfigProvider>
  );
}

function AuthComponent() {
  const { user, login, logout, isAuthenticated } = useOxyZeroConfig();
  // Same component code - just change the import and hook name!
}
```

The API is nearly identical, just simpler to set up!