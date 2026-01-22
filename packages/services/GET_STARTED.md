# Getting Started with @oxyhq/services

Quick guide to integrate Oxy authentication and services into any Oxy app.

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

## Native Apps (React Native / Expo)

### 1. Setup Entry Point

Add polyfill at the very top of your entry file:

```javascript
// index.js or App.js (first line)
import 'react-native-url-polyfill/auto';
```

### 2. Wrap App with OxyProvider

```tsx
// app/_layout.tsx (Expo Router) or App.tsx
import { OxyProvider } from '@oxyhq/services';
import * as Linking from 'expo-linking';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://api.oxy.so';
const AUTH_REDIRECT_URI = Linking.createURL('/');

export default function RootLayout() {
  return (
    <OxyProvider baseURL={API_URL} authRedirectUri={AUTH_REDIRECT_URI}>
      <YourApp />
    </OxyProvider>
  );
}
```

### 3. Use Authentication

```tsx
import { OxySignInButton, useOxy } from '@oxyhq/services';

function HomeScreen() {
  const { isAuthenticated, user, logout, showBottomSheet } = useOxy();

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
      <Button title="Account Settings" onPress={() => showBottomSheet('AccountCenter')} />
      <Button title="Sign Out" onPress={logout} />
    </View>
  );
}
```

### 4. Available Bottom Sheet Screens

```tsx
const { showBottomSheet } = useOxy();

// Account screens
showBottomSheet('AccountCenter');      // Main account hub
showBottomSheet('AccountOverview');    // Overview with all features
showBottomSheet('AccountSwitcher');    // Switch between accounts
showBottomSheet('SessionManagement');  // Manage device sessions
showBottomSheet('EditProfile');        // Edit profile
showBottomSheet('PrivacySettings');    // Privacy controls

// Auth screens
showBottomSheet('OxyAuth');            // QR code authentication
showBottomSheet('WelcomeNewUser');     // New user welcome

// Features
showBottomSheet('FileManagement');     // File management
showBottomSheet('LanguageSelector');   // Change language
showBottomSheet('KarmaCenter');        // Karma system

// Payments (with props)
showBottomSheet({
  screen: 'PaymentGateway',
  props: { amount: 10, currency: 'FAIR' }
});
```

---

## Web Apps (Next.js / React)

For web apps, use `CrossDomainAuth` for SSO across all Oxy domains.

### 1. Setup CrossDomainAuth

```tsx
import { OxyServices, createCrossDomainAuth } from '@oxyhq/services';

const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so',
});

const auth = createCrossDomainAuth(oxyServices);
```

### 2. Initialize on App Startup

```tsx
// Check for existing session
useEffect(() => {
  const initAuth = async () => {
    const session = await auth.initialize();
    if (session) {
      setUser(session.user);
    }
    setLoading(false);
  };
  initAuth();
}, []);
```

### 3. Sign In

```tsx
const handleSignIn = async () => {
  try {
    // Auto-selects best method: FedCM -> Popup -> Redirect
    const session = await auth.signIn();
    setUser(session.user);
  } catch (error) {
    console.error('Sign in failed:', error);
  }
};
```

### 4. Complete React Example

```tsx
import { useEffect, useState } from 'react';
import { OxyServices, createCrossDomainAuth } from '@oxyhq/services';

const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
const auth = createCrossDomainAuth(oxyServices);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    auth.initialize().then((session) => {
      if (session) setUser(session.user);
      setLoading(false);
    });
  }, []);

  const handleSignIn = async () => {
    const session = await auth.signIn();
    if (session) setUser(session.user);
  };

  const handleSignOut = async () => {
    await oxyServices.logout();
    setUser(null);
  };

  if (loading) return <div>Loading...</div>;

  return user ? (
    <div>
      <h1>Welcome, {user.username}!</h1>
      <button onClick={handleSignOut}>Sign Out</button>
    </div>
  ) : (
    <button onClick={handleSignIn}>Sign In with Oxy</button>
  );
}
```

---

## Native Cross-App SSO (iOS/Android)

For sharing authentication across multiple native Oxy apps.

### iOS: Keychain Sharing

1. Enable "Keychain Sharing" in Xcode
2. Add keychain group: `group.com.oxy.shared`

```tsx
import { KeyManager, SignatureService, OxyServices } from '@oxyhq/services';

const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Check for shared session from other Oxy apps
async function initializeAuth() {
  const sharedSession = await KeyManager.getSharedSession();
  if (sharedSession) {
    oxyServices.setTokens(sharedSession.accessToken);
    return await oxyServices.getCurrentUser();
  }

  // Check for existing identity
  const hasIdentity = await KeyManager.hasSharedIdentity();
  if (hasIdentity) {
    const publicKey = await KeyManager.getSharedPublicKey();
    const { challenge } = await oxyServices.requestChallenge(publicKey);
    const signature = await SignatureService.signChallenge(challenge);
    const session = await oxyServices.verifyChallenge(publicKey, challenge, signature, Date.now());

    // Store for other apps
    await KeyManager.storeSharedSession(session.sessionId, session.accessToken);
    return session.user;
  }

  return null; // User needs to create identity
}
```

### Android: Shared User ID

Add to `AndroidManifest.xml` in ALL Oxy apps:

```xml
<manifest android:sharedUserId="com.oxy.shared">
```

---

## useOxy Hook Reference

```tsx
const {
  // Auth state
  isAuthenticated,          // boolean
  isLoading,               // boolean
  user,                    // User | null
  error,                   // string | null

  // Session management
  sessions,                // ClientSession[]
  activeSessionId,         // string | null
  switchSession,           // (sessionId: string) => Promise<void>
  refreshSessions,         // () => Promise<void>

  // Auth actions
  signIn,                  // (publicKey: string) => Promise<User>
  logout,                  // () => Promise<void>
  logoutAll,               // () => Promise<void>

  // Language
  currentLanguage,         // string (e.g., 'en')
  currentLanguageName,     // string (e.g., 'English')
  setLanguage,             // (code: string) => Promise<void>

  // UI
  showBottomSheet,         // (screen: string | config) => void
  openAvatarPicker,        // () => void

  // Services instance
  oxyServices,             // OxyServices
} = useOxy();
```

---

## OxyServices API

```tsx
const { oxyServices } = useOxy();

// User
const user = await oxyServices.getCurrentUser();
await oxyServices.updateProfile({ name: { first: 'John' } });

// Sessions
await oxyServices.validateSession(sessionId);
await oxyServices.logoutSession(sessionId);

// Karma
const karma = await oxyServices.getKarma();
const leaderboard = await oxyServices.getKarmaLeaderboard();

// Wallet
const wallet = await oxyServices.getWallet();
await oxyServices.transferFunds({ toUserId: '...', amount: 10 });

// Files
const files = await oxyServices.listFiles();
await oxyServices.uploadFile(file);
```

---

## Query Hooks (TanStack Query)

```tsx
import {
  useCurrentUser,
  useUserProfile,
  useDeviceSessions,
  useSecurityActivity,
} from '@oxyhq/services';

function Profile() {
  const { data: user, isLoading } = useCurrentUser();
  const { data: sessions } = useDeviceSessions();

  if (isLoading) return <Loading />;
  return <Text>{user?.username}</Text>;
}
```

---

## Environment Variables

```bash
# .env
EXPO_PUBLIC_API_URL=https://api.oxy.so
```

---

## Troubleshooting

### "useOxy must be used within OxyProvider"

Ensure your component is inside `<OxyProvider>`.

### Cross-domain auth not working

1. Check browser supports FedCM (Chrome 108+, Safari 16.4+)
2. Ensure HTTPS
3. Fallback: `auth.signIn({ method: 'popup' })`

### iOS Keychain sharing not working

1. Verify keychain group in ALL apps: `group.com.oxy.shared`
2. Check apps signed with same Team ID
3. Test on real device (not Simulator)

### Android shared storage not working

1. Verify `sharedUserId` matches in ALL apps
2. Apps must be signed with same certificate
3. Reinstall apps after adding `sharedUserId`

---

## Full Documentation

- [CROSS_DOMAIN_AUTH.md](../../CROSS_DOMAIN_AUTH.md) - Complete cross-domain SSO guide
- [README.md](./README.md) - Full API reference
