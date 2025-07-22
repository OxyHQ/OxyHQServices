# Migration Guide: User Model v2.1.0

This guide helps you migrate from the previous User model to the simplified v2.1.0 schema.

## Overview

The User model has been simplified by removing non-essential fields while keeping core functionality intact. This improves performance, maintainability, and reduces complexity.

## Removed Fields

The following fields have been removed from the User schema:

| Removed Field | Alternative/Migration |
|---------------|----------------------|
| `coverPhoto` | Use external profile management or re-implement as needed |
| `location` | Store in separate ProfileExtended collection if needed |
| `website` | Store in separate ProfileExtended collection if needed |
| `links[]` | Store in separate ProfileExtended collection if needed |
| `labels[]` | Use tags in posts/content instead of user labels |
| `associated.lists` | Remove - not core to user identity |
| `associated.feedgens` | Remove - not core to user identity |
| `associated.starterPacks` | Remove - not core to user identity |
| `associated.labeler` | Remove - not core to user identity |
| `pinnedPost` | Implement in posts collection with user reference |
| `pinnedPosts[]` | Implement in posts collection with user reference |
| `_count.posts` | Calculate dynamically from posts collection |
| `_count.karma` | Calculate dynamically from karma collection |

## Kept Fields

These essential fields remain in the User model:

| Field | Purpose |
|-------|---------|
| `username`, `email`, `password` | Core authentication |
| `name.first`, `name.last` | Display name |
| `avatar.id`, `avatar.url` | Profile picture |
| `bio`, `description` | Basic profile information |
| `privacySettings` | Complete privacy control system |
| `_count.followers`, `_count.following` | Core social metrics |
| `following[]`, `followers[]` | Social relationships |

## Migration Steps

### 1. Database Migration (Optional)

If you have existing data, you can clean up the removed fields:

```javascript
// MongoDB shell script to clean up removed fields
db.users.updateMany({}, {
  $unset: {
    "coverPhoto": "",
    "location": "",
    "website": "",
    "links": "",
    "labels": "",
    "associated": "",
    "pinnedPost": "",
    "pinnedPosts": "",
    "_count.posts": "",
    "_count.karma": ""
  }
});

console.log("User schema cleanup completed");
```

### 2. Code Migration

Update your application code:

```typescript
// OLD - Manual user creation with all fields
const user = new User({
  username,
  email,
  password: hashedPassword,
  name: { first: "", last: "" },
  privacySettings: { /* all defaults manually */ },
  associated: { lists: 0, feedgens: 0, /* ... */ },
  labels: [],
  _count: { followers: 0, following: 0, posts: 0, karma: 0 }
});

// NEW - Simple user creation with schema defaults
const user = new User({
  username,
  email,
  password: hashedPassword
});
// Schema automatically applies all defaults
```

### 3. API Client Updates

Update API consumers to use the new response format:

```typescript
// OLD response structure
interface OldUser {
  id: string;
  username: string;
  email: string;
  coverPhoto?: string;
  location?: string;
  website?: string;
  labels?: string[];
  associated?: {
    lists: number;
    feedgens: number;
    starterPacks: number;
    labeler: boolean;
  };
}

// NEW response structure
interface User {
  id: string;
  username: string;
  email: string;
  name: {
    first: string;
    last: string;
    full: string; // virtual field
  };
  avatar: {
    id: string;
    url: string;
  };
  bio?: string;
  description?: string;
  privacySettings: {
    // ... all privacy settings
  };
  _count: {
    followers: number;
    following: number;
  };
}
```

### 4. Feature Replacement

If you were using removed fields, here are alternatives:

```typescript
// Pinned posts - implement in posts collection
interface Post {
  userId: string;
  isPinned: boolean;
  // ... other fields
}

// User labels - use post tags instead
interface Post {
  tags: string[];
  // ... other fields
}

// Extended profile info - separate collection
interface ProfileExtended {
  userId: string;
  website?: string;
  location?: string;
  links?: Array<{
    title: string;
    url: string;
  }>;
}
```

## Benefits

After migration, you'll have:

- ✅ **Simpler user model** - focused on core features
- ✅ **Better performance** - fewer fields to process
- ✅ **Improved maintainability** - single source of truth for defaults
- ✅ **Type safety** - better TypeScript support
- ✅ **Reduced complexity** - cleaner API responses

## Support

If you encounter issues during migration:

1. Check the [API Reference](./api-reference.md) for updated field structures
2. Review the [User Schema](./api-reference.md#user-schema) section
3. Test with the updated endpoints in [Quick Start](./quick-start.md)

The migration is backward compatible - old API clients will continue to work, they just won't receive the removed fields in responses.
