# Token Storage Fix

## Problem
User was authenticated but tokens were not being persisted properly, causing the error:
```
[OxyStore] User is authenticated but no tokens found. This might be a storage issue.
```

## Root Cause
1. **Timing Issue**: During login, tokens were set in OxyServices memory but the Zustand store was trying to read them before they were fully set
2. **Null Overwriting**: The `setUser` method was overwriting existing valid tokens with `null` values when called without explicit tokens
3. **No Recovery Mechanism**: When tokens were lost from storage, there was no automatic recovery system

## Fixes Implemented

### 1. Fixed Login Token Capture
**File**: `packages/services/src/stores/authStore.ts`
- Added a 100ms delay after login to ensure tokens are set in OxyServices
- Added validation to warn when no access token is found after login
- Improved token capture logic

### 2. Prevented Token Overwriting
**File**: `packages/services/src/stores/authStore.ts`
- Modified `setUser` method to only update tokens when explicitly provided (not null/undefined)
- This prevents accidentally clearing valid tokens when updating user data

### 3. Added Token Recovery System
**File**: `packages/services/src/stores/index.ts`
- Added automatic token recovery when user is authenticated but tokens are missing
- Uses user ID as session ID to attempt token recovery from the server
- Runs with a 1-second delay to ensure proper initialization

### 4. Added Manual Token Sync
**File**: `packages/services/src/stores/authStore.ts`
- Added `syncTokens()` method to manually synchronize tokens from OxyServices to the store
- Exposed through the `useAuth()` hook for manual recovery

## How to Test

### 1. Login and Check Storage
```javascript
import { useAuth } from '@oxyhq/services';

// In your component
const { login, user, syncTokens } = useAuth();

// Login
await login('username', 'password');

// Check localStorage
console.log('Storage:', localStorage.getItem('oxy-auth'));
```

### 2. Test Token Persistence
1. Login to your app
2. Refresh the page
3. Check console logs - you should see:
   ```
   [OxyStore] Restoring tokens to OxyServices
   ```
   instead of:
   ```
   [OxyStore] User is authenticated but no tokens found
   ```

### 3. Manual Token Recovery
```javascript
// If tokens are ever out of sync, you can manually sync them:
const { syncTokens } = useAuth();
syncTokens(); // This will sync tokens from OxyServices to the store
```

## Expected Console Logs (After Fix)

### Successful Login:
```
[AuthStore] Login completed, tokens from OxyServices: {hasAccessToken: true, hasRefreshToken: true, ...}
[OxyStore] Partializing state for persistence: {hasUser: true, hasAccessToken: true, hasRefreshToken: true, ...}
```

### Successful Page Refresh:
```
[OxyStore] Rehydrating from storage: {hasUser: true, hasAccessToken: true, hasRefreshToken: true, ...}
[OxyStore] Restoring tokens to OxyServices
```

### Token Recovery (if needed):
```
[OxyStore] Attempting token recovery for user: user-id
[OxyStore] Token recovery successful: true
[OxyStore] Tokens restored successfully
```

## Breaking Changes
None - all changes are backward compatible.

## Additional Notes
- The fix handles both secure login and regular login flows
- Token recovery attempts use the user ID as session ID (common pattern in your API)
- All changes include comprehensive logging for debugging
- The `syncTokens()` method can be used for manual token recovery in edge cases 