# Authentication Retry System

## Overview

OxyServices v5.10.13+ includes an intelligent authentication retry system that automatically handles timing issues when API calls are made before authentication completes. This eliminates the need for consumer applications to implement complex authentication state checking.

## Problem Solved

Previously, if your app called authentication-required methods like `getProfileRecommendations()` immediately on component mount, you would get 401 errors because the authentication process hadn't completed yet. This required complex workarounds in every consumer application.

## Solution

The library now automatically:
1. **Waits for authentication** - When a method requiring auth is called, it waits up to 5 seconds for authentication to complete
2. **Retries on auth errors** - If the first attempt fails due to authentication issues, it retries up to 2 more times
3. **Provides clear error messages** - Uses specific error types to distinguish authentication issues from other errors

## Affected Methods

The following methods now use automatic authentication retry:

- `getProfileRecommendations()` 
- `getCurrentUser()`
- `getNotifications()`
- All other authentication-required methods will be updated in future versions

## Usage

### Before (Required Complex Logic)
```typescript
// ❌ This pattern is no longer needed
const { oxyServices, isAuthenticated } = useOxy();

useEffect(() => {
  if (!isAuthenticated) return; // Had to check this manually
  
  const fetchRecommendations = async () => {
    try {
      const recommendations = await oxyServices.getProfileRecommendations();
      setRecommendations(recommendations);
    } catch (error) {
      console.error('Error:', error);
    }
  };
  
  fetchRecommendations();
}, [isAuthenticated]); // Had to depend on auth state
```

### After (Simple and Clean)
```typescript
// ✅ Now works automatically - no authentication checking needed
const { oxyServices } = useOxy();

useEffect(() => {
  const fetchRecommendations = async () => {
    try {
      // This will automatically wait for auth and retry if needed
      const recommendations = await oxyServices.getProfileRecommendations();
      setRecommendations(recommendations);
    } catch (error) {
      if (error instanceof OxyAuthenticationTimeoutError) {
        console.log('User needs to log in');
      } else {
        console.error('Other error:', error);
      }
    }
  };
  
  fetchRecommendations();
}, []); // Simple dependency array
```

## Error Types

### `OxyAuthenticationError`
Base class for authentication-related errors.

```typescript
import { OxyAuthenticationError } from '@oxyhq/services';

try {
  await oxyServices.getProfileRecommendations();
} catch (error) {
  if (error instanceof OxyAuthenticationError) {
    // Handle auth-specific errors
    console.log('Auth error:', error.message, error.code);
  }
}
```

### `OxyAuthenticationTimeoutError`
Thrown when authentication doesn't complete within the timeout period (default: 5 seconds).

```typescript
import { OxyAuthenticationTimeoutError } from '@oxyhq/services';

try {
  await oxyServices.getProfileRecommendations();
} catch (error) {
  if (error instanceof OxyAuthenticationTimeoutError) {
    // Show login prompt to user
    showLoginScreen();
  }
}
```

## Public Utility Methods

### `hasValidToken()`
Check if the client currently has a valid access token:

```typescript
const oxy = new OxyServices({ baseURL: 'https://api.example.com' });

if (oxy.hasValidToken()) {
  console.log('Ready to make authenticated requests');
} else {
  console.log('User needs to authenticate');
}
```

### `waitForAuth(timeoutMs?)`
Manually wait for authentication to complete:

```typescript
const oxy = new OxyServices({ baseURL: 'https://api.example.com' });

// Wait up to 10 seconds for authentication
const authReady = await oxy.waitForAuth(10000);

if (authReady) {
  console.log('Authentication ready!');
  const user = await oxy.getCurrentUser();
} else {
  console.log('Authentication timeout - user should log in');
}
```

## Configuration

The retry system can be configured by modifying the `withAuthRetry` options (this is internal, but shows the defaults):

```typescript
// Default configuration (internal)
{
  maxRetries: 2,        // Retry up to 2 times after initial failure
  retryDelay: 1000,     // Wait 1 second between retries
  authTimeoutMs: 5000   // Wait up to 5 seconds for initial authentication
}
```

## Benefits

1. **Zero Breaking Changes** - Existing code continues to work
2. **Automatic Handling** - No need for complex authentication state management
3. **Better UX** - Methods "just work" when called, even during app startup
4. **Clear Error Types** - Easy to distinguish authentication issues from other errors
5. **Production Ready** - Intelligent retry logic with timeouts and backoff

## Migration

No migration is required! This is a backward-compatible enhancement. Your existing code will automatically benefit from the new retry system.

If you have existing authentication state checking, you can optionally remove it for cleaner code, but it won't break anything if you leave it in place.

## Console Output

The system provides helpful console logs during development:

```
🔄 getProfileRecommendations - Waiting for authentication...
✅ getProfileRecommendations - Authentication ready, proceeding...
```

Or in case of retries:

```
🔄 getProfileRecommendations - Auth error on attempt 1, retrying in 1000ms...
✅ getProfileRecommendations - Authentication ready, proceeding...
```
