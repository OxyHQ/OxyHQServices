# Cross-Domain Authentication for Oxy Ecosystem

Zero-config cross-domain SSO across all Oxy apps (homiio.com, mention.earth, alia.onl, oxy.so, etc.), device-first — no FedCM, no third-party cookies, no `/sso` bounce loop.

## Overview

Sign in once on any Oxy app and be automatically authenticated across all Oxy
domains, on both web and native. There is no browser identity-federation API
involved (FedCM was removed in the wave-2 device-first cutover) — the
mechanism is a durable, first-party device cookie plus a persisted rotating
refresh-token family.

The callback and cold-boot behavior lives entirely in the shared SDK:

- `@oxyhq/core` owns the device-first cold boot (`runSessionColdBoot`) and every helper it uses.
- `OxyProvider` (`@oxyhq/services`) and `WebOxyProvider` (`@oxyhq/auth`) are thin bindings over it.
- Apps must not implement local session-restore routes or helper copies.
- Auth-dependent UI and private fetches should render only after the provider's
  cold boot is resolved (`isAuthResolved` / `isLoading === false`, or
  `canUsePrivateApi` on native for the bearer-token-ready check).

### How It Works

- **Web**: a durable `HttpOnly` `oxy_device` cookie (`Domain=.oxy.so`) plus a persisted, per-origin rotating refresh-token family. Same-apex apps resolve inline (no navigation); a cross-apex app does **one** top-level hop, ever, per browser+origin.
- **Native**: iOS Keychain Sharing / Android shared user ID — a shared cryptographic identity, exactly as before wave 2.

### Key Features

- **No third-party cookies, no FedCM** — the device cookie is first-party to `*.oxy.so`; the browser never needs a federated-identity API
- **Zero config** — just wrap with `OxyProvider` / `WebOxyProvider` and cross-domain SSO works automatically
- **Cross-TLD** — works across completely different domains (not just subdomains), via the one-time bootstrap hop
- **At most one visible navigation, ever** — a cross-apex app takes exactly one top-level round trip to `api.oxy.so` and back the very first time it ever loads in a given browser (whether or not the device turns out to have a session), then never again for that browser+origin

---

## Quick Start

### Which Provider Should I Use?

| Your App Type | Use This Provider | Why |
|--------------|-------------------|-----|
| **Expo 54+ app** (native + web) | `OxyProvider` | Already handles web + native platforms |
| **Pure web app** (React/Next.js, NO Expo) | `WebOxyProvider` from `@oxyhq/auth` | Web-only, lighter bundle |

**IMPORTANT:**
- **If you're using Expo**, use `OxyProvider` from `@oxyhq/services` -- it already handles web in addition to native
- **NEVER use `WebOxyProvider` in Expo apps** -- it is only for pure React/Next.js projects without Expo
- `OxyProvider` works seamlessly on iOS, Android, AND web when used with Expo

---

### Expo Apps

For **Expo 54+ apps** (works on native + web):

```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <YourApp />
    </OxyProvider>
  );
}

function MyComponent() {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();

  if (isLoading) {
    return <Loading />;
  }

  if (!isAuthenticated) {
    return <Button onPress={() => signIn()} title="Sign In" />;
  }

  return <Text>Welcome, {user?.name?.displayName}!</Text>;
}
```

**That's it!** Cross-domain SSO works automatically on all platforms (iOS, Android, and web). If a user is signed in on any Oxy domain, they're automatically signed in on your app.

### Pure React/Next.js Apps (Web Only)

**Only use this if you're NOT using Expo/React Native:**

```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <YourApp />
    </WebOxyProvider>
  );
}
```

**Don't use `WebOxyProvider` in Expo apps** -- use `OxyProvider` from `@oxyhq/services` instead.

---

## How It Works

### Web (device-first)

```
┌─────────────┐                          ┌─────────────┐
│ homiio.com  │                          │mention.earth│
│             │                          │             │
│  User signs │  1st load ever: ONE       │  Same-apex  │
│  in here    │  top-level hop to         │  reload:    │
│             │  api.oxy.so/auth/device/  │  inline     │
│             │  bootstrap and back        │  fetch, no  │
│             │  (never repeats)           │  navigation │
│  Instant    │                          │             │
│  auth!      │                          │  Instant    │
└─────────────┘                          │  auth!      │
                                          └─────────────┘
```

1. User signs in on any Oxy app (in-app modal — no redirect for first-party apps)
2. The API mints/refreshes a durable, `HttpOnly`, first-party `oxy_device` cookie (`Domain=.oxy.so`) bound to that device, and a rotating refresh-token family the app persists locally
3. On a same-apex reload (e.g. another `*.oxy.so` app), the cold boot's `bootstrap-hop` step does an inline, credentialed `POST /auth/device/web-session` fetch — no navigation at all
4. On a **different apex** (e.g. `mention.earth`, `homiio.com`), the cold boot does **one** top-level navigation, ever, per browser+origin, to `api.oxy.so`'s `GET /auth/device/bootstrap` (a single canonical host — no per-apex CNAME needed), which reads the shared device cookie and 303s straight back with the result in a `#oxy_boot` fragment
5. That one hop happens on the **very first load** in a given browser regardless of whether the device turns out to have a session — it's what lets the SDK know either way without ever repeating. If it found a session, a single-use boot code in the fragment is exchanged for tokens; if not, the app renders signed-out and the flag is set so it never hops again for that origin

### Native (Keychain Sharing) — unchanged by wave 2

```
┌────────────┐         ┌──────────────────┐         ┌────────────┐
│  Homiio    │         │  iOS Keychain    │         │  Mention   │
│   App      │  Write  │  Shared Group    │  Read   │   App      │
│            ├────────▶│ (group.so.oxy)   │◀────────┤            │
│ Signs in   │         │                  │         │ Launches   │
│            │         │  Identity +      │         │            │
│            │         │  shared session  │         │ Instant    │
│            │         │  stored          │         │ auth!      │
└────────────┘         └──────────────────┘         └────────────┘
```

This mechanism was not part of the FedCM/SSO deletion — it is a separate,
still-current path: the cold boot's `shared-key-signin` step re-mints a
session from the shared-keychain identity automatically, with no user
interaction, the first time a second Oxy app launches on the same device.

---

## Web Implementation

### Using useAuth Hook (Recommended)

The `useAuth` hook handles everything automatically:

```tsx
import { useAuth } from '@oxyhq/auth';

function LoginButton() {
  const { isAuthenticated, user, signIn, signOut, isLoading } = useAuth();

  if (isLoading) return <Spinner />;

  if (isAuthenticated) {
    return (
      <div>
        <span>Hi, {user?.name?.displayName}!</span>
        <button onClick={signOut}>Sign Out</button>
      </div>
    );
  }

  return <button onClick={signIn}>Sign In</button>;
}
```

**What happens when `signIn()` is called:** the in-app "Sign in with Oxy" modal
opens (password + 2FA, or the QR/Commons handoff). It never navigates the page
away. Cross-domain restore for an *already signed-in* device happens
automatically on mount, before the user ever needs to click anything — see
"How It Works" above.

### Authentication Methods (interactive)

| Method | When Used | User Experience |
|--------|-----------|-----------------|
| **Password + 2FA** | User opens the in-app modal | Modal form, no navigation |
| **"Sign in with Oxy" QR/handoff** | User opens the in-app modal, scans with Commons | QR code or same-device deep link |

**The provider renders and owns this modal itself.** You don't need to build sign-in UI.

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

#### 2. Use Shared Identity (usually automatic)

`OxyProvider`'s cold boot already tries the shared-keychain identity via its
`shared-key-signin` step — most apps never need to call these directly. The
underlying `KeyManager` API (`@oxyhq/core`), for lower-level or diagnostic use:

```typescript
import { KeyManager } from '@oxyhq/core';

// Create shared identity (only needed once across all apps)
const hasShared = await KeyManager.hasSharedIdentity();
if (!hasShared) {
  // Migrate local identity to shared (for existing users)
  await KeyManager.migrateToSharedIdentity();
}

// Get shared public key (works in all Oxy apps)
const publicKey = await KeyManager.getSharedPublicKey();

// Check for a session already established by another Oxy app on this device
const session = await KeyManager.getSharedSession();
if (session) {
  oxyServices.setTokens(session.accessToken);
  const user = await oxyServices.getCurrentUser();
}
```

The shared keychain also carries a **shared device token**
(`KeyManager.getSharedDeviceToken` / `setSharedDeviceToken` /
`clearSharedDeviceToken`, added in wave 2) — an opaque, add-only attribution
token every native Oxy app on the device mirrors so they're recognized as the
same device server-side. `OxyProvider`'s cold boot manages this automatically.

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

Android automatically shares SecureStore data between apps with the same `sharedUserId`; the same `KeyManager` API above applies.

---

## Auth Server Setup

`auth.oxy.so` (`packages/auth`) is a third-party OAuth authorize/consent IdP
plus the device-account chooser feed — it is **not** in the restore path for
first-party apps using `OxyProvider`/`WebOxyProvider` except for the one-time
cross-apex bootstrap hop described above. If you're integrating a third-party
app that does NOT embed the SDK, integrate against its OAuth authorize/consent
endpoints instead of anything in this document.

### Requirements

- **HTTPS required** in production
- **CORS configured** — the API only accepts credentialed requests from registered app origins (plus loopback dev origins on any port)

---

## Troubleshooting

### Cross-domain restore not working on web

**Symptom:** User has to sign in again on a different Oxy domain

**Check:**
1. The user must have an existing session (a brand-new, never-signed-in device is not bounced — sign in explicitly once)
2. Both sites must be served over HTTPS (or both on an `http://localhost`/loopback dev origin)
3. The `oxy_device` cookie must not be blocked — it's `HttpOnly` + `Secure` + `Domain=.oxy.so`, so browser settings that block all third-party or all cookies from `oxy.so` will break it (it is first-party from the API's perspective, not a tracking cookie)
4. The one-time cross-apex hop only fires once per browser+origin ever (`localStorage` flag) — if it already ran and returned signed-out, it will not retry automatically; sign in explicitly

### Session Not Persisting

**Symptom:** User signed out after page reload

**Check:**
1. Ensure you're using `OxyProvider` or `WebOxyProvider` at the root of your app
2. Check browser localStorage is not blocked
3. Verify you're not in incognito/private mode (the persisted refresh-token family and `oxy_device` cookie won't survive a private session close)

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

### Do's

- **Do** wrap every app in `OxyProvider` / `WebOxyProvider` with a registered `clientId` and let it own cold boot
- **Do** gate private-API calls on `canUsePrivateApi` / `isPrivateApiPending` (native) or `isLoading`/`isReady` (web), not just `isAuthenticated`
- **Do** test cross-app native SSO on real devices (iOS Keychain Sharing)

### Don'ts

- **Don't** implement a local session-restore, callback route, or FedCM-era helper copy in an app — it all lives in `@oxyhq/core`
- **Don't** mix local and shared native storage
- **Don't** skip iOS Keychain Sharing capability
- **Don't** change Android `sharedUserId` after publish
