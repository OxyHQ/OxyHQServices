# Cross-Domain Authentication for Oxy Ecosystem

Complete guide to implementing Google-style cross-domain SSO across all your Oxy apps (homiio.com, mention.earth, alia.onl, etc.) **without third-party cookies**.

## 📖 Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Web Implementation](#web-implementation)
- [Native Implementation (iOS/Android)](#native-implementation-iosandroid)
- [Auth Server Setup](#auth-server-setup)
- [API Reference](#api-reference)
- [Migration Guide](#migration-guide)
- [Troubleshooting](#troubleshooting)

---

## Overview

This system enables **true cross-domain SSO** where users sign in once and are automatically authenticated across all Oxy apps, just like Google does with YouTube, Gmail, Maps, etc.

### Key Features

✅ **Works without third-party cookies** - Future-proof for Chrome's cookie deprecation
✅ **Three authentication methods** - FedCM, Popup, Redirect (automatic fallback)
✅ **Native cross-app sharing** - iOS Keychain Groups & Android Account Manager
✅ **Silent sign-in** - Users authenticated instantly across apps
✅ **Privacy-preserving** - Browser mediates identity, IdP can't track
✅ **Easy to use** - One simple API, automatic method selection

### Browser Support

| Method | Chrome | Safari | Firefox | Edge | Mobile |
|--------|--------|--------|---------|------|--------|
| **FedCM** | 108+ | 16.4+ | ❌ | 108+ | Partial |
| **Popup** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Redirect** | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## How It Works

### Web (Cross-Domain)

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│ homiio.com  │         │ auth.oxy.so  │         │mention.earth│
│             │         │  (IdP)       │         │             │
│  1. Visit   ├────────▶│              │         │             │
│  2. Check   │  FedCM  │ 3. Has       │         │             │
│     session │ /Popup  │    session?  │         │             │
│             │◀────────┤ 4. Send      │         │             │
│  5. Got     │  Token  │    token     │         │             │
│     token!  │         │              │         │             │
│             │         │              │         │  6. Visit   │
│             │         │              │◀────────┤  7. Instant │
│             │         │  8. Already  │  FedCM  │     auth!   │
│             │         │     signed   ├────────▶│             │
│             │         │     in!      │  Token  │             │
└─────────────┘         └──────────────┘         └─────────────┘
```

### Native (Shared Storage)

```
┌────────────┐         ┌──────────────────┐         ┌────────────┐
│  Homiio    │         │  iOS Keychain    │         │  Mention   │
│   App      │         │  Shared Group    │         │   App      │
│            │         │ (group.com.oxy)  │         │            │
│ 1. Sign in ├────────▶│                  │         │            │
│ 2. Store   │  Write  │ 3. Identity +    │         │            │
│    shared  │         │    Session       │         │            │
│            │         │                  │         │  4. Launch │
│            │         │                  │◀────────┤  5. Read   │
│            │         │  6. Instant      │  Read   │     shared │
│            │         │     auth!        ├────────▶│  7. Signed │
│            │         │                  │         │     in!    │
└────────────┘         └──────────────────┘         └────────────┘
```

---

## Quick Start

### 1. Install Package

```bash
npm install @oxyhq/services
```

### 2. Web App Integration

```typescript
import { OxyServices, createCrossDomainAuth } from '@oxyhq/services';

// Initialize OxyServices
const oxyServices = new OxyServices({
  baseURL: 'https://api.oxy.so',
});

// Create cross-domain auth helper
const auth = createCrossDomainAuth(oxyServices);

// On app startup - check for existing session
const session = await auth.initialize();
if (session) {
  console.log('User is signed in:', session.user);
} else {
  console.log('User needs to sign in');
}

// Sign in button click
const handleSignIn = async () => {
  try {
    const session = await auth.signIn(); // Auto-selects best method
    console.log('Signed in:', session.user);
  } catch (error) {
    console.error('Sign in failed:', error);
  }
};
```

### 3. React Example

```typescript
import { useEffect, useState } from 'react';
import { createCrossDomainAuth, OxyServices } from '@oxyhq/services';

const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });
const auth = createCrossDomainAuth(oxyServices);

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Check for existing session on mount
    const initAuth = async () => {
      const session = await auth.initialize();
      if (session) {
        setUser(session.user);
      }
      setLoading(false);
    };

    initAuth();
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const session = await auth.signIn();
      setUser(session.user);
    } catch (error) {
      alert('Sign in failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await oxyServices.logoutSession(oxyServices.getStoredSessionId());
    setUser(null);
  };

  if (loading) return <div>Loading...</div>;

  if (user) {
    return (
      <div>
        <h1>Welcome, {user.username}!</h1>
        <button onClick={handleSignOut}>Sign Out</button>
      </div>
    );
  }

  return (
    <div>
      <h1>Please Sign In</h1>
      <button onClick={handleSignIn}>Sign In with Oxy</button>
    </div>
  );
}
```

---

## Web Implementation

### Method 1: FedCM (Recommended for Modern Browsers)

**Best for:** Chrome 108+, Safari 16.4+, Edge 108+

```typescript
// Automatic FedCM with fallback
const session = await auth.signIn({ method: 'auto' });

// Force FedCM only
try {
  const session = await auth.signInWithFedCM();
} catch (error) {
  // Browser doesn't support FedCM
  console.error(error);
}

// Silent sign-in (no UI)
const session = await auth.silentSignIn();
```

**Features:**
- ✅ No popup, no redirect
- ✅ Browser-native UI
- ✅ Privacy-preserving
- ✅ Instant cross-domain SSO

**Limitations:**
- ❌ Requires modern browser
- ❌ Doesn't work in Firefox yet

### Method 2: Popup (Best Compatibility)

**Best for:** All modern browsers, desktop and mobile

```typescript
// Popup with auto-close
const session = await auth.signInWithPopup();

// Custom popup size
const session = await auth.signInWithPopup({
  popupDimensions: {
    width: 600,
    height: 800,
  },
});

// Silent refresh (hidden iframe)
const session = await auth.silentSignIn();
```

**Features:**
- ✅ Preserves app state (no page reload)
- ✅ Works in all browsers
- ✅ Good UX

**Limitations:**
- ⚠️ May be blocked by popup blockers
- ⚠️ Awkward on some mobile browsers

### Method 3: Redirect (Universal Fallback)

**Best for:** Maximum compatibility, including old browsers

```typescript
// Initiate redirect (doesn't return immediately)
auth.signInWithRedirect({
  redirectUri: 'https://yourapp.com/callback',
});

// On app startup - handle callback
const session = auth.handleRedirectCallback();
if (session) {
  console.log('Returned from auth:', session.user);
}

// Or restore from localStorage
if (auth.restoreSession()) {
  const user = await oxyServices.getCurrentUser();
}
```

**Features:**
- ✅ Works everywhere
- ✅ Secure (first-party cookies only)
- ✅ Reliable

**Limitations:**
- ❌ Full page reload (loses app state)
- ❌ Slower UX

### Progressive Enhancement Strategy

```typescript
const auth = createCrossDomainAuth(oxyServices);

// Get recommendation for current environment
const { method, reason } = auth.getRecommendedMethod();
console.log(`Using ${method}: ${reason}`);

// Auto mode tries: FedCM → Popup → Redirect
const session = await auth.signIn({
  method: 'auto',
  onMethodSelected: (method) => {
    console.log(`Authenticating with: ${method}`);
  },
});
```

---

## Native Implementation (iOS/Android)

### iOS: Keychain Sharing

#### 1. Enable Keychain Sharing in Xcode

For **each Oxy app** (Homiio, Mention, Alia, etc.):

1. Open Xcode project
2. Select your app target
3. Go to "Signing & Capabilities"
4. Click "+ Capability"
5. Add "Keychain Sharing"
6. Add keychain group: `group.com.oxy.shared`

#### 2. Use Shared Identity

```typescript
import { KeyManager } from '@oxyhq/services';

// Create shared identity (only needed once across all apps)
const hasShared = await KeyManager.hasSharedIdentity();
if (!hasShared) {
  // Migrate local identity to shared (for existing users)
  await KeyManager.migrateToSharedIdentity();
}

// Get shared public key (works in all Oxy apps)
const publicKey = await KeyManager.getSharedPublicKey();

// Check for shared session
const session = await KeyManager.getSharedSession();
if (session) {
  // User is signed in from another Oxy app!
  oxyServices.setTokens(session.accessToken);
  const user = await oxyServices.getCurrentUser();
}

// Store session (accessible to all Oxy apps)
await KeyManager.storeSharedSession(sessionId, accessToken);
```

#### 3. Complete iOS Flow

```typescript
import { OxyServices } from '@oxyhq/services';
import { KeyManager } from '@oxyhq/services/crypto';

const oxyServices = new OxyServices({ baseURL: 'https://api.oxy.so' });

// On app startup
async function initializeAuth() {
  // 1. Check for shared session first
  const sharedSession = await KeyManager.getSharedSession();
  if (sharedSession) {
    oxyServices.setTokens(sharedSession.accessToken);
    const user = await oxyServices.getCurrentUser();
    return user;
  }

  // 2. Check for local identity
  const hasIdentity = await KeyManager.hasIdentity();
  if (hasIdentity) {
    // Sign in with existing identity
    const publicKey = await KeyManager.getPublicKey();
    const { challenge } = await oxyServices.requestChallenge(publicKey);
    const signature = await SignatureService.signChallenge(challenge);
    const session = await oxyServices.verifyChallenge(
      publicKey,
      challenge,
      signature,
      Date.now()
    );

    // Store in shared storage for other apps
    await KeyManager.storeSharedSession(session.sessionId, session.accessToken);

    return session.user;
  }

  // 3. No identity - user needs to create one
  return null;
}

// Create new identity
async function createIdentity() {
  // Create in shared storage so all apps can use it
  const publicKey = await KeyManager.createSharedIdentity();

  // Register with server
  const signature = await SignatureService.createRegistrationSignature();
  await oxyServices.register(publicKey, signature, Date.now());

  // Sign in
  const { challenge } = await oxyServices.requestChallenge(publicKey);
  const challengeSig = await SignatureService.signChallenge(challenge);
  const session = await oxyServices.verifyChallenge(
    publicKey,
    challenge,
    challengeSig,
    Date.now()
  );

  // Store in shared storage
  await KeyManager.storeSharedSession(session.sessionId, session.accessToken);

  return session.user;
}
```

### Android: Account Manager + Shared User ID

#### 1. Configure Shared User ID

In **each app's** `AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.yourapp"
    android:sharedUserId="com.oxy.shared">

    <!-- App content -->
</manifest>
```

⚠️ **Important:** All Oxy apps must have the **same** `sharedUserId` to share data.

#### 2. Use Shared Identity

```typescript
import { KeyManager } from '@oxyhq/services';

// Same API as iOS!
const hasShared = await KeyManager.hasSharedIdentity();
const publicKey = await KeyManager.getSharedPublicKey();
const session = await KeyManager.getSharedSession();

// Store shared session
await KeyManager.storeSharedSession(sessionId, accessToken);
```

Android automatically shares SecureStore data between apps with the same `sharedUserId`.

---

## Auth Server Setup

Your auth server must be running at `auth.oxy.so` with the following endpoints:

### Required Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/fedcm.json` | GET | FedCM configuration |
| `/.well-known/web-identity` | GET | FedCM provider discovery |
| `/api/fedcm/accounts` | GET | List user accounts for FedCM |
| `/api/fedcm/client_metadata` | GET | Client app metadata |
| `/api/fedcm/assertion` | POST | Issue ID tokens |
| `/api/auth/fedcm/exchange` | POST | Exchange ID token for session |
| `/auth/callback` | GET | Popup callback page |
| `/auth/silent` | GET | Silent auth iframe |
| `/login` | GET | Login page |
| `/signup` | GET | Signup page |

### DNS Configuration

```
auth.oxy.so  →  Your auth server IP
```

### SSL Certificate

FedCM and secure contexts require HTTPS. Obtain SSL certificate for `auth.oxy.so`.

---

## API Reference

### `CrossDomainAuth`

Main authentication helper class.

#### `constructor(oxyServices: OxyServices)`

Creates new instance.

```typescript
const auth = new CrossDomainAuth(oxyServices);
// Or use helper:
const auth = createCrossDomainAuth(oxyServices);
```

#### `signIn(options?): Promise<SessionLoginResponse | null>`

Sign in with automatic method selection.

**Options:**
- `method?: 'auto' | 'fedcm' | 'popup' | 'redirect'` - Preferred method
- `isSignup?: boolean` - Open signup instead of login
- `redirectUri?: string` - Custom redirect URI (for redirect method)
- `popupDimensions?: { width?, height? }` - Popup size
- `onMethodSelected?: (method) => void` - Callback when method chosen

**Returns:** Session or null (null for redirect method)

#### `signInWithFedCM(options?): Promise<SessionLoginResponse>`

Sign in using FedCM (browser-native).

#### `signInWithPopup(options?): Promise<SessionLoginResponse>`

Sign in using popup window.

#### `signInWithRedirect(options?): void`

Sign in using full-page redirect. Doesn't return (navigates away).

#### `handleRedirectCallback(): SessionLoginResponse | null`

Handle redirect callback. Call on app startup.

#### `silentSignIn(): Promise<SessionLoginResponse | null>`

Try to sign in without user interaction.

#### `restoreSession(): boolean`

Restore session from localStorage.

#### `initialize(): Promise<SessionLoginResponse | null>`

Complete initialization: handles callbacks, restores session, tries silent sign-in.

**Use this on app startup.**

### `KeyManager` (Native Only)

#### Shared Identity Methods

- `createSharedIdentity(): Promise<string>` - Create cross-app identity
- `getSharedPublicKey(): Promise<string | null>` - Get shared public key
- `getSharedPrivateKey(): Promise<string | null>` - Get shared private key
- `hasSharedIdentity(): Promise<boolean>` - Check if shared identity exists
- `importSharedIdentity(privateKey): Promise<string>` - Import shared identity
- `storeSharedSession(sessionId, token): Promise<void>` - Store cross-app session
- `getSharedSession(): Promise<{ sessionId, accessToken } | null>` - Get cross-app session
- `clearSharedSession(): Promise<void>` - Clear cross-app session
- `migrateToSharedIdentity(): Promise<boolean>` - Migrate local → shared

---

## Migration Guide

### Migrating Existing Web Apps

```typescript
// Before: App-specific auth
const session = await oxyServices.signIn(email, password);

// After: Cross-domain auth
const auth = createCrossDomainAuth(oxyServices);
const session = await auth.signIn(); // Automatic SSO!
```

### Migrating Existing Native Apps

```typescript
// Before: Device-specific identity
const publicKey = await KeyManager.getPublicKey();

// After: Shared identity
// Automatic migration - existing users keep their identity
await KeyManager.migrateToSharedIdentity();
const publicKey = await KeyManager.getSharedPublicKey();

// Store sessions in shared storage
await KeyManager.storeSharedSession(sessionId, accessToken);
```

### Backward Compatibility

Both old and new methods work simultaneously:

```typescript
// Old method still works
const localKey = await KeyManager.getPublicKey();

// New method works too
const sharedKey = await KeyManager.getSharedPublicKey();

// Migrate when ready
await KeyManager.migrateToSharedIdentity();
```

---

## Troubleshooting

### FedCM Not Working

**Symptom:** `FedCM not supported` error

**Solutions:**
1. Check browser version (Chrome 108+, Safari 16.4+)
2. Ensure HTTPS (required for FedCM)
3. Check browser flags: `chrome://flags/#fedcm`
4. Verify `/.well-known/web-identity` is accessible
5. Use `auth.signIn({ method: 'popup' })` as fallback

### Popup Blocked

**Symptom:** "Popup blocked" error

**Solutions:**
1. Ensure `signInWithPopup()` is called directly from user action (click handler)
2. Don't call from async callbacks or timeouts
3. Ask user to allow popups
4. Fallback to redirect: `auth.signIn({ method: 'redirect' })`

### iOS Keychain Sharing Not Working

**Symptom:** Shared identity returns null

**Solutions:**
1. Verify all apps have same keychain group: `group.com.oxy.shared`
2. Check Xcode capability is enabled for ALL targets
3. Ensure apps are signed with same team ID
4. Test on real device (Simulator has limited keychain sharing)

### Android Shared Storage Not Working

**Symptom:** Sessions not shared between apps

**Solutions:**
1. Verify ALL apps have same `sharedUserId` in manifest
2. Apps must be signed with same certificate
3. Reinstall apps after adding `sharedUserId` (can't change on update)
4. Check `sharedUserId` format: `com.oxy.shared` (no underscores)

### Silent Sign-In Fails

**Symptom:** `silentSignIn()` always returns null

**Solutions:**
1. Check if user has session at `auth.oxy.so` (visit in browser)
2. Verify CORS headers on silent auth endpoint
3. Check iframe not blocked by CSP
4. Try FedCM silent auth: `auth.silentSignInWithFedCM()`

### Session Expires Immediately

**Symptom:** User signed out after page reload

**Solutions:**
1. Call `auth.initialize()` on app startup
2. Check session cookie expiration
3. Verify token storage: `oxyServices.hasValidToken()`
4. Check for HTTP→HTTPS mixed content

---

## Best Practices

### ✅ Do's

- **Do** call `auth.initialize()` on every app startup
- **Do** use `method: 'auto'` for automatic fallback
- **Do** handle all three methods (FedCM/Popup/Redirect)
- **Do** store sessions in shared storage on native
- **Do** migrate existing users to shared identity
- **Do** test on real devices (iOS Keychain Sharing)
- **Do** implement proper error handling

### ❌ Don'ts

- **Don't** call popup auth from async callbacks
- **Don't** forget to handle redirect callbacks
- **Don't** mix local and shared storage
- **Don't** skip iOS Keychain Sharing capability
- **Don't** change Android `sharedUserId` after publish
- **Don't** assume FedCM support (always have fallback)

---

## Support

- **Issues:** https://github.com/oxyhq/oxyhqservices/issues
- **Docs:** https://oxy.so/docs
- **Email:** support@oxy.so

---

## License

MIT © OxyHQ
