# FollowButton with Redux

The `FollowButton` component now uses Redux for state management, ensuring that all buttons with the same user ID stay synchronized across your entire application.

## Key Features

- **Synchronized State**: All follow buttons for the same user ID update simultaneously
- **Global State Management**: Follow status is managed in Redux store
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

const UserFeed = () => {
  const userId = "123";
  
  return (
    <View>
      {/* Header follow button */}
      <FollowButton userId={userId} size="large" />
      
      {/* Post follow button */}
      <FollowButton userId={userId} size="small" />
      
      {/* Sidebar follow button */}
      <FollowButton userId={userId} size="medium" />
      
      {/* All buttons will update simultaneously when any one is clicked */}
    </View>
  );
};
```

## Using the useFollow Hook for Single User

For more advanced use cases, you can use the `useFollow` hook directly with a single user:

```tsx
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useFollow } from '@oxyhq/services/ui';

const CustomFollowComponent = ({ userId }: { userId: string }) => {
  const { 
    isFollowing, 
    isLoading, 
    error, 
    toggleFollow,
    setFollowStatus,
    clearError 
  } = useFollow(userId);

  const handleToggleFollow = async () => {
    try {
      await toggleFollow();
    } catch (error) {
      console.error('Failed to toggle follow:', error);
    }
  };

  return (
    <View>
      <TouchableOpacity onPress={handleToggleFollow} disabled={isLoading}>
        <Text>
          {isLoading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
        </Text>
      </TouchableOpacity>
      
      {error && (
        <Text style={{ color: 'red' }}>
          {error}
        </Text>
      )}
    </View>
  );
};
```

## Using useFollow for Multiple Users

The same hook can handle multiple users by passing an array of user IDs:

```tsx
import React from 'react';
import { View, FlatList, TouchableOpacity, Text } from 'react-native';
import { useFollow } from '@oxyhq/services/ui';

const UserList = ({ userIds }: { userIds: string[] }) => {
  const {
    followData,
    toggleFollowForUser,
    setFollowStatusForUser,
    clearErrorForUser,
    isAnyLoading,
    hasAnyError
  } = useFollow(userIds);

  const renderUser = ({ item: userId }: { item: string }) => {
    const { isFollowing, isLoading, error } = followData[userId];
    
    const handleToggle = async () => {
      try {
        await toggleFollowForUser(userId);
      } catch (error) {
        console.error(`Failed to toggle follow for user ${userId}:`, error);
      }
    };
    
    return (
      <View>
        <TouchableOpacity onPress={handleToggle} disabled={isLoading}>
          <Text>
            {isLoading ? 'Loading...' : isFollowing ? 'Unfollow' : 'Follow'}
          </Text>
        </TouchableOpacity>
        {error && <Text style={{ color: 'red' }}>{error}</Text>}
      </View>
    );
  };

  return (
    <View>
      {hasAnyError && <Text>Some operations failed</Text>}
      {isAnyLoading && <Text>Loading...</Text>}
      <FlatList
        data={userIds}
        renderItem={renderUser}
        keyExtractor={(userId) => userId}
      />
    </View>
  );
};
```

## Mixed Usage - Single and Multiple

You can even mix both approaches in the same component:

```tsx
import React from 'react';
import { View } from 'react-native';
import { FollowButton, useFollow } from '@oxyhq/services/ui';

const ProfileWithSuggestions = ({ 
  mainUserId, 
  suggestedUserIds 
}: { 
  mainUserId: string;
  suggestedUserIds: string[];
}) => {
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
// The Redux thunk automatically uses these core service methods:
await oxyServices.followUser(userId);    // Follow - returns { success: boolean, message: string }
await oxyServices.unfollowUser(userId);  // Unfollow - returns { success: boolean, message: string }

// You can also fetch current status from backend:
const { fetchStatus } = useFollow(userId);
await fetchStatus(); // Syncs with backend state
```

## Automatic Initial Fetch

Each `FollowButton` dispatches `fetchFollowStatus` on mount when the user is authenticated and the follow state for that ID isn't already in the Redux store. This keeps the button in sync with the backend even when the page first loads.

## State Structure

The follow state in Redux follows this structure:

```typescript
interface FollowState {
  // Track follow status for each user ID
  followingUsers: Record<string, boolean>;
  // Track loading state for each user ID  
  loadingUsers: Record<string, boolean>;
  // Track any follow/unfollow errors
  errors: Record<string, string | null>;
}
```

## Hook Return Types

### Single User Mode
```typescript
const {
  isFollowing: boolean;
  isLoading: boolean;
  error: string | null;
  toggleFollow: () => Promise<any>;
  setFollowStatus: (following: boolean) => void;
  fetchStatus: () => Promise<void>;  // Fetch from backend
  clearError: () => void;
} = useFollow(userId);
```

### Multiple Users Mode
```typescript
const {
  followData: Record<string, { isFollowing: boolean; isLoading: boolean; error: string | null }>;
  toggleFollowForUser: (userId: string) => Promise<any>;
  setFollowStatusForUser: (userId: string, following: boolean) => void;
  fetchStatusForUser: (userId: string) => Promise<void>;  // Fetch single user from backend
  fetchAllStatuses: () => Promise<void>;  // Fetch all users from backend
  clearErrorForUser: (userId: string) => void;
  isAnyLoading: boolean;
  hasAnyError: boolean;
  allFollowing: boolean;
  allNotFollowing: boolean;
} = useFollow(userIds);
```

## Error Handling

Errors are automatically handled and displayed via toast notifications. The backend errors are properly parsed and displayed:

```tsx
// Backend error response is automatically parsed
const errorMessage = error?.response?.data?.message || error?.message || 'Failed to update follow status';
```

## Authentication Handling

When users are not signed in, the follow button shows a helpful toast message instead of being disabled:

```tsx
// User clicks follow button while not authenticated
// Shows: "Please sign in to follow users" toast
// Button remains clickable for better UX
```

This provides better user experience by:
- Keeping the button visually active and clickable
- Providing clear feedback about what action is needed
- Avoiding confusing disabled states

## Best Practices

1. **Shared State**: All follow buttons with the same user ID automatically share state
2. **Backend Sync**: State changes are immediately synced with the backend via core services
3. **Error Handling**: Handle errors gracefully in your UI using the provided error states
4. **Loading States**: Always show loading indicators during API calls
5. **Single Hook**: Use the same `useFollow` hook for both single and multiple user scenarios

## Migration Guide

### From Local State
```tsx
// ❌ Old way with local state
const [isFollowing, setIsFollowing] = useState(false);

// ✅ New way with Redux
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

The unified Redux implementation ensures that your follow buttons stay perfectly synchronized across your entire application while providing seamless backend integration through the core services. 