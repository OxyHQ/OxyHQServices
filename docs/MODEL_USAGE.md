# Using OxyHQ Services Models in Your Application

This document explains how to use the data models exported by the `@oxyhq/services` package in your applications.

## Available Models

The `@oxyhq/services` package exports TypeScript interfaces that define the shape of objects returned by the API. These interfaces can be used to ensure type safety in your application.

## Importing Models

There are two ways to import models from the package:

### 1. Direct Import

Import specific models directly from the package:

```typescript
import { 
  User, 
  LoginResponse, 
  Notification,
  Transaction,
  Wallet
} from '@oxyhq/services';

// Using a model in a component
const UserProfile = ({ user }: { user: User }) => {
  return (
    <div>
      <h1>{user.name?.full || user.username}</h1>
      {user.bio && <p>{user.bio}</p>}
    </div>
  );
};
```

### 2. Namespace Import

Import all models under a namespace:

```typescript
import { Models } from '@oxyhq/services';

// Using a model from the namespace
const ProfileRecommendation = ({ 
  recommendation 
}: { 
  recommendation: Models.User 
}) => {
  return (
    <div>
      <h2>{recommendation.name?.full || recommendation.username}</h2>
      <span>{recommendation._count?.followers || 0} followers</span>
    </div>
  );
};
```

## Key Model Interfaces

### OxyConfig

Configuration for initializing the OxyServices client.

```typescript
interface OxyConfig {
  baseURL: string;
}
```

### User

Represents a user in the system.

```typescript
interface User {
  id: string;
  username: string;
  email?: string;
  avatar?: {
    id?: string;
    url?: string;
    [key: string]: any;
  };
  name?: {
    first?: string;
    last?: string;
    full?: string;
    [key: string]: any;
  };
  bio?: string;
  karma?: number;
  // Additional fields may be available
}
```

### LoginResponse

Response from a successful login.

```typescript
interface LoginResponse {
  accessToken?: string;
  refreshToken?: string;
  token?: string; // For backwards compatibility
  user: User;
  message?: string;
}
```

### Profile Recommendation

Profile recommendation objects returned by the `getProfileRecommendations` method.

```typescript
interface ProfileRecommendation {
  id: string;
  username: string;
  name?: { first?: string; last?: string; full?: string };
  description?: string;
  _count?: { followers: number; following: number };
  [key: string]: any;
}
```

## Integration with UI Components

Many Oxy UI components are designed to work directly with these model interfaces. For example, the `FollowButton` component expects a `userId` that corresponds to the `id` property of a `User` object.

### Example Integration

```typescript
import React, { useState, useEffect } from 'react';
import { OxyServices, User, FollowButton } from '@oxyhq/services';

const UserList = () => {
  const [users, setUsers] = useState<User[]>([]);
  const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
  
  useEffect(() => {
    async function fetchUsers() {
      const result = await oxyServices.searchProfiles('john');
      setUsers(result);
    }
    fetchUsers();
  }, []);
  
  return (
    <div>
      {users.map(user => (
        <div key={user.id} className="user-card">
          <h2>{user.name?.full || user.username}</h2>
          {user.bio && <p>{user.bio}</p>}
          <FollowButton userId={user.id} />
        </div>
      ))}
    </div>
  );
};
```

## Type Guards

When dealing with data that might not match your expected types, type guards can be useful:

```typescript
import { User } from '@oxyhq/services';

// Type guard for User
function isUser(obj: any): obj is User {
  return obj 
    && typeof obj === 'object'
    && typeof obj.id === 'string'
    && typeof obj.username === 'string';
}

// Usage
const processData = (data: any) => {
  if (isUser(data)) {
    // TypeScript knows data is a User here
    console.log(data.username);
  } else {
    console.error('Invalid user data');
  }
};
```

For more detailed information about the available models, refer to the TypeScript definitions in the package or use your editor's IntelliSense/autocomplete features.