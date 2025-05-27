# Multi-User Authentication System

This document provides comprehensive documentation for the multi-user authentication system in the Oxy Services library.

## Overview

The multi-user authentication system allows users to sign in with multiple accounts simultaneously and switch between them seamlessly. This feature is particularly useful for:

- Users managing multiple accounts (personal, business, etc.)
- Developers testing different user roles
- Family devices with shared access
- Customer support scenarios

## Architecture

### Backend Components

#### Session Management API
- **Endpoint:** `/api/sessions`
- **Features:** CRUD operations for user sessions
- **Security:** Session validation, device tracking, remote logout

#### Enhanced Authentication
- **Multi-session support:** Users can have multiple active sessions
- **Device tracking:** Each session tracks device information
- **Session lifecycle:** Automatic cleanup of expired sessions

### Frontend Components

#### OxyContext Enhancement
The authentication context has been enhanced to support multiple users:

```typescript
interface OxyContextState {
  // Single user (current active)
  user: User | null;
  isAuthenticated: boolean;
  
  // Multi-user support
  users: AuthenticatedUser[];
  
  // Multi-user methods
  switchUser: (userId: string) => Promise<void>;
  removeUser: (userId: string) => Promise<void>;
  getUserSessions: (userId?: string) => Promise<any[]>;
  logoutSession: (sessionId: string, userId?: string) => Promise<void>;
  logoutAll: () => Promise<void>;
}
```

#### Storage Management
- **Local storage:** Secure token storage with encryption support
- **Multi-user data:** Separate storage for each authenticated user
- **Session persistence:** Sessions survive app restarts
- **Legacy migration:** Automatic migration from single-user to multi-user format

## Implementation Guide

### Basic Setup

1. **Install Dependencies**
```bash
npm install @oxyhq/services
```

2. **Configure OxyProvider**
```tsx
import { OxyProvider, OxyServices } from '@oxyhq/services/full';

const oxyServices = new OxyServices({
  baseURL: 'http://localhost:3001', // Your API URL
});

function App() {
  return (
    <OxyProvider
      oxyServices={oxyServices}
      storageKeyPrefix="myapp" // Unique prefix for your app
      onAuthStateChange={(user) => {
        console.log('Auth state changed:', user?.username || 'logged out');
      }}
    >
      <MyApp />
    </OxyProvider>
  );
}
```

3. **Use Multi-User Context**
```tsx
import { useOxy } from '@oxyhq/services/full';

function MyComponent() {
  const { 
    user, 
    users, 
    switchUser, 
    removeUser,
    showBottomSheet 
  } = useOxy();

  return (
    <div>
      <h1>Current User: {user?.username}</h1>
      <p>Total Accounts: {users.length}</p>
      
      {/* Account management buttons */}
      <button onClick={() => showBottomSheet('AccountSwitcher')}>
        Switch Account
      </button>
      <button onClick={() => showBottomSheet('SessionManagement')}>
        Manage Sessions
      </button>
      <button onClick={() => showBottomSheet('SignIn')}>
        Add Another Account
      </button>
    </div>
  );
}
```

### Advanced Usage

#### Custom Account Switcher
```tsx
function CustomAccountSwitcher() {
  const { users, user, switchUser, removeUser } = useOxy();

  return (
    <div>
      {users.map((account) => (
        <div key={account.id} className="account-item">
          <Avatar user={account} />
          <span>{account.username}</span>
          {account.id === user?.id && <span>Current</span>}
          
          <button onClick={() => switchUser(account.id)}>
            Switch
          </button>
          <button onClick={() => removeUser(account.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}
```

#### Session Management
```tsx
function SessionManager() {
  const { getUserSessions, logoutSession } = useOxy();
  const [sessions, setSessions] = useState([]);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const userSessions = await getUserSessions();
      setSessions(userSessions);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const handleLogoutSession = async (sessionId) => {
    try {
      await logoutSession(sessionId);
      await loadSessions(); // Reload sessions
    } catch (error) {
      console.error('Failed to logout session:', error);
    }
  };

  return (
    <div>
      <h2>Active Sessions</h2>
      {sessions.map((session) => (
        <div key={session.id} className="session-item">
          <div>
            <strong>{session.deviceInfo.platform}</strong>
            <span>{session.deviceInfo.browser}</span>
          </div>
          <div>
            <span>IP: {session.deviceInfo.ipAddress}</span>
            <span>Last Active: {new Date(session.deviceInfo.lastActive).toLocaleString()}</span>
          </div>
          <button onClick={() => handleLogoutSession(session.id)}>
            Logout
          </button>
        </div>
      ))}
    </div>
  );
}
```

## API Reference

### Core Methods

#### `switchUser(userId: string)`
Switches the active user to the specified user ID.

```typescript
const { switchUser } = useOxy();
await switchUser('user123');
```

#### `removeUser(userId: string)`
Removes a user from the authenticated users list and logs them out.

```typescript
const { removeUser } = useOxy();
await removeUser('user123');
```

#### `getUserSessions(userId?: string)`
Retrieves active sessions for the specified user (or current user if not specified).

```typescript
const { getUserSessions } = useOxy();
const sessions = await getUserSessions(); // Current user's sessions
const otherSessions = await getUserSessions('user123'); // Specific user's sessions
```

#### `logoutSession(sessionId: string, userId?: string)`
Logs out from a specific session.

```typescript
const { logoutSession } = useOxy();
await logoutSession('session123');
```

#### `logoutAll()`
Logs out from all authenticated accounts.

```typescript
const { logoutAll } = useOxy();
await logoutAll();
```

### Navigation Methods

#### `showBottomSheet(screen: string)`
Opens the bottom sheet with the specified screen.

Available screens:
- `'SignIn'` - Sign in/up screen (auto-switches to "Add Account" mode when authenticated)
- `'AccountSwitcher'` - Account switcher interface
- `'SessionManagement'` - Session management interface
- `'AccountCenter'` - Account settings and management

```typescript
const { showBottomSheet } = useOxy();
showBottomSheet('AccountSwitcher');
```

## Data Models

### AuthenticatedUser
```typescript
interface AuthenticatedUser extends User {
  accessToken: string;
  refreshToken?: string;
  sessionId?: string;
}
```

### SessionData
```typescript
interface SessionData {
  id: string;
  deviceInfo: {
    deviceType: string;
    platform: string;
    browser?: string;
    os?: string;
    ipAddress: string;
    lastActive: Date;
  };
  createdAt: Date;
  isCurrent: boolean;
}
```

## Security Considerations

### Token Management
- Tokens are stored securely in platform-appropriate storage (AsyncStorage on React Native, localStorage on web)
- Refresh tokens are used to maintain long-term sessions
- Expired tokens are automatically cleaned up

### Session Security
- Each session tracks device information for security monitoring
- Sessions can be remotely terminated for security purposes
- IP address tracking helps identify suspicious activity

### Data Protection
- User data is kept separate for each authenticated account
- Storage keys use unique prefixes to prevent conflicts
- Sensitive data is not logged or exposed

## Best Practices

### User Experience
1. **Clear Visual Indicators:** Always show which account is currently active
2. **Easy Switching:** Provide quick access to account switching
3. **Session Awareness:** Show users their active sessions and allow management
4. **Graceful Handling:** Handle network errors and token expiration gracefully

### Performance
1. **Lazy Loading:** Load session data only when needed
2. **Caching:** Cache user data to reduce API calls
3. **Background Updates:** Update session activity in the background
4. **Memory Management:** Clean up unused user data

### Security
1. **Regular Validation:** Periodically validate stored tokens
2. **Session Timeouts:** Implement appropriate session timeouts
3. **Secure Storage:** Use encrypted storage when available
4. **Audit Logging:** Log authentication events for security monitoring

## Troubleshooting

### Common Issues

#### Sessions Not Persisting
**Problem:** User sessions are lost on app restart
**Solution:** Check that the correct baseURL is configured and the backend is accessible

#### Token Validation Failures
**Problem:** Users are being logged out unexpectedly
**Solution:** Verify that the `/auth/validate` endpoint is working correctly

#### Storage Conflicts
**Problem:** Multiple apps interfering with each other
**Solution:** Use unique `storageKeyPrefix` for each app

#### Network Connectivity
**Problem:** Session operations failing due to network issues
**Solution:** Implement retry logic and offline capabilities

### Debug Mode

Enable debug logging to troubleshoot issues:

```typescript
// Add console logging for authentication events
const handleAuthStateChange = (user) => {
  if (process.env.NODE_ENV === 'development') {
    console.log('Auth state changed:', {
      user: user?.username || 'none',
      timestamp: new Date().toISOString()
    });
  }
};

<OxyProvider
  oxyServices={oxyServices}
  onAuthStateChange={handleAuthStateChange}
  // ... other props
>
```

## Migration Guide

### From Single-User to Multi-User

The library automatically migrates existing single-user authentication to the new multi-user format. No manual intervention is required.

### Legacy Token Handling

If you have existing tokens stored in a different format, you can manually migrate them:

```typescript
// Example migration function
const migrateLegacyTokens = async () => {
  const legacyToken = await AsyncStorage.getItem('legacy_access_token');
  const legacyUser = await AsyncStorage.getItem('legacy_user');
  
  if (legacyToken && legacyUser) {
    // The OxyProvider will automatically handle this migration
    // Just ensure the old keys are cleared after migration
    await AsyncStorage.removeItem('legacy_access_token');
    await AsyncStorage.removeItem('legacy_user');
  }
};
```

## Contributing

When contributing to the multi-user authentication system:

1. **Test Multi-User Scenarios:** Always test with multiple users
2. **Handle Edge Cases:** Consider scenarios like network failures, token expiration
3. **Maintain Backward Compatibility:** Ensure existing single-user setups continue to work
4. **Update Documentation:** Keep this documentation updated with any changes
5. **Security Review:** Have security-related changes reviewed by the team

## Support

For issues related to multi-user authentication:

1. Check the troubleshooting section above
2. Review the console logs for authentication events
3. Verify backend API endpoints are working correctly
4. Test with a clean app state (clear storage)
5. File an issue with detailed reproduction steps
