# React Native Module Rebuild - Usage Examples

This document shows how to use the new Zustand-based architecture that replaces the complex Redux system.

## Quick Start Example

```tsx
import React from 'react';
import { 
  NewOxyContextProvider, 
  useNewOxy,
  useNewFollow,
  OxyServices 
} from '@oxyhq/services';

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so'
});

// Auth Component using new architecture
function AuthComponent() {
  const { 
    user, 
    isAuthenticated, 
    isLoading, 
    error,
    login, 
    logout,
    clearError 
  } = useNewOxy();

  const handleLogin = async () => {
    try {
      await login('username', 'password');
    } catch (err) {
      console.error('Login failed:', err);
    }
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      {isAuthenticated ? (
        <div>
          <h2>Welcome, {user?.username}!</h2>
          <button onClick={() => logout()}>Logout</button>
        </div>
      ) : (
        <div>
          <button onClick={handleLogin}>Login</button>
          {error && (
            <div style={{ color: 'red' }}>
              {error}
              <button onClick={clearError}>×</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Follow Component using new architecture  
function FollowButton({ userId }: { userId: string }) {
  const { isFollowing, isLoading, toggleFollow } = useNewFollow(userId);

  return (
    <button 
      onClick={() => toggleFollow()} 
      disabled={isLoading}
    >
      {isLoading ? 'Loading...' : (isFollowing ? 'Unfollow' : 'Follow')}
    </button>
  );
}

// Main App
function App() {
  return (
    <NewOxyContextProvider oxyServices={oxyServices}>
      <div>
        <h1>My App</h1>
        <AuthComponent />
        <FollowButton userId="user-123" />
      </div>
    </NewOxyContextProvider>
  );
}

export default App;
```

## Advanced Examples

### Multiple Users Follow Management

```tsx
function UserList({ userIds }: { userIds: string[] }) {
  const { followData, toggleFollowForUser } = useNewFollow(userIds);

  return (
    <div>
      {userIds.map(userId => (
        <div key={userId}>
          User: {userId}
          <button onClick={() => toggleFollowForUser(userId)}>
            {followData[userId]?.isFollowing ? 'Unfollow' : 'Follow'}
          </button>
          {followData[userId]?.isLoading && <span>Loading...</span>}
        </div>
      ))}
    </div>
  );
}
```

### Optimized Re-renders

```tsx
// Only re-renders when user changes
function UserDisplay() {
  const user = useAuthUser();
  return <div>{user?.username}</div>;
}

// Only re-renders when authentication status changes
function LoginStatus() {
  const isAuthenticated = useIsAuthenticated();
  return <div>{isAuthenticated ? 'Logged in' : 'Logged out'}</div>;
}

// Only re-renders when this specific user's follow status changes
function SpecificFollowButton({ userId }: { userId: string }) {
  const { isFollowing, isLoading } = useUserFollowStatus(userId);
  const { toggleFollow } = useNewFollow(userId);
  
  return (
    <button onClick={() => toggleFollow()}>
      {isFollowing ? 'Unfollow' : 'Follow'}
    </button>
  );
}
```

### Custom Store Hooks

```tsx
// Create custom selectors for specific use cases
function useAuthProfile() {
  const user = useAuthUser();
  return user ? {
    id: user.id,
    username: user.username,
    displayName: user.name?.first + ' ' + user.name?.last,
    avatar: user.avatar?.url
  } : null;
}

function ProfileCard() {
  const profile = useAuthProfile();
  
  if (!profile) return null;
  
  return (
    <div>
      <img src={profile.avatar} alt={profile.displayName} />
      <h3>{profile.displayName}</h3>
      <p>@{profile.username}</p>
    </div>
  );
}
```

## React Native Example

```tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { 
  NewOxyContextProvider, 
  useNewOxy,
  OxyServices 
} from '@oxyhq/services';

const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so'
});

function AuthScreen() {
  const { 
    user, 
    isAuthenticated, 
    isLoading, 
    login, 
    logout 
  } = useNewOxy();

  const handleLogin = async () => {
    try {
      await login('testuser', 'testpass');
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  return (
    <View style={{ padding: 20 }}>
      {isAuthenticated ? (
        <View>
          <Text>Welcome, {user?.username}!</Text>
          <TouchableOpacity onPress={() => logout()}>
            <Text>Logout</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={handleLogin} disabled={isLoading}>
          <Text>{isLoading ? 'Logging in...' : 'Login'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function App() {
  return (
    <NewOxyContextProvider oxyServices={oxyServices}>
      <AuthScreen />
    </NewOxyContextProvider>
  );
}
```

## Performance Best Practices

### 1. Use Specific Hooks

```tsx
// ❌ Bad - causes re-render on any auth state change
function MyComponent() {
  const auth = useAuth();
  return <div>{auth.user?.username}</div>;
}

// ✅ Good - only re-renders when user changes
function MyComponent() {
  const user = useAuthUser();
  return <div>{user?.username}</div>;
}
```

### 2. Memoize Callbacks

```tsx
function FollowButton({ userId }: { userId: string }) {
  const { toggleFollow } = useNewFollow(userId);
  
  // ✅ toggleFollow is already memoized in the hook
  return <button onClick={toggleFollow}>Follow</button>;
}
```

### 3. Batch Updates

```tsx
function UserListActions({ userIds }: { userIds: string[] }) {
  const { fetchMultipleStatuses } = useNewFollow(userIds);
  
  useEffect(() => {
    // ✅ Fetch all statuses in one batch operation
    fetchMultipleStatuses();
  }, [fetchMultipleStatuses]);
  
  return <UserList userIds={userIds} />;
}
```

## Error Handling

```tsx
function ErrorBoundaryExample() {
  const { error, clearError } = useNewOxy();
  
  if (error) {
    return (
      <div style={{ color: 'red', padding: 20 }}>
        <h3>Something went wrong:</h3>
        <p>{error}</p>
        <button onClick={clearError}>Try Again</button>
      </div>
    );
  }
  
  return <YourComponent />;
}
```

## Testing

```tsx
import { render, screen } from '@testing-library/react';
import { NewOxyContextProvider } from '@oxyhq/services';

function TestWrapper({ children }: { children: React.ReactNode }) {
  const mockOxyServices = {
    login: jest.fn(),
    logout: jest.fn(),
    getCurrentUser: jest.fn(),
    // ... other mock methods
  };
  
  return (
    <NewOxyContextProvider oxyServices={mockOxyServices as any}>
      {children}
    </NewOxyContextProvider>
  );
}

test('login flow works', async () => {
  render(<AuthComponent />, { wrapper: TestWrapper });
  
  const loginButton = screen.getByText('Login');
  fireEvent.click(loginButton);
  
  // ... test assertions
});
```

## Migration from Old System

```tsx
// OLD WAY (Redux)
import { useSelector, useDispatch } from 'react-redux';
import { authSelectors, loginStart } from '@oxyhq/services';

function OldAuthComponent() {
  const dispatch = useDispatch();
  const user = useSelector(authSelectors.selectUser);
  const isLoading = useSelector(authSelectors.selectIsLoading);
  
  const handleLogin = () => {
    dispatch(loginStart());
  };
}

// NEW WAY (Zustand)
import { useNewOxy } from '@oxyhq/services';

function NewAuthComponent() {
  const { user, isLoading, login } = useNewOxy();
  
  const handleLogin = async () => {
    await login('username', 'password');
  };
}
```

The new architecture is much simpler, more performant, and easier to use!