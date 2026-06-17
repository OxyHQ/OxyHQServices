# @oxyhq/auth

OxyHQ Web Auth SDK. Headless React hooks for web applications. Zero React Native or Expo dependencies.

**Current published version: 2.0.9**

## Installation

```bash
bun add @oxyhq/auth
```

### Peer Dependencies

- `@oxyhq/core`
- `react`

### Dependencies

- `@tanstack/react-query`
- `zustand`
- `socket.io-client`
- `sonner`

## Contents

- **WebOxyProvider** — React context provider with auth state
- **useAuth** — hook for signIn, signOut, user, isAuthenticated
- **useWebOxy** — full context access including sessions, switchSession, clearSessionState
- **Query hooks** — useCurrentUser, useUserProfile, usePrivacySettings, useSecurityActivity, and more
- **Mutation hooks** — useUpdateProfile, useUploadAvatar, useSwitchSession, useLogoutSession, and more
- **Stores** — authStore, assetStore, accountStore, followStore (zustand)
- **useSessionSocket** — zero-config real-time session sync via WebSocket
- **Session management utilities**

## Usage

```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';
import type { User } from '@oxyhq/core';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}

function YourApp() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();

  if (!isAuthenticated) {
    return <button onClick={() => signIn()}>Sign In</button>;
  }

  return <p>Welcome, {user?.name}</p>;
}
```

## Real-time Session Sync

`useSessionSocket` connects a WebSocket to the API and listens for session events (remote sign-out, device removal, etc.). It requires **zero configuration** — all auth state is pulled from `WebOxyProvider` context automatically.

```tsx
import { useSessionSocket } from '@oxyhq/auth';

function App() {
  // Zero-config — just call it
  useSessionSocket();
}
```

Optional callbacks for custom handling:

```tsx
useSessionSocket({
  onRemoteSignOut: () => router.push('/login'),
  onSessionRemoved: (sessionId) => console.log('Session removed:', sessionId),
});
```

### Migration from v1.x

v1.x required passing 8+ props manually. In v2.0 all state is derived from context:

```diff
- useSessionSocket({
-   userId, activeSessionId, currentDeviceId,
-   refreshSessions, logout, clearSessionState,
-   baseURL, getAccessToken,
- });
+ useSessionSocket();
```

## FedCM (`useWebSSO`, `WebOxyProvider`)

- Use W3C-spec `mode` values `'active'` / `'passive'`. The legacy `'button'` / `'widget'` values throw `TypeError` in current Chrome.
- **Silent SSO guard lives in consumers, NOT `@oxyhq/core`**: a core module-level singleton was tried and reverted because it re-evaluates in the Metro web bundle and the guard did not hold. `useWebSSO` owns a module-level `silentSSOAttempted` Set + `ssoSignature(origin|baseURL)` for cross-mount deduplication, plus a per-instance `hasCheckedRef` fast-path. Do NOT move this guard into a core module-level singleton.
- `WebOxyProvider` keeps its own `fedcmSilentSignInAttempted` guard (keyed `origin+baseURL`) because its silent path also runs `oxyServices.silentSignIn()` before redirect-based sign-in.
- Token exchange requires a server-minted nonce (`POST /fedcm/nonce`) — local UUID nonces are rejected.

## Offline-First Persistence

- `@tanstack/react-query-persist-client` + `createSyncStoragePersister` (localStorage); `WebOxyProvider` awaits `restored` before exposing the QueryClient.
- Query whitelist: `accounts`, `users`, `sessions`, `devices`, `privacy`, `payments`; mutations always persisted; 30-day TTL; 1s throttle.
- TanStack Query pinned to `^5.100`.
