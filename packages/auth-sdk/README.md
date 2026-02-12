# @oxyhq/auth

OxyHQ Web Auth SDK. Headless React hooks for web applications. Zero React Native or Expo dependencies.

## Installation

```bash
npm install @oxyhq/auth
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
