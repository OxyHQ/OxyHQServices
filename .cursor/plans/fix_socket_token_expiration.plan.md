# Fix Socket Token Expiration Handling

## Problem

Socket authentication fails when JWT token expires, causing connection errors. The socket middleware rejects expired tokens, but the client doesn't refresh tokens before connecting or handle auth errors gracefully.

## Root Cause

1. **Server-side**: Socket authentication middleware rejects expired tokens without providing a way to refresh
2. **Client-side**: Socket hook doesn't check token expiration before connecting
3. **Client-side**: Socket hook doesn't refresh tokens when disconnected due to auth errors
4. **Client-side**: No automatic reconnection with refreshed token after expiration

## Solution

### 1. Server-side: Better Error Handling
- Distinguish between expired tokens and invalid tokens
- Provide more specific error messages for expired tokens
- Allow graceful handling (though still reject expired tokens for security)

### 2. Client-side: Proactive Token Refresh
- Check if token is expiring soon before creating socket connection
- Refresh token if needed before connecting
- Use `tokenService.refreshTokenIfNeeded()` before socket creation

### 3. Client-side: Handle Auth Errors
- Listen for `connect_error` events
- If error is due to expired token, refresh and reconnect
- Handle disconnect events and check if reconnection is needed

### 4. Client-side: Periodic Token Refresh
- Monitor token expiration and refresh proactively
- Reconnect socket with fresh token when token is refreshed

## Implementation Steps

1. Update socket hook to refresh token before connecting
2. Add connect_error handler to detect auth failures
3. Add logic to refresh token and reconnect on auth errors
4. Update server-side to provide better error messages (optional, for debugging)

## Files to Modify

1. `packages/services/src/ui/hooks/useSessionSocket.ts` - Add token refresh before connection and on auth errors
2. `packages/api/src/server.ts` - Improve error handling for expired tokens (optional)

