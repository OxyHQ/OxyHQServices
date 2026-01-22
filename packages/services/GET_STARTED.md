# Getting Started with @oxyhq/services

Zero-config authentication for all Oxy apps. Just wrap with `OxyProvider` and use `useAuth`.

## Installation

```bash
npm install @oxyhq/services
```

### Peer Dependencies (React Native/Expo)

```bash
npm install react-native-reanimated react-native-gesture-handler \
  react-native-safe-area-context react-native-svg \
  expo expo-font expo-image expo-linear-gradient \
  @react-navigation/native @tanstack/react-query
```

---

## Quick Start (All Platforms)

### 1. Wrap with OxyProvider

```tsx
// app/_layout.tsx or App.tsx
import { OxyProvider } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

### 2. Use Authentication

```tsx
import { useAuth, OxySignInButton } from '@oxyhq/services';

function HomeScreen() {
  const { user, isAuthenticated, isLoading, signOut } = useAuth();

  if (isLoading) return <Loading />;

  if (!isAuthenticated) {
    return (
      <View>
        <Text>Please sign in</Text>
        <OxySignInButton />
      </View>
    );
  }

  return (
    <View>
      <Text>Welcome, {user?.username}!</Text>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

**That's it!** Cross-domain SSO is automatic. If user is signed in on any Oxy domain (accounts.oxy.so, mention.earth, homiio.com, etc.), they're automatically signed in on your app.

---

## useAuth Hook Reference

```tsx
import { useAuth } from '@oxyhq/services';

const {
  // State
  user,              // User | null - current user
  isAuthenticated,   // boolean - is user signed in
  isLoading,         // boolean - initial auth check
  isReady,           // boolean - ready for API calls
  error,             // string | null - error message

  // Actions
  signIn,            // () => Promise<User> - trigger sign in
  signOut,           // () => Promise<void> - sign out current session
  signOutAll,        // () => Promise<void> - sign out all devices
  refresh,           // () => Promise<void> - refresh auth state

  // Advanced
  oxyServices,       // OxyServices instance
} = useAuth();
```

---

## Native Apps (React Native / Expo)

### Setup Entry Point

Add polyfill at the very top of your entry file:

```javascript
// index.js or App.js (first line)
import 'react-native-url-polyfill/auto';
```

### Full Example

```tsx
// app/_layout.tsx
import 'react-native-url-polyfill/auto';
import { OxyProvider } from '@oxyhq/services';
import * as Linking from 'expo-linking';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';

export default function RootLayout() {
  return (
    <OxyProvider
      baseURL={API_URL}
      authRedirectUri={Linking.createURL('/')}
    >
      <YourApp />
    </OxyProvider>
  );
}
```

### Bottom Sheet Screens

```tsx
import { useOxy } from '@oxyhq/services';

const { showBottomSheet } = useOxy();

// Account
showBottomSheet('AccountCenter');      // Main account hub
showBottomSheet('AccountSwitcher');    // Switch accounts
showBottomSheet('SessionManagement');  // Manage devices
showBottomSheet('EditProfile');        // Edit profile

// Auth
showBottomSheet('OxyAuth');            // QR code auth

// Features
showBottomSheet('FileManagement');     // Files
showBottomSheet('LanguageSelector');   // Language
showBottomSheet('KarmaCenter');        // Karma

// Payments
showBottomSheet({ screen: 'PaymentGateway', props: { amount: 10 } });
```

---

## Web Apps (Next.js / React)

Web apps use the same `OxyProvider` and `useAuth`. SSO is automatic via hidden iframe.

### Next.js Example

```tsx
// app/providers.tsx
'use client';
import { OxyProvider } from '@oxyhq/services';

export function Providers({ children }) {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      {children}
    </OxyProvider>
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

// app/page.tsx
'use client';
import { useAuth } from '@oxyhq/services';

export default function Home() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div>Loading...</div>;

  return isAuthenticated ? (
    <h1>Welcome, {user?.username}!</h1>
  ) : (
    <a href="https://accounts.oxy.so/login">Sign In</a>
  );
}
```

### How Web SSO Works

1. User signs in on `accounts.oxy.so` (or any Oxy domain)
2. Your app's `OxyProvider` loads a hidden iframe to `auth.oxy.so/auth/silent`
3. If valid session exists, user is automatically authenticated
4. No manual setup required - it just works

---

## Backend (Node.js / Express / Next.js API)

For server-side, import from `/core` to avoid React dependencies.

### Quick Start

```typescript
import { oxyClient } from '@oxyhq/services/core';

// Get user
const user = await oxyClient.getUserById('123');

// Validate session
const { valid, user } = await oxyClient.validateSession(sessionId);
```

### Express Middleware

```typescript
import { oxyClient } from '@oxyhq/services/core';

async function authMiddleware(req, res, next) {
  const sessionId = req.headers['x-session-id'] || req.cookies.sessionId;

  if (!sessionId) {
    return res.status(401).json({ error: 'No session' });
  }

  try {
    const { valid, user } = await oxyClient.validateSession(sessionId);
    if (!valid) return res.status(401).json({ error: 'Invalid session' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Auth failed' });
  }
}

app.get('/api/me', authMiddleware, (req, res) => res.json(req.user));
```

### Next.js API Route

```typescript
// app/api/user/[id]/route.ts
import { oxyClient } from '@oxyhq/services/core';
import { NextResponse } from 'next/server';

export async function GET(req, { params }) {
  try {
    const user = await oxyClient.getUserById(params.id);
    return NextResponse.json(user);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
```

### Available Methods

```typescript
// Users
await oxyClient.getUserById(id);
await oxyClient.getUserByUsername(username);
await oxyClient.getProfileByUsername(username);
await oxyClient.getCurrentUser();

// Sessions
await oxyClient.validateSession(sessionId);
await oxyClient.logoutSession(sessionId);

// Social
await oxyClient.getUserFollowers(userId);
await oxyClient.getUserFollowing(userId);
await oxyClient.followUser(userId);
await oxyClient.unfollowUser(userId);

// Karma
await oxyClient.getKarma();
await oxyClient.getKarmaLeaderboard();

// Wallet
await oxyClient.getWallet();
await oxyClient.transferFunds(request);

// Files
await oxyClient.listFiles();
await oxyClient.uploadFile(file);
await oxyClient.deleteFile(fileId);
```

---

## Advanced: useOxy Hook

For full control, use `useOxy` instead of `useAuth`:

```tsx
import { useOxy } from '@oxyhq/services';

const {
  // All useAuth properties plus:
  sessions,            // All active sessions
  activeSessionId,     // Current session ID
  switchSession,       // Switch between accounts
  refreshSessions,     // Refresh session list

  // Language
  currentLanguage,     // 'en', 'es', etc.
  setLanguage,         // Change language

  // UI
  showBottomSheet,     // Show bottom sheet screens
  openAvatarPicker,    // Open avatar picker

  // Identity
  hasIdentity,         // Check for crypto identity
  getPublicKey,        // Get public key
} = useOxy();
```

---

## Environment Variables

```bash
# React Native/Expo
EXPO_PUBLIC_API_URL=https://api.oxy.so

# Node.js
OXY_API_URL=https://api.oxy.so
```

---

## Troubleshooting

### "useAuth/useOxy must be used within OxyProvider"

Wrap your app with `<OxyProvider>`.

### SSO not working on web

1. Ensure you're using HTTPS
2. Check browser dev tools for iframe errors
3. Session cookies require `sameSite: none` (already configured server-side)

### Native keychain issues

1. iOS: Enable "Keychain Sharing" in Xcode with group `group.com.oxy.shared`
2. Android: Add `android:sharedUserId="com.oxy.shared"` to manifest
3. Both: Apps must be signed with same certificate/team

---

## Full Documentation

- [README.md](./README.md) - Full API reference
- [CROSS_DOMAIN_AUTH.md](../../CROSS_DOMAIN_AUTH.md) - SSO deep dive
