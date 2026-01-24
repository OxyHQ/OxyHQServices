# Cross-Domain Authentication for Oxy Ecosystem

Zero-config cross-domain SSO across all Oxy apps (homiio.com, mention.earth, alia.onl, oxy.so, etc.) **without third-party cookies**.

## Overview

Sign in once at `auth.oxy.so` and be automatically authenticated across all Oxy domains. Works like Google's SSO across YouTube, Gmail, and Maps.

### How It Works

- **Web**: Uses FedCM (Federated Credential Management) - browser-native identity API
- **Native**: Uses iOS Keychain Sharing / Android Account Manager

### Key Features

- **No third-party cookies** - Works in all modern browsers
- **Zero config** - Just wrap with `OxyProvider` and SSO works automatically
- **Cross-TLD** - Works across completely different domains (not just subdomains)
- **Privacy-preserving** - Browser mediates identity flow
- **Automatic fallback** - FedCM → Popup → Redirect

### Browser Support

| Method | Chrome | Safari | Firefox | Edge |
|--------|--------|--------|---------|------|
| **FedCM** | 108+ | 16.4+ | - | 108+ |
| **Popup** | All | All | All | All |

---

## Quick Start

### Expo Apps (Recommended)

For Expo 54+ apps (native + web), use `OxyProvider` - it works on all platforms:

```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

function MyComponent() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();

  if (!isAuthenticated) {
    return <Button onPress={() => signIn()} title="Sign In" />;
  }

  return <Text>Welcome, {user?.username}!</Text>;
}
```

**That's it!** Cross-domain SSO is automatic. If a user is signed in on any Oxy domain, they're automatically signed in on your app.

### Pure React/Next.js Apps

For web-only apps that don't use Expo/React Native:

```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}
```

---

## How It Works

### Web (FedCM)

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│ homiio.com  │         │ auth.oxy.so  │         │mention.earth│
│             │  FedCM  │    (IdP)     │  FedCM  │             │
│  User       ├────────▶│              │◀────────┤  User       │
│  visits     │         │  Browser     │         │  visits     │
│             │◀────────┤  mediates    ├────────▶│             │
│  Instant    │  Token  │  identity    │  Token  │  Instant    │
│  auth!      │         │              │         │  auth!      │
└─────────────┘         └──────────────┘         └─────────────┘
```

1. User signs in at `auth.oxy.so`
2. Browser stores FedCM credential
3. User visits your app (e.g., homiio.com)
4. OxyProvider uses FedCM to request identity from browser
5. Browser returns ID token (no network request to IdP!)
6. Your app exchanges token for session at `api.oxy.so`

### Native (Keychain Sharing)

```
┌────────────┐         ┌──────────────────┐         ┌────────────┐
│  Homiio    │         │  iOS Keychain    │         │  Mention   │
│   App      │  Write  │  Shared Group    │  Read   │   App      │
│            ├────────▶│ (group.so.oxy)   │◀────────┤            │
│ Signs in   │         │                  │         │ Launches   │
│            │         │  Identity +      │         │            │
│            │         │  Session stored  │         │ Instant    │
│            │         │                  │         │ auth!      │
└────────────┘         └──────────────────┘         └────────────┘
```

---

## Web Implementation

### Using useAuth Hook (Recommended)

The `useAuth` hook handles everything automatically:

```tsx
import { useAuth } from '@oxyhq/services';

function LoginButton() {
  const { isAuthenticated, user, signIn, signOut, isLoading } = useAuth();

  if (isLoading) return <Spinner />;

  if (isAuthenticated) {
    return (
      <div>
        <span>Hi, {user?.username}!</span>
        <button onClick={signOut}>Sign Out</button>
      </div>
    );
  }

  return <button onClick={() => signIn()}>Sign In</button>;
}
```

**What happens when `signIn()` is called:**

1. **FedCM check** - If browser supports FedCM and user has signed in before, instant auth
2. **Popup fallback** - Opens `auth.oxy.so` in popup, user signs in, popup closes
3. **Session stored** - Token stored locally, user is authenticated

### Using OxySignInButton Component

```tsx
import { OxySignInButton } from '@oxyhq/services';

function LoginPage() {
  return (
    <div>
      <h1>Sign In</h1>
      <OxySignInButton />
    </div>
  );
}
```

### Authentication Methods

| Method | When Used | User Experience |
|--------|-----------|-----------------|
| **FedCM** | Chrome/Safari/Edge 108+ with prior sign-in | Instant, no UI |
| **Popup** | User clicks sign in, FedCM unavailable | Popup window opens |
| **Redirect** | Mobile browsers where popups are blocked | Full page redirect |

**The provider handles method selection automatically.** You don't need to configure anything.

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
6. Add keychain group: `group.so.oxy.shared`

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
    android:sharedUserId="so.oxy.shared">

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

The Oxy auth server runs at `auth.oxy.so`. If you're self-hosting, ensure these endpoints are available:

### FedCM Endpoints (Required for cross-domain SSO)

| Path | Method | Purpose |
|------|--------|---------|
| `/fedcm.json` | GET | FedCM configuration |
| `/.well-known/web-identity` | GET | FedCM provider discovery |
| `/api/fedcm/accounts` | GET | List user accounts for FedCM |
| `/api/fedcm/assertion` | POST | Issue ID tokens |

### API Endpoints (at api.oxy.so)

| Path | Method | Purpose |
|------|--------|---------|
| `/api/fedcm/exchange` | POST | Exchange ID token for session |
| `/api/sessions/*` | * | Session management |

### Auth UI Endpoints (at auth.oxy.so)

| Path | Purpose |
|------|---------|
| `/login` | Login page |
| `/signup` | Signup page |
| `/auth/callback` | Popup callback (auto-closes) |

### Requirements

- **HTTPS required** - FedCM only works over HTTPS
- **CORS configured** - API must accept requests from your domains

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

### SSO Not Working on Web

**Symptom:** User has to sign in on each domain

**Check:**
1. User must have signed in at `auth.oxy.so` at least once
2. Browser must support FedCM (Chrome 108+, Safari 16.4+, Edge 108+)
3. Both sites must be served over HTTPS
4. FedCM config accessible: `https://auth.oxy.so/fedcm.json`

**For Firefox/older browsers:** FedCM is not supported. Users will need to click "Sign In" which opens a popup. This is expected behavior.

### Popup Blocked

**Symptom:** "Popup blocked" error when signing in

**Solutions:**
1. Call `signIn()` directly from a click handler (not from setTimeout/async callback)
2. Ask user to allow popups for your domain
3. Mobile browsers may require redirect instead (handled automatically)

### Session Not Persisting

**Symptom:** User signed out after page reload

**Check:**
1. Ensure you're using `OxyProvider` or `WebOxyProvider` at the root of your app
2. Check browser localStorage is not blocked
3. Verify you're not in incognito/private mode

### iOS Keychain Sharing Not Working

**Symptom:** Shared identity returns null across apps

**Requirements:**
1. All apps must have same keychain group: `group.so.oxy.shared`
2. Capability must be enabled in Xcode for ALL targets
3. All apps must be signed with same Apple Team ID
4. Test on real device (Simulator has limited keychain sharing)

### Android Shared Storage Not Working

**Symptom:** Sessions not shared between apps

**Requirements:**
1. All apps must have same `android:sharedUserId="so.oxy.shared"` in manifest
2. All apps must be signed with same certificate
3. Must reinstall apps after adding `sharedUserId` (can't change on update)

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
