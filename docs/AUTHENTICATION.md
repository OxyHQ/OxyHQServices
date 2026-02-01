# Oxy Authentication Guide

Complete guide for integrating Oxy authentication in any platform: Expo/React Native, Next.js, Vite, Node.js backends, and WebSockets.

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
npm install @oxyhq/services @oxyhq/core

# Web (Next.js / Vite / React)
npm install @oxyhq/auth @oxyhq/core react

# Node.js backend only
npm install @oxyhq/core
```

### 30-second integration

**Expo app:**
```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <Home />
    </OxyProvider>
  );
}

function Home() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();
  if (!isAuthenticated) return <Button onPress={signIn} title="Sign In" />;
  return <Text>Hello {user?.username}</Text>;
}
```

**Next.js / Vite app:**
```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

export default function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <Home />
    </WebOxyProvider>
  );
}

function Home() {
  const { user, isAuthenticated, signIn, signOut } = useAuth();
  if (!isAuthenticated) return <button onClick={signIn}>Sign In</button>;
  return <p>Hello {user?.username}</p>;
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
                    │   (Identity Provider)    │
                    │   FedCM / Popup / Redir  │
                    └──────────┬──────────────┘
                               │
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
                    │  Sessions, Tokens,  │
                    │  Users, etc.        │
                    └─────────────────────┘
```

### Packages

| Package | Platform | Purpose |
|---------|----------|---------|
| `@oxyhq/core` | Any (Node, Browser, RN) | API client, token management, crypto |
| `@oxyhq/auth` | Web only (React) | `WebOxyProvider`, `useAuth` hook for web |
| `@oxyhq/services` | Expo / React Native | `OxyProvider`, `useAuth` hook for native |

### Key Concepts

- **Session-based tokens**: All auth uses session-based JWTs (contains `sessionId` claim)
- **Access token**: Short-lived JWT (15 min), auto-refreshed transparently
- **Session**: Server-side record lasting 7 days, ties token to device
- **`oxyClient.auth()`**: One-line Express middleware for backend auth
- **`oxyClient.authSocket()`**: One-line Socket.IO middleware for WebSocket auth

---

## Frontend: Expo / React Native

### Setup

```tsx
// App.tsx
import { OxyProvider } from '@oxyhq/services';

export default function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <Navigation />
    </OxyProvider>
  );
}
```

`OxyProvider` handles everything automatically:
- Storage initialization (AsyncStorage on native, localStorage on web)
- Session restoration on app launch
- Token auto-refresh
- WebSocket connection for real-time session sync
- Offline support

### useAuth Hook (Recommended)

```tsx
import { useAuth } from '@oxyhq/services';

function ProfileScreen() {
  const {
    user,            // Current user object or null
    isAuthenticated, // Boolean
    isLoading,       // True during initial auth check
    isReady,         // True when auth is resolved (authenticated or not)
    error,           // Error string or null
    signIn,          // () => Promise<void> - opens sign-in flow
    signOut,         // () => Promise<void>
    signOutAll,      // () => Promise<void> - all sessions
    refresh,         // () => Promise<void> - refresh sessions
    oxyServices,     // OxyServices instance for API calls
  } = useAuth();

  if (isLoading) return <ActivityIndicator />;
  if (!isAuthenticated) return <Button onPress={signIn} title="Sign In" />;

  return (
    <View>
      <Text>Welcome, {user.username}</Text>
      <Button onPress={signOut} title="Sign Out" />
    </View>
  );
}
```

### useOxy Hook (Advanced)

For multi-session management, language settings, and lower-level operations:

```tsx
import { useOxy } from '@oxyhq/services';

function SessionManager() {
  const {
    sessions,         // All active sessions
    activeSessionId,  // Current session ID
    switchSession,    // Switch to another session
    refreshSessions,  // Refresh session list
    currentLanguage,  // Current language code
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
  const { oxyServices, isAuthenticated } = useAuth();

  async function fetchData() {
    // oxyServices is already authenticated - just call API methods
    const user = await oxyServices.getCurrentUser();
    const sessions = await oxyServices.getSessionsBySessionId(sessionId);
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
    <WebOxyProvider baseURL="https://api.oxy.so">
      {children}
    </WebOxyProvider>
  );
}
```

`WebOxyProvider` handles:
- Redirect callback detection (if returning from auth.oxy.so)
- Session restoration from localStorage
- Silent sign-in via FedCM (cross-domain SSO)
- Token auto-refresh

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
    signIn,           // Auto-selects best method (FedCM > Popup > Redirect)
    signInWithFedCM,  // Force FedCM
    signInWithPopup,  // Force popup
    signInWithRedirect, // Force redirect
    signOut,
    isFedCMSupported, // () => boolean
    oxyServices,      // OxyServices instance
    authManager,      // AuthManager instance
  } = useAuth();

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <button onClick={signIn}>Sign In</button>;

  return (
    <div>
      <span>{user.username}</span>
      <button onClick={signOut}>Sign Out</button>
    </div>
  );
}
```

### Auth Methods (Web)

| Method | How it works | Browser support |
|--------|-------------|-----------------|
| **FedCM** | Browser-native identity UI, no popups/redirects | Chrome 108+, Edge 108+ |
| **Popup** | Opens auth.oxy.so in a popup window | All browsers |
| **Redirect** | Full-page redirect to auth.oxy.so and back | All browsers |
| **Auto** (default) | Tries FedCM first, falls back to Popup, then Redirect | All browsers |

### Next.js App Router

```tsx
// app/providers.tsx
'use client';
import { WebOxyProvider } from '@oxyhq/auth';

export function Providers({ children }: { children: React.ReactNode }) {
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

### Vite

```tsx
// src/App.tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
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

### How `oxy.auth()` Works

1. Extracts JWT from `Authorization: Bearer <token>` header (or `?token=` / `?access_token=` query params)
2. Decodes JWT to check claims and expiration
3. **Validates session server-side** via `GET /api/session/validate/:sessionId` (ensures session isn't revoked)
4. Attaches `req.userId`, `req.user`, `req.accessToken`, `req.sessionId` to the request
5. Calls `next()` to continue to your route handler

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | boolean | `false` | Log auth decisions to console |
| `loadUser` | boolean | `false` | Fetch full user profile from API |
| `optional` | boolean | `false` | Don't block if no token present |
| `onError` | function | - | Custom error handler |

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
  socket.join(`user:${userId}`);

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
│           │   SessionResponse │              │
│           │   {accessToken,   │              │
│           │    sessionId,     │              │
│           │    expiresAt,     │              │
│           │    user}          │              │
└─────┬─────┘                   └──────────────┘
      │
      │  Token stored in:
      │  - Expo: AsyncStorage
      │  - Web: localStorage
      │  - Backend: in-memory
      │
      │  Auto-refresh happens:
      │  1. AuthManager: 5 min before session expiry
      │  2. HttpService: 60 sec before token expiry
      │     via GET /api/session/token/:sessionId
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

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access Token | 15 minutes | Memory + storage | API authentication |
| Session | 7 days | Server (MongoDB) | Ties token to device |
| Refresh | Automatic | Via sessionId | Get new access token |

### Auto-Refresh

Token refresh is handled at two levels (defense in depth):

1. **AuthManager** (proactive): Schedules refresh 5 minutes before session expiry
2. **HttpService** (reactive): Checks token expiry before each request, refreshes if <60 seconds remaining

Both use `GET /api/session/token/:sessionId` which returns a fresh access token.

---

## Authentication Methods

### 1. Public Key (Cryptographic Identity) - Expo/RN Primary

Used by native apps. The device stores a private key securely; authentication is done via challenge-response.

```
Client                          Server
  │                               │
  │  POST /api/auth/challenge     │
  │  { publicKey }                │
  │  ─────────────────────────>   │
  │                               │
  │  { challenge, expiresAt }     │
  │  <─────────────────────────   │
  │                               │
  │  Sign challenge with          │
  │  private key                  │
  │                               │
  │  POST /api/auth/verify        │
  │  { publicKey, challenge,      │
  │    signature, timestamp }     │
  │  ─────────────────────────>   │
  │                               │
  │  { accessToken, sessionId,    │
  │    user, expiresAt }          │
  │  <─────────────────────────   │
```

### 2. Password (Email/Username) - Web and Legacy

```typescript
// Sign up
const session = await oxyServices.signUp('username', 'email@example.com', 'password');

// Sign in
const session = await oxyServices.signIn('email@example.com', 'password');
```

### 3. FedCM (Federated Credential Management) - Web Cross-Domain SSO

Browser-native identity federation. No popups or redirects needed.

```typescript
// Automatic (recommended)
const { signIn } = useAuth(); // from @oxyhq/auth
await signIn(); // Tries FedCM first, falls back to popup/redirect

// Force FedCM
const { signInWithFedCM } = useAuth();
await signInWithFedCM();
```

### 4. Popup - Web Fallback

Opens auth.oxy.so in a popup window for authentication.

```typescript
const { signInWithPopup } = useAuth();
await signInWithPopup();
```

### 5. Redirect - Web Universal Fallback

Full-page redirect to auth.oxy.so and back.

```typescript
const { signInWithRedirect } = useAuth();
signInWithRedirect(); // Navigates away, returns with token in URL
```

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
await oxy.waitForAuth(5000);              // Wait for auth to be ready
await oxy.validate();                     // Validate token with server

// Password auth
await oxy.signIn(identifier, password);   // Email/username + password
await oxy.signUp(username, email, pass);  // Register with password

// Public key auth
await oxy.requestChallenge(publicKey);    // Get challenge
await oxy.verifyChallenge(pubKey, challenge, sig, ts); // Verify + create session

// Cross-domain auth (web)
await oxy.signInWithFedCM();              // FedCM browser-native
await oxy.signInWithPopup();              // Popup to auth.oxy.so
oxy.signInWithRedirect();                 // Redirect to auth.oxy.so

// Session management
await oxy.getTokenBySession(sessionId);   // Get/refresh token
await oxy.getUserBySession(sessionId);    // Get user from session
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

### AuthManager

```typescript
import { AuthManager, createAuthManager } from '@oxyhq/core';

const authManager = createAuthManager(oxyServices, {
  autoRefresh: true,       // Auto-refresh tokens (default: true)
  refreshBuffer: 300000,   // Refresh 5 min before expiry (default)
});

// Listen for auth state changes
const unsubscribe = authManager.onAuthStateChange((user) => {
  console.log('Auth changed:', user);
});

// Session management
await authManager.initialize();           // Restore session from storage
await authManager.handleAuthSuccess(session, 'fedcm');
await authManager.refreshToken();         // Manual refresh
await authManager.signOut();              // Clear all auth data
authManager.getCurrentUser();             // Get current user
authManager.isAuthenticated();            // Check auth state
authManager.destroy();                    // Cleanup timers/listeners
```

### REST Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/auth/signup` | POST | No | Register with email/password |
| `/api/auth/login` | POST | No | Login with email/password |
| `/api/auth/challenge` | POST | No | Request auth challenge |
| `/api/auth/verify` | POST | No | Verify signed challenge |
| `/api/auth/register` | POST | No | Register with public key |
| `/api/auth/validate` | GET | No | Check if auth is valid |
| `/api/session/token/:sessionId` | GET | No | Get/refresh access token |
| `/api/session/user/:sessionId` | GET | No | Get user by session |
| `/api/session/validate/:sessionId` | GET | No | Validate session |
| `/api/session/sessions/:sessionId` | GET | No | List all user sessions |
| `/api/session/logout/:sessionId` | POST | No | Logout session |
| `/api/session/logout-all/:sessionId` | POST | No | Logout all sessions |

---

## Troubleshooting

### Token refresh fails

The client refreshes tokens via `GET /api/session/token/:sessionId`. If this fails:
- Session may have expired (7-day lifetime)
- Session may have been revoked (logged out from another device)
- Network connectivity issues (client retries 3 times with exponential backoff)

### `oxy.auth()` returns 401

- Check that the token is being sent in the `Authorization: Bearer <token>` header
- Check that the session hasn't been revoked server-side
- The middleware validates sessions against the API, not just JWT decode

### Socket connection fails with "Authentication error"

- Ensure token is passed in `socket.handshake.auth.token`
- Token must be a valid, non-expired JWT
- Session must still be active on the server

### FedCM not working

- Requires HTTPS
- Only supported in Chrome 108+, Edge 108+
- The app falls back to popup automatically when FedCM is unavailable
- Check that auth.oxy.so is serving the FedCM well-known and config files

### Cross-domain SSO not working

- FedCM handles cross-domain SSO automatically (oxy.so, mention.earth, alia.onl, etc.)
- No third-party cookies required
- Silent sign-in runs automatically on `WebOxyProvider` mount
