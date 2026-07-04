# Expo 54 Universal Authentication Guide

Complete guide for implementing cross-platform authentication in **Expo 54** apps that run on iOS, Android, **and Web** with the same codebase.

## 📖 Table of Contents

- [Why Expo 54?](#why-expo-54)
- [Quick Start](#quick-start)
- [Platform-Specific Behavior](#platform-specific-behavior)
- [Installation](#installation)
- [Configuration](#configuration)
- [Implementation](#implementation)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

---

## Why Expo 54?

Expo 54 (released December 2024) introduces **universal platform support**, meaning:

✅ **One codebase** runs on iOS, Android, and Web
✅ **React Native Web** built-in
✅ **Platform-specific optimizations** automatically handled
✅ **Shared packages** work across all platforms

**Perfect for Oxy's multi-platform ecosystem!**

---

## Quick Start

### 1. Install Dependencies

```bash
npx expo install @oxyhq/services @oxyhq/core
```

### 2. Copy the Universal Auth Example

Copy [`expo-54-universal-auth.tsx`](examples/expo-54-universal-auth.tsx) to your project.

### 3. Use in Your App

```tsx
import App from './expo-54-universal-auth';

export default App;
```

**That's it!** The same code handles iOS, Android, and Web automatically.

---

## Platform-Specific Behavior

### **iOS (Native)**

```
┌─────────────────────────────────────────┐
│  Oxy App (Homiio, Mention, etc.)        │
│                                         │
│  1. Check Keychain: group.so.oxy.shared│
│  2. Found shared identity? ✅            │
│  3. Found shared session? ✅             │
│  4. Sign in automatically!              │
└─────────────────────────────────────────┘
```

- **Storage:** iOS Keychain (shared access group)
- **Auth:** Cryptographic identity (ECDSA)
- **Cross-app:** Instant via Keychain Sharing
- **Offline:** Works completely offline

### **Android (Native)**

```
┌─────────────────────────────────────────┐
│  Oxy App (Homiio, Mention, etc.)        │
│                                         │
│  1. Check shared storage (sharedUserId) │
│  2. Found shared identity? ✅            │
│  3. Found shared session? ✅             │
│  4. Sign in automatically!              │
└─────────────────────────────────────────┘
```

- **Storage:** Android Keystore + Account Manager
- **Auth:** Cryptographic identity (ECDSA)
- **Cross-app:** Instant via sharedUserId
- **Offline:** Works completely offline

### **Web (Browser)**

```
┌─────────────────────────────────────────┐
│  homiio.com                             │
│                                         │
│  1. Device-first cold boot resolves     │
│     the session against api.oxy.so     │
│     (same-apex: inline fetch; cross-    │
│     apex: one top-level hop, ever)      │
│  2. Signed in! ✅ (no redirect, no       │
│     popup, in-app modal if needed)      │
│                                         │
│  User visits mention.earth →            │
│  Instant sign-in via device-first SSO! ✅│
└─────────────────────────────────────────┘
```

- **Storage:** First-party `oxy_device` cookie (`Domain=.oxy.so`) + persisted rotating refresh-token family
- **Auth:** In-app sign-in modal (password+2FA, or "Sign in with Oxy" QR handoff) — no FedCM, no popup, no full-page redirect
- **Cross-domain:** Instant via the device-first cold boot
- **Offline:** Requires initial online sign-in

---

## Installation

### Step 1: Install Packages

```bash
npx expo install @oxyhq/services @oxyhq/core
```

### Step 2: Install Platform-Specific Dependencies

```bash
# Native dependencies (iOS/Android)
npx expo install expo-secure-store expo-crypto

# Web dependencies (already included in Expo 54)
# No additional installation needed!
```

### Step 3: Configure TypeScript

**tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "jsx": "react-native",
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

---

## Configuration

### iOS Configuration

#### 1. Enable Keychain Sharing

Open your iOS project in Xcode:

```bash
cd ios
open YourApp.xcworkspace
```

1. Select your app target
2. Go to **Signing & Capabilities**
3. Click **+ Capability**
4. Add **Keychain Sharing**
5. Add keychain group: `group.so.oxy.shared`

#### 2. Verify in entitlements file

**ios/YourApp/YourApp.entitlements:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>keychain-access-groups</key>
    <array>
        <string>$(AppIdentifierPrefix)group.so.oxy.shared</string>
    </array>
</dict>
</plist>
```

#### 3. Rebuild

```bash
npx expo run:ios
```

### Android Configuration

#### 1. Add Shared User ID

**android/app/src/main/AndroidManifest.xml:**
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.yourapp"
    android:sharedUserId="so.oxy.shared">

    <application>
        <!-- Your app configuration -->
    </application>
</manifest>
```

⚠️ **IMPORTANT:**
- All Oxy apps must have the **same** `sharedUserId`
- Apps must be signed with the **same certificate**
- You **cannot change** `sharedUserId` after publishing (requires reinstall)

#### 2. Rebuild

```bash
npx expo run:android
```

### Web Configuration

#### 1. Configure app.json

**app.json:**
```json
{
  "expo": {
    "name": "Your App",
    "platforms": ["ios", "android", "web"],
    "web": {
      "bundler": "metro",
      "output": "static",
      "favicon": "./assets/favicon.png"
    }
  }
}
```

#### 2. Deploy auth server

Ensure `auth.oxy.so` is deployed and accessible (see [CROSS_DOMAIN_AUTH.md](CROSS_DOMAIN_AUTH.md)).

#### 3. Test locally

```bash
npx expo start --web
```

Visit `http://localhost:8081` in your browser.

---

## Implementation

### Basic Setup

```tsx
import { UniversalAuthProvider, useAuth } from './expo-54-universal-auth';

export default function App() {
  return (
    <UniversalAuthProvider>
      <YourApp />
    </UniversalAuthProvider>
  );
}

function YourApp() {
  const { user, loading, platform } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <WelcomeScreen />;

  return <Dashboard user={user} platform={platform} />;
}
```

### Platform Detection

```tsx
import { Platform } from 'react-native';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
const isWeb = Platform.OS === 'web';

// Conditional imports
let KeyManager: any = null;
if (!isWeb) {
  KeyManager = require('@oxyhq/core').KeyManager;
}

// Conditional rendering
{isNative && <NativeFeature />}
{isWeb && <WebFeature />}
```

### Universal Auth Hook

```tsx
function MyComponent() {
  const auth = useAuth();

  // Universal properties (all platforms)
  const { user, loading, platform, signOut } = auth;

  // Native-only properties
  if (platform !== 'web') {
    const { hasIdentity, createIdentity, importIdentity } = auth;
  }

  // Web-only properties
  if (platform === 'web') {
    const { signIn, isReady } = auth; // signIn() opens the in-app modal; no FedCM/redirect
  }

  return (
    <View>
      <Text>Platform: {platform}</Text>
      <Text>User: {user?.username || 'Not signed in'}</Text>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
}
```

---

## Testing

### Test on All Platforms

```bash
# iOS Simulator
npx expo run:ios

# Android Emulator
npx expo run:android

# Web Browser
npx expo start --web
```

### Test Cross-App Sharing

#### iOS:
1. Install **two** Oxy apps with same keychain group
2. Sign in to App A
3. Open App B → **Instant sign-in!** ✅

#### Android:
1. Install **two** Oxy apps with same `sharedUserId`
2. Sign in to App A
3. Open App B → **Instant sign-in!** ✅

#### Web:
1. Open `homiio.com` in browser
2. Sign in
3. Open `mention.earth` in same browser → **Instant sign-in!** ✅

### Debug Platform-Specific Issues

```tsx
import { Platform } from 'react-native';

console.log('Platform:', Platform.OS);
console.log('Platform Version:', Platform.Version);

if (Platform.OS === 'web') {
  console.log('User Agent:', navigator.userAgent);
}
```

---

## Troubleshooting

### iOS Issues

#### ❌ "Keychain Sharing not working"

**Solutions:**
1. Verify keychain group: `group.so.oxy.shared`
2. Check all apps have **same** group
3. Ensure apps signed with **same team ID**
4. **Test on real device** (Simulator has limitations)
5. Rebuild after adding capability: `npx expo run:ios`

#### ❌ "Identity returns null"

```tsx
const hasIdentity = await KeyManager.hasSharedIdentity();
console.log('Has shared identity:', hasIdentity);

const publicKey = await KeyManager.getSharedPublicKey();
console.log('Shared public key:', publicKey);
```

Check if identity exists in regular storage and migrate:

```tsx
const migrated = await KeyManager.migrateToSharedIdentity();
console.log('Migration successful:', migrated);
```

### Android Issues

#### ❌ "Shared storage not working"

**Solutions:**
1. Verify `sharedUserId="so.oxy.shared"` in **all** manifests
2. Apps must be signed with **same certificate**
3. **Uninstall all apps** and reinstall (sharedUserId can't change)
4. Check package names are different
5. Rebuild: `npx expo run:android`

#### ❌ "Session not shared"

```tsx
const session = await KeyManager.getSharedSession();
console.log('Shared session:', session);

if (!session) {
  console.log('No shared session found');
  // Create one:
  await KeyManager.storeSharedSession(sessionId, accessToken);
}
```

### Web Issues

#### ❌ Cross-domain session isn't restoring on web

There is no `CrossDomainAuth` class or FedCM path anymore (removed in the
wave-2 device-first cutover) — `OxyProvider`'s cold boot handles cross-domain
restore automatically. See
[Cross-Domain Authentication](./CROSS_DOMAIN_AUTH.md#troubleshooting) for the
current checklist (HTTPS, the `oxy_device` cookie not being blocked, and the
one-time-per-browser+origin cross-apex hop).

### Universal Issues

#### ❌ "Module not found: crypto"

**Solution:** Conditionally import crypto modules:

```tsx
let KeyManager: any = null;

if (Platform.OS !== 'web') {
  // Only import on native
  KeyManager = require('@oxyhq/core').KeyManager;
}
```

#### "Different behavior on web vs native"

This is **expected**! The auth system adapts to each platform:

| Feature | iOS/Android | Web |
|---------|-------------|-----|
| **Identity** | Cryptographic (ECDSA) | Email/Password or OAuth |
| **Storage** | Keychain/Keystore | Cookies + localStorage |
| **Cross-app** | Shared keychain | Browser SSO |
| **Offline** | ✅ Yes | ❌ No (needs auth server) |

---

## Best Practices

### ✅ Do's

1. **Do** use platform detection for conditional logic
2. **Do** handle both native and web auth flows
3. **Do** test on all three platforms (iOS, Android, Web)
4. **Do** implement graceful fallbacks
5. **Do** use TypeScript for type safety

```tsx
// ✅ Good: signIn() is already platform-uniform — no branching needed
const { signIn } = useAuth();
await signIn(); // opens the in-app modal on both web and native
```

### ❌ Don'ts

1. **Don't** import crypto modules unconditionally
2. **Don't** assume platform-specific APIs exist
3. **Don't** forget to configure native capabilities
4. **Don't** use different auth flows for same app

```tsx
// BAD: Unconditional import
import { KeyManager } from '@oxyhq/core'; // Breaks on web!

// BAD: No platform check
await KeyManager.getSharedPublicKey(); // Crashes on web!

// GOOD: Conditional import
let KeyManager: any = null;
if (Platform.OS !== 'web') {
  KeyManager = require('@oxyhq/core').KeyManager;
}
```

---

## Example Project Structure

```
your-expo-app/
├── app/
│   ├── (auth)/
│   │   ├── welcome.tsx          # Universal welcome screen
│   │   ├── create-identity.tsx  # Native: create identity
│   │   └── sign-in.tsx          # Web: sign in
│   ├── (app)/
│   │   ├── _layout.tsx          # Protected routes
│   │   └── index.tsx            # Dashboard
│   └── _layout.tsx              # Root layout with auth
├── lib/
│   ├── auth/
│   │   ├── UniversalAuthProvider.tsx  # Main provider
│   │   ├── NativeAuth.ts              # iOS/Android logic
│   │   └── WebAuth.ts                 # Web logic
│   └── utils/
│       └── platform.ts                # Platform detection
├── app.json
├── package.json
└── tsconfig.json
```

---

## Migration Guide

### From Native-Only to Universal

#### Before (Native-only):

```tsx
import { KeyManager } from '@oxyhq/core';

const publicKey = await KeyManager.getPublicKey();
```

#### After (Universal):

```tsx
import { Platform } from 'react-native';

let KeyManager: any = null;
if (Platform.OS !== 'web') {
  KeyManager = require('@oxyhq/core').KeyManager;
}

const publicKey = KeyManager
  ? await KeyManager.getPublicKey()
  : null;
```

### From Web-Only to Universal

There's no platform-specific auth class to switch on anymore — `useAuth()`
from `@oxyhq/services` (Expo, native + web) exposes the same `signIn()` on
every platform, and it just opens the in-app "Sign in with Oxy" modal:

```tsx
import { useAuth } from '@oxyhq/services';

const { signIn } = useAuth();
await signIn(); // works identically on iOS, Android, and web
```

---

## Resources

- **Expo 54 Docs:** https://docs.expo.dev
- **React Native Web:** https://necolas.github.io/react-native-web
- **Cross-Domain Auth Guide:** [CROSS_DOMAIN_AUTH.md](CROSS_DOMAIN_AUTH.md)
- **Example Code:** [expo-54-universal-auth.tsx](examples/expo-54-universal-auth.tsx)

---

## Support

- **Issues:** https://github.com/oxyhq/oxyhqservices/issues
- **Expo Forums:** https://forums.expo.dev
- **Email:** support@oxy.so

---

## License

MIT © OxyHQ
