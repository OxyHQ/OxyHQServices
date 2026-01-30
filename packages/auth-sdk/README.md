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
