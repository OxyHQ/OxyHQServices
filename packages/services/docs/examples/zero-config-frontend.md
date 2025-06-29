# Zero Config Frontend Authentication

Simple hook that provides authenticated fetch with automatic token management using the existing `useOxy` infrastructure.

## Quick Start

```typescript
import { OxyProvider, useAuthFetch } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

// 1. Setup OxyProvider (wrap your app)
const oxy = new OxyServices({ baseURL: 'http://localhost:4000' });

function App() {
  return (
    <OxyProvider oxyServices={oxy} contextOnly>
      <MyApp />
    </OxyProvider>
  );
}

// 2. Use the hook in any component
function MyComponent() {
  const authFetch = useAuthFetch();

  const fetchData = async () => {
    // Automatic authentication, token refresh, and error handling
    const data = await authFetch.get('/api/protected');
    console.log(data);
  };

  return <button onClick={fetchData}>Fetch Protected Data</button>;
}
```

## Zero Config Features

✅ **Drop-in fetch replacement** - Works exactly like fetch()  
✅ **Automatic authentication** - Adds JWT tokens automatically  
✅ **Automatic token refresh** - Handles expired tokens seamlessly  
✅ **Error handling** - Proper error messages and status codes  
✅ **TypeScript support** - Full type safety  
✅ **Leverages useOxy** - Uses existing authentication state  

## Basic Usage

### 1. Setup (One Time)

```typescript
// App.tsx
import { OxyProvider } from '@oxyhq/services/ui';
import { OxyServices } from '@oxyhq/services';

const oxy = new OxyServices({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:4000'
});

export default function App() {
  return (
    <OxyProvider oxyServices={oxy} contextOnly>
      <Routes>
        {/* Your app routes */}
      </Routes>
    </OxyProvider>
  );
}
```

### 2. Use in Components

```typescript
// components/UserProfile.tsx
import { useAuthFetch } from '@oxyhq/services/ui';

export function UserProfile() {
  const authFetch = useAuthFetch();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    const loadProfile = async () => {
      try {
        // Automatic authentication - no tokens to manage!
        const profileData = await authFetch.get('/api/user/profile');
        setProfile(profileData);
      } catch (error) {
        console.error('Failed to load profile:', error);
      }
    };

    if (authFetch.isAuthenticated) {
      loadProfile();
    }
  }, [authFetch]);

  if (!authFetch.isAuthenticated) {
    return <LoginForm />;
  }

  return <div>Welcome {profile?.username}!</div>;
}
```

## API Reference

### Main Fetch Function

```typescript
// Drop-in replacement for fetch()
const response = await authFetch('/api/endpoint', {
  method: 'POST',
  body: JSON.stringify(data)
});
```

### Convenience Methods

```typescript
// GET request
const users = await authFetch.get('/api/users');

// POST request
const newUser = await authFetch.post('/api/users', {
  name: 'John Doe',
  email: 'john@example.com'
});

// PUT request  
const updated = await authFetch.put('/api/users/123', { name: 'Jane' });

// DELETE request
await authFetch.delete('/api/users/123');
```

### Authentication Methods

```typescript
// Check auth status
if (authFetch.isAuthenticated) {
  console.log('User is logged in:', authFetch.user);
}

// Login
await authFetch.login('username', 'password');

// Signup
await authFetch.signUp('username', 'email@example.com', 'password');

// Logout
await authFetch.logout();
```

## Examples

### React Login Form

```typescript
import { useAuthFetch } from '@oxyhq/services/ui';

export function LoginForm() {
  const authFetch = useAuthFetch();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      await authFetch.login(credentials.username, credentials.password);
      // User is now authenticated, authFetch.isAuthenticated will be true
    } catch (error) {
      alert('Login failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  if (authFetch.isAuthenticated) {
    return <div>Welcome {authFetch.user?.username}!</div>;
  }

  return (
    <form onSubmit={handleLogin}>
      <input
        type="text"
        placeholder="Username"
        value={credentials.username}
        onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
      />
      <input
        type="password"
        placeholder="Password"
        value={credentials.password}
        onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
      />
      <button type="submit" disabled={loading}>
        {loading ? 'Logging in...' : 'Login'}
      </button>
    </form>
  );
}
```

### React Data Fetching

```typescript
import { useAuthFetch } from '@oxyhq/services/ui';

export function UserList() {
  const authFetch = useAuthFetch();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const userData = await authFetch.get('/api/users');
      setUsers(userData);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const createUser = async (userData) => {
    try {
      const newUser = await authFetch.post('/api/users', userData);
      setUsers([...users, newUser]);
    } catch (error) {
      console.error('Failed to create user:', error);
    }
  };

  useEffect(() => {
    if (authFetch.isAuthenticated) {
      fetchUsers();
    }
  }, [authFetch.isAuthenticated]);

  return (
    <div>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <ul>
          {users.map(user => (
            <li key={user.id}>{user.name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Custom Hook Pattern

```typescript
// hooks/useApi.ts
import { useAuthFetch } from '@oxyhq/services/ui';

export function useApi() {
  const authFetch = useAuthFetch();

  const fetchUserProfile = async () => {
    return authFetch.get('/api/user/profile');
  };

  const updateUserProfile = async (data) => {
    return authFetch.put('/api/user/profile', data);
  };

  const fetchPosts = async () => {
    return authFetch.get('/api/posts');
  };

  const createPost = async (postData) => {
    return authFetch.post('/api/posts', postData);
  };

  return {
    fetchUserProfile,
    updateUserProfile,
    fetchPosts,
    createPost,
    isAuthenticated: authFetch.isAuthenticated,
    user: authFetch.user
  };
}

// Use in components
export function PostList() {
  const { fetchPosts, createPost, isAuthenticated } = useApi();
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchPosts().then(setPosts);
    }
  }, [isAuthenticated]);

  return (
    <div>
      {posts.map(post => <PostItem key={post.id} post={post} />)}
    </div>
  );
}
```

### React Native Example

```typescript
// screens/ProfileScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, Button } from 'react-native';
import { useAuthFetch } from '@oxyhq/services/ui';

export function ProfileScreen() {
  const authFetch = useAuthFetch();
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (authFetch.isAuthenticated) {
      authFetch.get('/api/user/profile')
        .then(setProfile)
        .catch(console.error);
    }
  }, [authFetch.isAuthenticated]);

  const handleLogout = async () => {
    await authFetch.logout();
    // User is now logged out, navigate to login screen
  };

  if (!authFetch.isAuthenticated) {
    return (
      <View>
        <Text>Please log in</Text>
      </View>
    );
  }

  return (
    <View>
      <Text>Welcome {profile?.username}!</Text>
      <Button title="Logout" onPress={handleLogout} />
    </View>
  );
}
```

## Migration from Manual Fetch

### Before (Manual Token Management)

```typescript
// ❌ Complex manual token management
const [token, setToken] = useState(localStorage.getItem('token'));

const apiCall = async () => {
  let response = await fetch('/api/data', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 401) {
    // Manual token refresh
    const refreshResponse = await fetch('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: localStorage.getItem('refreshToken') })
    });
    
    if (refreshResponse.ok) {
      const { accessToken } = await refreshResponse.json();
      setToken(accessToken);
      localStorage.setItem('token', accessToken);
      
      // Retry original request
      response = await fetch('/api/data', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
    }
  }

  return response.json();
};
```

### After (Zero Config)

```typescript
// ✅ Zero configuration
const authFetch = useAuthFetch();

const apiCall = async () => {
  return authFetch.get('/api/data');
};
// That's it! All token management is automatic
```

## Error Handling

```typescript
const authFetch = useAuthFetch();

try {
  const data = await authFetch.get('/api/protected');
} catch (error) {
  if (error.status === 401) {
    // User needs to authenticate
    console.log('Please log in');
  } else if (error.status === 403) {
    // User doesn't have permission
    console.log('Access denied');
  } else {
    // Other error
    console.error('API error:', error.message);
  }
}
```

## Why This Approach?

**Simple**: Just one hook, leverages existing `useOxy` infrastructure  
**Consistent**: Uses the same authentication state as UI components  
**Lightweight**: No additional setup or configuration needed  
**Familiar**: Works exactly like fetch() but with authentication  
**Integrated**: Seamlessly works with `OxyProvider` and `useOxy`  

This approach eliminates all authentication boilerplate while providing a familiar fetch-like API that just works! 