# OxyHQ SDK Platform Guide

Guide for using the OxyHQ SDK across different platforms and environments.

The SDK is split into three packages with clear responsibilities:

- **@oxyhq/core** -- Platform-agnostic foundation: OxyServices, types, crypto utilities, shared helpers.
- **@oxyhq/auth** -- Web authentication: WebOxyProvider, auth hooks, FedCM/popup/redirect flows. React web only.
- **@oxyhq/services** -- Expo/React Native UI: OxyProvider, screens, components, bottom sheet, fonts.

## Quick Reference

| Platform | Packages | Provider | Notes |
|----------|----------|----------|-------|
| **Expo / React Native** | `@oxyhq/services` + `@oxyhq/core` | `OxyProvider` | Full UI, components, screens |
| **Vite / React** | `@oxyhq/auth` + `@oxyhq/core` | `WebOxyProvider` | Web auth, no RN dependencies |
| **Next.js** | `@oxyhq/auth` + `@oxyhq/core` | `WebOxyProvider` | Web auth, SSR compatible |
| **Node.js / Backend** | `@oxyhq/core` | N/A | API client only, no React |

## Package Details

### @oxyhq/core

Platform-agnostic package. Use everywhere.

**Provides:**
- `OxyServices` class with all API methods
- `oxyClient` pre-configured instance
- All TypeScript types and interfaces
- `KeyManager`, `SignatureService`, `RecoveryPhraseService` (crypto)
- Shared utilities (`OXY_CLOUD_URL`, error classes, helpers)

**Install:**
```bash
npm install @oxyhq/core
```

**Example:**
```typescript
import { OxyServices, oxyClient } from '@oxyhq/core';
import type { User, Session } from '@oxyhq/core';

// Use the pre-configured client
const user = await oxyClient.getUserById('123');

// Or create a custom instance
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
const session = await oxy.signIn(username, password);
```

---

### @oxyhq/auth

Web authentication package. For React web apps (Vite, Next.js, CRA) without Expo.

**Provides:**
- `WebOxyProvider` component
- `useAuth` hook (FedCM, popup, redirect sign-in)
- Web-specific auth stores and utilities

**Install:**
```bash
npm install @oxyhq/auth @oxyhq/core
```

**Example:**
```typescript
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}

function LoginPage() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();

  if (isAuthenticated) {
    return <p>Welcome, {user?.username}!</p>;
  }

  return <button onClick={() => signIn()}>Sign In</button>;
}
```

---

### @oxyhq/services

Expo and React Native UI package. For mobile and Expo web apps.

**Provides:**
- `OxyProvider` (universal provider for iOS, Android, Expo web)
- `useOxy`, `useAuth` hooks
- UI components (`OxySignInButton`, `Avatar`, `FollowButton`, `OxyLogo`)
- Bottom sheet routing system with 25+ screens
- Inter font family with automatic loading
- i18n language selection

**Install:**
```bash
npm install @oxyhq/services @oxyhq/core
```

**Peer dependencies (Expo):**
```bash
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-svg \
  expo expo-font expo-image expo-linear-gradient \
  @react-navigation/native @tanstack/react-query
```

**Example:**
```typescript
import { OxyProvider, useAuth, OxySignInButton } from '@oxyhq/services';
import type { User } from '@oxyhq/core';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

---

## Platform-Specific Setup

### Expo / React Native

**Install:**
```bash
npm install @oxyhq/services @oxyhq/core
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-svg
```

**Entry file setup:**
```javascript
// index.js or App.js (first line)
import 'react-native-url-polyfill/auto';
```

**App setup:**
```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

Works on iOS, Android, and Expo web.

---

### Vite (React Web)

**Install:**
```bash
npm install @oxyhq/auth @oxyhq/core
```

**Usage:**
```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}
```

No bundler configuration required. No react-native-web dependency.

---

### Next.js

**Install:**
```bash
npm install @oxyhq/auth @oxyhq/core
```

**Usage:**
```tsx
// app/providers.tsx
'use client';
import { WebOxyProvider } from '@oxyhq/auth';

export function Providers({ children }) {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      {children}
    </WebOxyProvider>
  );
}

// app/layout.tsx
import { Providers } from './providers';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

No bundler configuration required.

---

### Node.js (Backend)

**Install:**
```bash
npm install @oxyhq/core
```

**Usage:**
```typescript
import { OxyServices, oxyClient } from '@oxyhq/core';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const session = await oxyClient.signIn(username, password);
    res.json(session);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.listen(3000);
```

---

## Import Patterns

Each package has a single entry point. There are no sub-path imports.

```typescript
// Expo / React Native
import { OxyProvider, useOxy, useAuth, Avatar } from '@oxyhq/services';
import { OxyServices, oxyClient } from '@oxyhq/core';
import type { User, Session } from '@oxyhq/core';

// Web (Vite, Next.js, CRA)
import { WebOxyProvider, useAuth } from '@oxyhq/auth';
import { OxyServices, oxyClient } from '@oxyhq/core';
import type { User, Session } from '@oxyhq/core';

// Node.js backend
import { OxyServices, oxyClient, KeyManager } from '@oxyhq/core';
import type { User, Session } from '@oxyhq/core';
```

---

## Best Practices

1. **Use @oxyhq/core for types everywhere.** All shared types, interfaces, and the OxyServices class live in @oxyhq/core.
2. **Use @oxyhq/auth for web apps.** It has no React Native dependencies, resulting in smaller bundles and zero bundler configuration.
3. **Use @oxyhq/services for Expo/RN only.** It includes React Native UI components that require native dependencies.
4. **Use @oxyhq/core alone for backends.** No React or UI dependencies are pulled in.
5. **Do not mix @oxyhq/auth and @oxyhq/services.** Pick one based on your platform. Both depend on @oxyhq/core for shared functionality.

---

## Troubleshooting

### Module not found errors on web

**Problem:** Importing from `@oxyhq/services` in a web-only app.

**Solution:** Use `@oxyhq/auth` for web apps. The `@oxyhq/services` package requires React Native dependencies.

### Types not available

**Problem:** Cannot find type definitions.

**Solution:** Install `@oxyhq/core`. All shared types are exported from this package.

### Bundle size too large on web

**Problem:** Web bundle includes React Native code.

**Solution:** Ensure you are importing from `@oxyhq/auth`, not `@oxyhq/services`.

### OxyProvider not found

**Problem:** Cannot import `OxyProvider`.

**Solution:** `OxyProvider` is in `@oxyhq/services` (Expo/RN). For web, use `WebOxyProvider` from `@oxyhq/auth`.

---

## Summary

| Package | Use Case | Key Exports |
|---------|----------|-------------|
| `@oxyhq/core` | All platforms | `OxyServices`, `oxyClient`, types, crypto |
| `@oxyhq/auth` | Web apps (React) | `WebOxyProvider`, `useAuth` |
| `@oxyhq/services` | Expo / React Native | `OxyProvider`, `useOxy`, UI components, screens |
