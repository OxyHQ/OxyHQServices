# Oxy Authentication Guide

Complete guide for integrating Oxy authentication in any platform: Expo/React Native, Next.js, Vite, Node.js backends, and WebSockets.

> **Wave 2 (device-first, 2026-07):** FedCM, the `/sso` bounce, the `/auth/silent`
> iframe, and the `fedcm_session` / `oxy_rt_*` cookies were removed from the
> entire ecosystem. Sign-in is now device-first: a durable, first-party
> `oxy_device` cookie (`Domain=.oxy.so`) plus a per-origin rotating refresh-token
> family restore the session with zero redirects, and first-party sign-in is an
> **in-app SDK modal** — there is no more full-page bounce to `auth.oxy.so` for
> apps using `OxyProvider`/`WebOxyProvider`. See
> [Cross-Domain Authentication](./CROSS_DOMAIN_AUTH.md) and
> [Session Architecture](./SESSION-ARCHITECTURE.md) for the restore chain in
> detail. `auth.oxy.so` still exists, but only as a third-party OAuth
> authorize/consent IdP for apps that don't embed the SDK.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Frontend: Expo / React Native](#frontend-expo--react-native)
4. [Frontend: Web (Next.js, Vite, React)](#frontend-web-nextjs-vite-react)
5. [Backend: Node.js / Express](#backend-nodejs--express)
6. [WebSockets (Socket.IO)](#websockets-socketio)
7. [Token Lifecycle](#token-lifecycle)
8. [Authentication Methods](#authentication-methods)
9. [API Reference](#api-reference)
10. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Install

```bash
# Expo / React Native
bun add @oxyhq/services @oxyhq/core

# Web (Next.js / Vite / React)
bun add @oxyhq/auth @oxyhq/core react

# Node.js backend only
bun add @oxyhq/core
```

### 30-second integration

**Expo app:**
```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <Home />
    </OxyProvider>
  );
}

function Home() {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();
  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <Button onPress={() => signIn()} title="Sign In" />;
  return <Text>Hello {user?.name?.displayName}</Text>;
}
```

**Next.js / Vite app:**
```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

export default function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <Home />
    </WebOxyProvider>
  );
}

function Home() {
  const { user, isAuthenticated, isLoading, signIn, signOut } = useAuth();
  if (isLoading) return <Loading />;
  if (!isAuthenticated) return <button onClick={signIn}>Sign In</button>;
  return <p>Hello {user?.name?.displayName}</p>;
}
```

**Node.js backend:**
```typescript
import { OxyServices } from '@oxyhq/core';
import express from 'express';

const app = express();
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Protect routes with one line
app.use('/api/protected', oxy.auth());

app.get('/api/protected/me', (req, res) => {
  res.json({ userId: req.userId });
});
```

---

## Architecture Overview

```
                    ┌─────────────────────────┐
                    │      auth.oxy.so         │
                    │  Third-party OAuth IdP   │
                    │ (login/signup/authorize/ │
                    │  consent) + device-chooser│
                    └──────────┬──────────────┘
                               │ (OAuth authorize/consent only —
                               │  first-party apps below never bounce here)
         ┌─────────────────────┼─────────────────────┐
         │                     │                      │
   ┌─────┴─────┐       ┌──────┴──────┐       ┌───────┴──────┐
   │  Expo App  │       │  Web App    │       │ Your Backend │
   │ @oxyhq/    │       │ @oxyhq/auth │       │  @oxyhq/core │
   │  services  │       │             │       │  oxy.auth()  │
   └─────┬──────┘       └──────┬──────┘       └──────┬───────┘
         │                     │                      │
         └─────────────────────┼──────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │     api.oxy.so      │
                    │   (Oxy API Server)  │
                    │  oxy_device cookie, │
                    │  rotating refresh,  │
                    │  Sessions, Users    │
                    └─────────────────────┘
```

First-party apps (Expo/RN via `OxyProvider`, web via `WebOxyProvider`) never
redirect the user to `auth.oxy.so` — the SDK's device-first cold boot resolves
the session directly against `api.oxy.so`, and interactive sign-in is an in-app
modal. `auth.oxy.so` is only in the picture for OAuth authorize/consent (a
third-party app that doesn't embed the SDK) and for the device-account chooser
feed it reads via the same `oxy_device` cookie.

### Packages

| Package | Platform | Purpose |
|---------|----------|---------|
| `@oxyhq/core` | Any (Node, Browser, RN) | API client, device-first cold boot, token management, crypto |
| `@oxyhq/auth` | Web only (React) | `WebOxyProvider`, `useAuth` hook, in-app sign-in modal for web |
| `@oxyhq/services` | Expo / React Native | `OxyProvider`, `useAuth` hook, in-app sign-in modal + shared-keychain SSO for native |

### Key Concepts

- **Session-based tokens**: All auth uses session-based JWTs (contains `sessionId` claim)
- **Access token**: Short-lived JWT, auto-refreshed transparently via a rotating refresh-token family (`POST /auth/refresh-token`)
- **`oxy_device` cookie**: durable, `HttpOnly`, first-party (`Domain=.oxy.so`) device anchor — not itself a bearer token, but what lets a device rejoin its session set with zero redirects
- **Session**: Server-side record ties a token to a device
- **`oxyClient.auth()`**: One-line Express middleware for backend auth (third-party/general-purpose; internal Oxy ecosystem apps use `@oxyhq/core/server` instead — see [Session Architecture](./SESSION-ARCHITECTURE.md))
- **`oxyClient.authSocket()`**: One-line Socket.IO middleware for WebSocket auth

---

## Frontend: Expo / React Native

### Setup

```tsx
// App.tsx
import { OxyProvider } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <Navigation />
    </OxyProvider>
  );
}
```

`OxyProvider` handles everything automatically:
- Storage initialization (AsyncStorage on native, localStorage on web)
- Device-first cold boot on launch (stored refresh family → shared-keychain identity → nothing → signed-out; **never** an automatic redirect to a login page)
- Token auto-refresh
- WebSocket connection for real-time cross-device/cross-tab session sync
- Offline support

### useAuth Hook (Recommended)

```tsx
import { useAuth } from '@oxyhq/services';

function ProfileScreen() {
  const {
    user,                 // Current user object or null
    isAuthenticated,      // Boolean
    isLoading,            // True during initial auth check
    isReady,              // True when auth is resolved (authenticated or not)
    canUsePrivateApi,     // True only once cold boot resolved + authenticated + bearer token held
    isPrivateApiPending,  // True while resolving — gate private-API screens on this, not isAuthenticated alone
    error,                // Error string or null
    signIn,               // () => opens the in-app "Sign in with Oxy" modal (NEVER navigates to an IdP)
    signOut,              // () => Promise<void>
    signOutAll,           // () => Promise<void> - all sessions
    oxyServices,          // OxyServices instance for API calls
  } = useAuth();

  if (isLoading) return <ActivityIndicator />;
  if (!isAuthenticated) return <Button onPress={() => signIn()} title="Sign In" />;

  return (
    <View>
      <Text>Welcome, {user?.name?.displayName}</Text>
      <Button onPress={signOut} title="Sign Out" />
    </View>
  );
}
```

Gate any private-API screen (managed accounts, privacy, follow status, library,
profile settings, …) on `canUsePrivateApi` / `isPrivateApiPending`, not just
`isAuthenticated` — a session can be authenticated while its bearer token is
still being minted.

### useOxy Hook (Advanced)

For multi-account/device-session management and lower-level operations:

```tsx
import { useOxy } from '@oxyhq/services';

function SessionManager() {
  const {
    sessions,         // All device sessions known to this device
    activeSessionId,  // Current session ID
    switchSession,    // Switch to another device session by sessionId
    switchAccount,    // Switch to another local account by authuser index
  } = useOxy();

  return (
    <FlatList
      data={sessions}
      renderItem={({ item }) => (
        <TouchableOpacity onPress={() => switchSession(item.sessionId)}>
          <Text>{item.deviceName} {item.sessionId === activeSessionId ? '(active)' : ''}</Text>
        </TouchableOpacity>
      )}
    />
  );
}
```

### Making Authenticated API Calls

```tsx
import { useAuth } from '@oxyhq/services';

function DataScreen() {
  const { oxyServices, canUsePrivateApi } = useAuth();

  async function fetchData() {
    if (!canUsePrivateApi) return;
    // oxyServices is already authenticated - just call API methods
    const user = await oxyServices.getCurrentUser();
  }
}
```

---

## Frontend: Web (Next.js, Vite, React)

### Setup

```tsx
// app/layout.tsx (Next.js) or App.tsx (Vite)
import { WebOxyProvider } from '@oxyhq/auth';

export default function RootLayout({ children }) {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      {children}
    </WebOxyProvider>
  );
}
```

`WebOxyProvider` handles, via the shared device-first cold boot:
- Same-apex fast path: an inline credentialed `POST /auth/device/web-session` fetch — no redirect, runs on every load
- Cross-apex restore: a **one-time-ever per browser+origin** top-level hop to the API's `GET /auth/device/bootstrap` and back (fires once on first load, regardless of outcome, then never again for that browser+origin)
- A persisted, per-origin rotating refresh-token family (`POST /auth/refresh-token`)
- Token auto-refresh (reactive on 401 + a proactive scheduler)
- The in-app "Sign in with Oxy" modal, rendered by the provider itself

`WebOxyProvider` **never** redirects the page to `auth.oxy.so` to sign a user
in. There is no FedCM, no popup, and no full-page redirect flow in this
provider — `signIn()` only opens the in-app modal.

### useAuth Hook

```tsx
import { useAuth } from '@oxyhq/auth';

function NavBar() {
  const {
    user,             // Current user or null
    isAuthenticated,  // Boolean
    isLoading,        // True during init
    isReady,          // True when auth resolved
    error,            // Error string or null
    signIn,           // () => void — opens the in-app sign-in modal
    signOut,
    oxyServices,      // OxyServices instance
  } = useAuth();

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <button onClick={signIn}>Sign In</button>;

  return (
    <div>
      <span>{user?.name?.displayName}</span>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

### Sign-in UI (Web)

`WebOxyProvider` renders its own `OxySignInModal`. Calling `signIn()` just
toggles it open — password + 2FA (`POST /auth/login` → `POST
/security/2fa/verify-login`) and the "Sign in with Oxy" QR handoff (Commons) are
both available inside it. There is nothing else to wire up.

### Next.js App Router

```tsx
// app/providers.tsx
'use client';
import { WebOxyProvider } from '@oxyhq/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
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

### Vite

```tsx
// src/App.tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so" clientId="oxy_dk_...">
      <MyApp />
    </WebOxyProvider>
  );
}
```

---

## Backend: Node.js / Express

### Using `oxy.auth()` Middleware

The simplest way to add authentication to your Express backend. One line per route.

```typescript
import { OxyServices } from '@oxyhq/core';
import express from 'express';

const app = express();
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// === Protected routes (token required) ===
app.use('/api/protected', oxy.auth());

app.get('/api/protected/profile', (req, res) => {
  // req.userId   - User ID string
  // req.user     - { id: string } (or full User if loadUser: true)
  // req.accessToken - Raw JWT token
  // req.sessionId   - Session ID (if session-based token)
  res.json({ userId: req.userId });
});

// === Load full user profile ===
app.use('/api/admin', oxy.auth({ loadUser: true }));

app.get('/api/admin/dashboard', (req, res) => {
  // req.user now has full User object (username, email, avatar, etc.)
  res.json({ user: req.user });
});

// === Optional auth (public routes that benefit from user context) ===
app.use('/api/feed', oxy.auth({ optional: true }));

app.get('/api/feed', (req, res) => {
  if (req.userId) {
    // Personalized feed
  } else {
    // Public feed
  }
});

// === Debug mode ===
app.use('/api/debug', oxy.auth({ debug: true }));
// Logs: [oxy.auth] GET /api/debug/test | token: true
// Logs: [oxy.auth] OK user=abc123 session=def456
```

> **Internal Oxy ecosystem apps use `@oxyhq/core/server` instead**
> (`createOxyAuthMiddleware`, `requireOxyAuth`, `getRequiredOxyUserId`) — see
> [Session Architecture](./SESSION-ARCHITECTURE.md#backend-auth-contract).
> `oxy.auth()` on the `OxyServices` client instance (documented here) is the
> general-purpose middleware for any backend, including third-party apps that
> aren't part of the Oxy monorepo.

### How `oxy.auth()` Works

1. Extracts JWT from `Authorization: Bearer <token>` header
2. Decodes JWT to check claims and expiration (decode-only for user tokens — security comes from server-side session validation, not signature verification; service tokens ARE cryptographically verified when `jwtSecret` is supplied)
3. **Validates session server-side** via `GET /session/validate/:sessionId` (ensures the session isn't revoked)
4. Attaches `req.userId`, `req.user`, `req.accessToken`, `req.sessionId` to the request
5. Calls `next()` to continue to your route handler

### Options

| Option | Type | Default | Description |
|--------|------|---------|--------------|
| `debug` | boolean | `false` | Log auth decisions to console |
| `loadUser` | boolean | `false` | Fetch full user profile from API |
| `optional` | boolean | `false` | Don't block if no token present |
| `onError` | function | - | Custom error handler |
| `jwtSecret` | string | - | Secret for verifying **service** tokens locally (pass the API's `SERVICE_TOKEN_SECRET` — never the access-token secret) |
| `expectedIssuer` / `expectedAudience` | string | `'oxy-auth'` / `'oxy-api'` | Override only for a private fork under different JWT claims |

### Making Authenticated API Calls from Backend

```typescript
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Set token for server-to-server calls
oxy.setTokens(accessToken);
const user = await oxy.getCurrentUser();

// Or use the token from a request
app.get('/api/data', oxy.auth(), async (req, res) => {
  // Create a per-request OxyServices instance for concurrent safety
  const oxyReq = new OxyServices({ baseURL: 'https://api.oxy.so' });
  oxyReq.setTokens(req.accessToken);

  const userData = await oxyReq.getCurrentUser();
  res.json(userData);
});
```

### Custom Error Handling

```typescript
app.use('/api', oxy.auth({
  onError: (error) => {
    // error: { message, code, status }
    // Codes: MISSING_TOKEN, INVALID_TOKEN_FORMAT, INVALID_TOKEN_PAYLOAD,
    //        TOKEN_EXPIRED, INVALID_SESSION, SESSION_VALIDATION_ERROR
    console.error('Auth failed:', error.code);
  }
}));
```

---

## WebSockets (Socket.IO)

### Server-Side: Using `oxy.authSocket()`

```typescript
import { OxyServices } from '@oxyhq/core';
import { Server } from 'socket.io';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
const io = new Server(server);

// One line to authenticate all socket connections
io.use(oxy.authSocket());

io.on('connection', (socket) => {
  // socket.data.userId    - Authenticated user ID
  // socket.data.sessionId - Session ID
  // socket.user.id        - Same as userId (backward compat)

  const userId = socket.data.userId;
  socket.join(`user:${userId}`); // always derive rooms from the authenticated userId, never a client-supplied id

  socket.on('message', (data) => {
    // Handle authenticated messages
  });
});
```

### Client-Side: Connecting with Auth Token

**From Expo / React Native:**
```typescript
import { useAuth } from '@oxyhq/services';
import { io } from 'socket.io-client';

function ChatScreen() {
  const { oxyServices } = useAuth();

  useEffect(() => {
    const token = oxyServices.getAccessToken();
    const socket = io('https://api.oxy.so', {
      auth: { token },
    });

    socket.on('connect', () => console.log('Connected'));
    return () => { socket.disconnect(); };
  }, []);
}
```

**From Web (Next.js / Vite):**
```typescript
import { useAuth } from '@oxyhq/auth';
import { io } from 'socket.io-client';

function Chat() {
  const { oxyServices } = useAuth();

  useEffect(() => {
    const token = oxyServices.getAccessToken();
    const socket = io('https://api.oxy.so', {
      auth: { token },
    });

    socket.on('connect', () => console.log('Connected'));
    return () => { socket.disconnect(); };
  }, []);
}
```

**From Node.js backend:**
```typescript
import { io } from 'socket.io-client';

const socket = io('https://api.oxy.so', {
  auth: { token: accessToken },
});
```

---

## Token Lifecycle

```
┌──────────┐   signIn/signUp    ┌──────────────┐
│  Client   │ ────────────────> │  Oxy API     │
│  (App)    │                   │  api.oxy.so  │
│           │ <──────────────── │              │
│           │   session bundle  │              │
│           │   {accessToken,   │              │
│           │    refreshToken,  │              │
│           │    sessionId,     │              │
│           │    expiresAt,     │              │
│           │    user}          │              │
└─────┬─────┘                   └──────────────┘
      │
      │  Persisted per-origin (web) / per-device (native) refresh
      │  family, keyed to a durable `oxy_device` cookie / device
      │  identity — this is what a reload/relaunch resolves against
      │  before ever considering a redirect or bounce.
      │
      │  Auto-refresh happens:
      │  1. Proactive scheduler: ahead of access-token expiry
      │  2. Reactive: on a 401, rotate via POST /auth/refresh-token
      │
      ▼
┌──────────────────────────────────────┐
│  Every API request includes:          │
│  Authorization: Bearer <accessToken>  │
│                                       │
│  If token expires during request:     │
│  → Auto-refreshed transparently       │
│  → Request retried with new token     │
└──────────────────────────────────────┘
```

### Token Details

| Token | Storage | Purpose |
|-------|----------|---------|
| Access Token | Memory + storage | API authentication (short-lived JWT) |
| Refresh Token | Rotating, single-use, hash-stored server-side | `POST /auth/refresh-token` mints a fresh access token + the next refresh token in the family; reuse of an already-rotated token revokes the whole family |
| `oxy_device` cookie | `HttpOnly`, `Domain=.oxy.so`, 400-day sliding | Durable device anchor (not a bearer credential itself) that lets the device rejoin its session set with zero redirects |

### Auto-Refresh

Token refresh is handled at two levels (defense in depth):

1. **Proactive**: a scheduler in `@oxyhq/core` refreshes ahead of access-token expiry
2. **Reactive**: on a 401, the SDK rotates the persisted refresh-token family via `POST /auth/refresh-token`

---

## Authentication Methods

### 1. Public Key (Cryptographic Identity) - Expo/RN Primary

Used by native apps. The device stores a private key securely; authentication is done via challenge-response.

```
Client                          Server
  │                               │
  │  POST /auth/challenge         │
  │  { publicKey }                │
  │  ─────────────────────────>   │
  │                               │
  │  { challenge, expiresAt }     │
  │  <─────────────────────────   │
  │                               │
  │  Sign challenge with          │
  │  private key                  │
  │                               │
  │  POST /auth/verify            │
  │  { publicKey, challenge,      │
  │    signature, timestamp }     │
  │  ─────────────────────────>   │
  │                               │
  │  { accessToken, sessionId,    │
  │    user, expiresAt }          │
  │  <─────────────────────────   │
```

### 2. Password (Email/Username) + 2FA

```typescript
// Sign up
const session = await oxyServices.signUp('username', 'email@example.com', 'password');

// Sign in
const session = await oxyServices.signIn('email@example.com', 'password');
// If the account has 2FA enabled, the sign-in flow calls
// POST /security/2fa/verify-login to complete the session — the in-app
// sign-in modal (web + native) handles this step for you.
```

### 3. Shared-keychain SSO (Native, cross-app on one device)

Native apps signed in via a Commons-issued shared identity automatically join
one another's session on the same device — the `shared-key-signin` cold-boot
step re-mints a session from the shared keychain identity with no user
interaction. See [Cross-Domain Authentication](./CROSS_DOMAIN_AUTH.md).

### 4. "Sign in with Oxy" QR handoff (cross-device)

Scan a QR with Commons (or tap a same-device deep link) to sign in without
typing a password. Surfaced inside the in-app sign-in modal on both web and
native. See [Cross-Domain Authentication](./CROSS_DOMAIN_AUTH.md).

### 5. OAuth authorize/consent (third-party apps only)

Apps that don't embed the SDK integrate against `auth.oxy.so` as a standard
OAuth 2 authorize/consent IdP. First-party/internal/official apps (staff-set
`Application` flags) auto-approve; ordinary third-party apps show a consent
screen. This is unrelated to the in-app modal above, which first-party SDK
consumers use instead.

---

## API Reference

### OxyServices Auth Methods

```typescript
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Token management
oxy.setTokens(accessToken);              // Set auth token
oxy.clearTokens();                        // Clear auth tokens
oxy.getAccessToken();                     // Get current token
oxy.hasValidToken();                      // Check if token exists
oxy.getCurrentUserId();                   // Get userId from token
await oxy.validate();                     // Validate token with server

// Password auth
await oxy.signIn(identifier, password);   // Email/username + password
await oxy.signUp(username, email, pass);  // Register with password

// Public key auth
await oxy.requestChallenge(publicKey);    // Get challenge
await oxy.verifyChallenge(pubKey, challenge, sig, ts); // Verify + create session (plants tokens internally)

// Session management
await oxy.validateSession(sessionId);     // Validate session
await oxy.logoutSession(sessionId);       // Logout specific session
await oxy.logoutAllSessions(sessionId);   // Logout all sessions

// Express middleware
app.use(oxy.auth());                      // Protect routes
app.use(oxy.auth({ optional: true }));    // Optional auth
app.use(oxy.auth({ loadUser: true }));    // Full user object

// Socket.IO middleware
io.use(oxy.authSocket());                 // Authenticate sockets
```

### REST Endpoints

All endpoints are mounted directly under the API root — there is **no** `/api`
prefix (e.g. `https://api.oxy.so/auth/login`, not `.../api/auth/login`).

| Endpoint | Method | Auth | Description |
|----------|--------|------|--------------|
| `/auth/signup` | POST | No | Register with email/password |
| `/auth/login` | POST | No | Login with email/password |
| `/auth/challenge` | POST | No | Request auth challenge |
| `/auth/verify` | POST | No | Verify signed challenge |
| `/auth/register` | POST | No | Register with public key |
| `/auth/refresh-token` | POST | No (refresh token in body) | Rotate the persisted refresh-token family |
| `/security/2fa/verify-login` | POST | No (login ticket in body) | Complete a password sign-in that requires 2FA |
| `/session/validate/:sessionId` | GET | No | Validate session |
| `/session/token/:sessionId` | GET | No | Get/refresh access token for a session |

---

## Troubleshooting

### Token refresh fails

The client rotates the refresh-token family via `POST /auth/refresh-token`. If this fails:
- The session may have been revoked (signed out from another device, or reuse detection tripped the family)
- Network connectivity issues (client retries with backoff)

### `oxy.auth()` returns 401

- Check that the token is being sent in the `Authorization: Bearer <token>` header
- Check that the session hasn't been revoked server-side
- The middleware validates sessions against the API, not just JWT decode

### Socket connection fails with "Authentication error"

- Ensure token is passed in `socket.handshake.auth.token`
- Token must be a valid, non-expired JWT
- Session must still be active on the server

### Sign-in modal doesn't appear / `signIn()` does nothing visible

- Confirm the app is wrapped in `OxyProvider` / `WebOxyProvider` with a registered `clientId`
- `signIn()` only toggles the in-app modal open — it never navigates away. If nothing renders, check that the provider's children aren't unmounted/hidden.

### Cross-app / cross-device session isn't restoring

- Native: shared-keychain SSO requires the app to share the `group.so.oxy.shared` keychain group (iOS) / `sharedUserId` (Android) — see [Cross-Domain Authentication](./CROSS_DOMAIN_AUTH.md)
- Web, same apex (e.g. two `*.oxy.so` apps): should restore via the inline `POST /auth/device/web-session` fetch on every load — check the `oxy_device` cookie isn't being blocked
- Web, cross-apex (e.g. `mention.earth` after signing in on `oxy.so`): restores via **one** top-level hop to `api.oxy.so`'s bootstrap endpoint (a single canonical host, no per-apex CNAME) — this happens on the very first load in a given browser regardless of whether a session is found, and never repeats for that browser+origin afterward
