# Oxy Quick Reference

Quick reference guide for common Oxy operations.

## Installation

```bash
npm install @oxyhq/services
```

## React Native Setup

```javascript
// index.js (first line)
import 'react-native-url-polyfill/auto';

// App.tsx
import { OxyProvider } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

## Common Operations

### Authentication

```typescript
const { login, logout, isAuthenticated, user } = useOxy();

// Login
await login('username', 'password');

// Logout
await logout();

// Check auth
if (isAuthenticated) {
  console.log('User:', user?.name);
}
```

### Get User Data

```typescript
const { oxyServices } = useOxy();

// Current user
const user = await oxyServices.getCurrentUser();

// User by ID
const user = await oxyServices.getUserById('user123');

// Profile by username
const profile = await oxyServices.getProfileByUsername('johndoe');
```

### Update Profile

```typescript
await oxyServices.updateProfile({
  name: 'John Doe',
  bio: 'Software developer',
  avatar: 'file_id_here'
});
```

### Follow/Unfollow

```typescript
// Follow
await oxyServices.followUser('user123');

// Unfollow
await oxyServices.unfollowUser('user123');

// Check status
const { isFollowing } = await oxyServices.getFollowStatus('user123');
```

### Upload File

```typescript
const file = new File([blob], 'image.jpg', { type: 'image/jpeg' });
const uploaded = await oxyServices.uploadRawFile(file, 'public');
const fileId = uploaded.file.id;
```

### Get File URL

```typescript
// Download URL (with auth token)
const url = oxyServices.getFileDownloadUrl('file123', 'thumb');

// Stream URL (CDN, no auth)
const url = oxyServices.getFileStreamUrl('file123');
```

### Notifications

```typescript
// Get notifications
const notifications = await oxyServices.getNotifications();

// Unread count
const count = await oxyServices.getUnreadCount();

// Mark as read
await oxyServices.markNotificationAsRead('notification123');
await oxyServices.markAllNotificationsAsRead();
```

### Privacy

```typescript
// Block user
await oxyServices.blockUser('user123');
const blocked = await oxyServices.getBlockedUsers();

// Restrict user
await oxyServices.restrictUser('user123');
const restricted = await oxyServices.getRestrictedUsers();

// Check status
const isBlocked = await oxyServices.isUserBlocked('user123');
const isRestricted = await oxyServices.isUserRestricted('user123');
```

### Error Handling

```typescript
import { OxyAuthenticationError } from '@oxyhq/services';

try {
  await oxyServices.getCurrentUser();
} catch (error) {
  if (error instanceof OxyAuthenticationError) {
    // Handle auth error
  } else {
    // Handle other error
  }
}
```

## Node.js / Express

```typescript
import { oxyClient } from '@oxyhq/services';
import express from 'express';

const app = express();

// Auth endpoint
app.post('/api/auth/signin', async (req, res) => {
  const { username, password } = req.body;
  const session = await oxyClient.signIn(username, password);
  res.json(session);
});

// Protected route
app.use('/api/protected', oxyClient.auth());

app.get('/api/protected/user', (req: any, res) => {
  res.json({ user: req.user });
});
```

## TypeScript Types

```typescript
import type { User, Notification, BlockedUser, RestrictedUser } from '@oxyhq/services';
```

## Common Patterns

### Loading State

```typescript
const [loading, setLoading] = useState(false);

const handleAction = async () => {
  setLoading(true);
  try {
    await oxyServices.someAction();
  } finally {
    setLoading(false);
  }
};
```

### Fetch with Error Handling

```typescript
const fetchData = async () => {
  try {
    const data = await oxyServices.getData();
    return data;
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  }
};
```

## Links

- [Full Documentation](../README.md)
- [Getting Started](./GETTING_STARTED.md)
- [API Reference](./API_REFERENCE.md)
- [Examples](./EXAMPLES.md)

