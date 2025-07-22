# Quick Start Guide

Get started with OxyHQ Services in under 2 minutes with our **zero-config** setup.

## 🚀 Zero-Config Setup (Recommended)

### Frontend (React/Next.js)

**1. Install the package**
```bash
npm install @oxyhq/services
```

**2. Wrap your app (1 line)**
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

**3. Use authentication anywhere (1 line)**
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

**1. Add authentication middleware (1 line)**
```js
import express from 'express';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();
app.use(express.json());

// Zero-config auth for all /api routes
app.use('/api', createOxyAuth());

// Now all routes under /api automatically have req.user available
app.get('/api/profile', (req, res) => {
  res.json({ user: req.user }); // req.user is automatically populated!
});

app.listen(3000, () => console.log('Server running'));
```

**That's it! 🎉** Your app now has full authentication with automatic token management.

---

## 📖 Complete Working Example

Here's a complete React + Express example that works out of the box:

### Frontend (React)

**App.js**
```jsx
import React from 'react';
import { OxyZeroConfigProvider } from '@oxyhq/services/ui';
import Dashboard from './Dashboard';

export default function App() {
  return (
    <OxyZeroConfigProvider apiUrl="http://localhost:3001">
      <Dashboard />
    </OxyZeroConfigProvider>
  );
}
```

**Dashboard.js**
```jsx
import React, { useState, useEffect } from 'react';
import { useOxyZeroConfig } from '@oxyhq/services/ui';

export default function Dashboard() {
  const { user, login, logout, register, isAuthenticated, isLoading } = useOxyZeroConfig();
  const [serverData, setServerData] = useState(null);

  // Fetch data from your backend
  useEffect(() => {
    if (isAuthenticated) {
      fetch('/api/profile', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('oxy_zero_accessToken')}`
        }
      })
      .then(res => res.json())
      .then(setServerData)
      .catch(console.error);
    }
  }, [isAuthenticated]);

  if (isLoading) return <div>Loading...</div>;

  if (!isAuthenticated) {
    return (
      <div>
        <h1>Welcome to My App</h1>
        <button onClick={() => login('demo', 'password')}>
          Login as Demo
        </button>
        <button onClick={() => register('newuser', 'user@example.com', 'newpass')}>
          Register New Account
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p>Welcome back, {user.username}!</p>
      <p>Email: {user.email}</p>
      
      {serverData && (
        <div>
          <h2>Server Response:</h2>
          <pre>{JSON.stringify(serverData, null, 2)}</pre>
        </div>
      )}
      
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### Backend (Express.js)

**server.js**
```js
import express from 'express';
import cors from 'cors';
import { createOxyAuth } from '@oxyhq/services/node';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Public routes
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the API' });
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Protected routes with zero-config authentication
app.use('/api', createOxyAuth({
  baseURL: process.env.OXY_API_URL || 'http://localhost:3001'
}));

// All routes under /api now have req.user automatically
app.get('/api/profile', (req, res) => {
  res.json({
    message: `Hello ${req.user.username}!`,
    user: req.user,
    serverTime: new Date().toISOString()
  });
});

app.get('/api/protected-data', (req, res) => {
  res.json({
    data: 'This is protected data only authenticated users can see',
    userId: req.userId,
    user: req.user
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 API available at http://localhost:${PORT}`);
});
```

### Run the Example

1. **Start your Oxy API server** (or use a hosted instance):
   ```bash
   # If you have the Oxy API locally
   npm run api:dev
   ```

2. **Start your backend**:
   ```bash
   node server.js
   ```

3. **Start your React app**:
   ```bash
   npm start
   ```

4. **Visit http://localhost:3000** and click "Login as Demo"

---

## 🔧 Configuration Options

### Frontend Configuration

```jsx
<OxyZeroConfigProvider
  apiUrl="https://your-oxy-api.com"          // Your Oxy API URL
  onAuthChange={(user) => console.log(user)} // Auth state changes
  storagePrefix="myapp"                      // Storage key prefix
>
  <App />
</OxyZeroConfigProvider>
```

### Backend Configuration

```js
app.use('/api', createOxyAuth({
  baseURL: 'https://your-oxy-api.com',  // Your Oxy API URL
  loadUser: true,                       // Load full user data (default)
  publicPaths: ['/api/health'],         // Routes that don't need auth
  onError: (error, req, res) => {       // Custom error handling
    console.error('Auth error:', error);
    res.status(error.status).json({ error: error.message });
  }
}));
```

### Environment Variables

```bash
# Frontend (.env)
REACT_APP_OXY_API_URL=http://localhost:3001

# Backend (.env)
OXY_API_URL=http://localhost:3001
PORT=3000
```

---

## 🎯 Next Steps

### API Access
Use the `useOxyApi` hook for direct API calls:

```jsx
import { useOxyApi } from '@oxyhq/services/ui';

function UserProfile() {
  const api = useOxyApi();

  const updateProfile = async (data) => {
    // Token automatically included
    const user = await api.updateProfile(data);
    console.log('Updated:', user);
  };

  return <button onClick={() => updateProfile({ name: 'New Name' })}>Update</button>;
}
```

### Optional Authentication
For routes that work with or without auth:

```js
import { createOptionalOxyAuth } from '@oxyhq/services/node';

app.use('/api/content', createOptionalOxyAuth());

app.get('/api/content', (req, res) => {
  if (req.user) {
    res.json({ content: 'personalized', user: req.user });
  } else {
    res.json({ content: 'public' });
  }
});
```

### Error Handling

```jsx
const { login, error } = useOxyZeroConfig();

const handleLogin = async () => {
  try {
    await login('username', 'password');
  } catch (err) {
    console.error('Login failed:', err);
  }
};
```

---

## 📚 Advanced Guides

- **[Zero-Config Complete Guide](./zero-config.md)** - Full zero-config documentation
- **[Traditional Setup Guide](./quick-start-traditional.md)** - Classic OxyProvider setup
- **[Core API Reference](./core-api.md)** - Complete API documentation  
- **[Integration Examples](./examples/)** - More advanced examples
- **[UI Components Guide](./ui-components.md)** - React/RN components

## 🐛 Troubleshooting

**"useOxyZeroConfig must be used within an OxyZeroConfigProvider"**
- Make sure your component is wrapped with the provider

**"req.user is undefined"**
- Ensure middleware is applied: `app.use('/api', createOxyAuth())`
- Check the client sends `Authorization: Bearer <token>` header

**CORS errors**
- Add `app.use(cors())` to your Express server
- Configure your frontend and backend URLs correctly

Need more help? Check the [complete troubleshooting guide](./troubleshooting.md).
