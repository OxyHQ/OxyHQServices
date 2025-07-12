# FollowButton State Management

The `FollowButton` component now uses Zustand for state management, ensuring that all buttons with the same user ID stay synchronized across your entire application.

## Key Features

- **Synchronized State**: All follow buttons for the same user ID update simultaneously
- **Global State Management**: Follow status is managed in Zustand store
- **Backend Synchronization**: Uses core services to sync with backend API
- **Automatic Initial Sync**: When authenticated, each button fetches follow status from the backend on mount
- **Loading States**: Individual loading states per user
- **Error Handling**: Proper error handling with toast notifications
- **Unified Hook**: Single `useFollow` hook handles both single and multiple users
- **Smart Authentication**: Shows helpful toast instead of disabling when not signed in

## Basic Usage

```tsx
import React from 'react';
import { View } from 'react-native';
import { FollowButton } from '@oxyhq/services/ui';

const UserProfile = ({ userId }: { userId: string }) => {
  return (
    <View>
      <FollowButton 
        userId={userId}
        initiallyFollowing={false}
        onFollowChange={(isFollowing) => {
          console.log(`User ${userId} is now ${isFollowing ? 'followed' : 'unfollowed'}`);
        }}
      />
    </View>
  );
};
```

## Multiple Buttons Synchronization

When you have multiple follow buttons for the same user, they automatically stay in sync:

```tsx
import React from 'react';
import { View } from 'react-native';
import { FollowButton } from '@oxyhq/services/ui';

const MainAndSuggestions = ({ mainUserId, suggestedUserIds }) => {
  // Single user hook for main profile
  const { isFollowing: isMainFollowing } = useFollow(mainUserId);
  
  // Multiple users hook for suggestions
  const { followData } = useFollow(suggestedUserIds);
  
  return (
    <View>
      {/* Main profile follow button */}
      <FollowButton userId={mainUserId} size="large" />
      {/* Suggested users */}
      {suggestedUserIds.map(userId => (
        <View key={userId}>
          <FollowButton userId={userId} size="small" />
          <Text>Status: {followData[userId]?.isFollowing ? 'Following' : 'Not Following'}</Text>
        </View>
      ))}
    </View>
  );
};
```

## Backend Synchronization

The follow functionality automatically syncs with your backend through the core services:

- **Follow**: `POST /users/:userId/follow` via `oxyServices.followUser(userId)`
- **Unfollow**: `DELETE /users/:userId/follow` via `oxyServices.unfollowUser(userId)`
- **Check Status**: `GET /users/:userId/following-status` via `oxyServices.client.get()`

All API calls are handled through the `oxyServices` instance, ensuring proper authentication and error handling.

```tsx
// The Zustand store automatically uses these core service methods:
await oxyServices.followUser(userId);    // Follow - returns { success: boolean, message: string }
await oxyServices.unfollowUser(userId);  // Unfollow - returns { success: boolean, message: string }

// You can also fetch current status from backend:
const { fetchStatus } = useFollow(userId);
await fetchStatus(); // Syncs with backend state
```

## Automatic Initial Fetch

Each `FollowButton` dispatches a fetch on mount when the user is authenticated and the follow state for that ID isn't already in the Zustand store. This keeps the button in sync with the backend even when the page first loads.

## State Structure

The follow state in Zustand follows this structure:

```typescript
interface FollowState {
  followingUsers: Record<string, boolean>;
  loadingUsers: Record<string, boolean>;
  fetchingUsers: Record<string, boolean>;
  errors: Record<string, string | null>;
}
```

## Best Practices

1. **Shared State**: All follow buttons with the same user ID automatically share state
2. **Backend Sync**: State changes are immediately synced with the backend via core services
3. **Error Handling**: Handle errors gracefully in your UI using the provided error states
4. **Loading States**: Always show loading indicators during API calls
5. **Single Hook**: Use the same `useFollow` hook for both single and multiple user scenarios

### From Local State
```tsx
// ❌ Old way with local state
const [isFollowing, setIsFollowing] = useState(false);

// ✅ New way with Zustand
const { isFollowing } = useFollow(userId);
```

### From Multiple Hooks
```tsx
// ❌ Old way with separate hooks
const user1 = useFollow(userId1);
const user2 = useFollow(userId2);

// ✅ New way with unified hook
const { followData } = useFollow([userId1, userId2]);
const user1Data = followData[userId1];
const user2Data = followData[userId2];
```

The unified Zustand implementation ensures that your follow buttons stay perfectly synchronized across your entire application while providing seamless backend integration through the core services. 