# Oxy Architecture

Complete architecture documentation for the Oxy ecosystem: identity, authentication, and services.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [System Architecture](#system-architecture)
3. [Identity System](#identity-system)
4. [Authentication Methods](#authentication-methods)
5. [User Linking](#user-linking)
6. [API Reference](#api-reference)
7. [Database Schema](#database-schema)
8. [Security](#security)

---

## Core Concepts

### The Phone IS the Password

Oxy uses **device-based cryptographic identity** as the primary authentication method. Your mobile device securely stores your private key, making the device itself your password.

```
┌─────────────────────────────────────────────────────────────────┐
│                    IDENTITY vs AUTHENTICATION                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  IDENTITY (Private Key)          AUTHENTICATION (OxyServices)  │
│  ─────────────────────           ────────────────────────────  │
│  • Stored ONLY in               • Handles login flows          │
│    Oxy Accounts app             • Token management             │
│  • Never leaves device          • Session handling             │
│  • Device = Password            • Multiple auth methods        │
│  • BIP39 recovery phrase        • FedCM, popup, redirect       │
│                                 • Cross-domain SSO             │
│                                                                 │
│  [accounts app]  ────────────>  [@oxyhq/services]              │
│   (native only)                  (all platforms)               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Key Principles

1. **Self-Custody**: Private keys never leave the user's device
2. **Offline-First**: Identity works without internet
3. **Multi-Method Auth**: Same user can authenticate via identity, password, or social
4. **User Linking**: Different auth methods can be linked to same account
5. **Platform Agnostic**: Auth works on native, web, and backend

---

## System Architecture

### Package Structure

```
OxyHQServices/
├── packages/
│   ├── accounts/          # Native-only identity wallet app
│   │   └── (private keys, recovery, QR transfer)
│   │
│   ├── services/          # @oxyhq/services - Auth & API client
│   │   ├── /core          # API client, FedCM, SSO (no UI)
│   │   ├── /web           # React web provider (no RN deps)
│   │   ├── /native        # Expo/RN provider & components
│   │   ├── /crypto        # Signing utilities (NOT key storage)
│   │   └── /shared        # Platform-agnostic utilities
│   │
│   ├── api/               # Backend API server
│   │   └── (users, sessions, auth, FedCM IdP)
│   │
│   └── auth/              # auth.oxy.so web app
│       └── (login portal for popup/redirect flows)
```

### Layer Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER APPLICATIONS                        │
│   Third-party apps, Oxy apps (Posts, Messenger, etc.)           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────┐              ┌─────────────────┐         │
│   │  Oxy Accounts   │              │  @oxyhq/services │         │
│   │  (Native App)   │              │  (npm package)   │         │
│   │                 │              │                  │         │
│   │  • KeyManager   │   signs →    │  • OxyServices   │         │
│   │  • Recovery     │   challenges │  • AuthManager   │         │
│   │  • QR Transfer  │              │  • Hooks/UI      │         │
│   └────────┬────────┘              └────────┬─────────┘         │
│            │                                │                    │
│            │  Public Key                    │  API Calls         │
│            │  + Signature                   │  + Tokens          │
│            ▼                                ▼                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                      api.oxy.so                          │   │
│   │                                                          │   │
│   │  • Challenge-Response Auth    • Password Auth            │   │
│   │  • Session Management         • Social Auth (OAuth)      │   │
│   │  • FedCM Identity Provider    • User Linking             │   │
│   └──────────────────────────┬───────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                       MongoDB                            │   │
│   │                                                          │   │
│   │  Users: { publicKey?, email?, username?, password?,      │   │
│   │          linkedAccounts?, authMethods[] }                │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Identity System

> **IMPORTANT**: Identity (private key storage) exists ONLY in the Oxy Accounts app.
> `@oxyhq/services` handles authentication but NOT identity storage.

### Where Identity Lives

| Component | Identity Storage | Signing | Verification |
|-----------|-----------------|---------|--------------|
| accounts app | ✅ KeyManager (expo-secure-store) | ✅ Yes | ✅ Yes |
| @oxyhq/services | ❌ None | ❌ No | ✅ Yes (SignatureService.verify) |
| api.oxy.so | ❌ None | ❌ No | ✅ Yes (server-side) |

### Cryptographic Primitives

- **Algorithm**: ECDSA secp256k1 (same as Bitcoin/Ethereum)
- **Private Key**: 256-bit (32 bytes), stored in device secure storage
- **Public Key**: Compressed format (33 bytes hex), serves as user identifier
- **Recovery**: BIP39 mnemonic (12 or 24 words)

### Identity Lifecycle

```
1. CREATE IDENTITY (in Oxy Accounts app)
   ┌──────────────────────────────────────────────────────────────┐
   │  1. Generate ECDSA keypair locally (works offline)           │
   │  2. Store private key in expo-secure-store                   │
   │  3. Generate BIP39 recovery phrase                           │
   │  4. User saves recovery phrase (IMPORTANT!)                  │
   │  5. When online: Register publicKey with api.oxy.so          │
   └──────────────────────────────────────────────────────────────┘

2. AUTHENTICATE (sign in to any app)
   ┌──────────────────────────────────────────────────────────────┐
   │  1. App requests challenge from api.oxy.so                   │
   │  2. Oxy Accounts app signs challenge with private key        │
   │  3. Server verifies signature matches registered publicKey   │
   │  4. Server creates session, returns JWT tokens               │
   └──────────────────────────────────────────────────────────────┘

3. TRANSFER TO NEW DEVICE (via QR code)
   ┌──────────────────────────────────────────────────────────────┐
   │  1. Old device: Shows QR with encrypted recovery phrase      │
   │  2. New device: Scans QR, decrypts recovery phrase           │
   │  3. New device: Restores keypair from recovery phrase        │
   │  4. New device: Can now sign as the same identity            │
   └──────────────────────────────────────────────────────────────┘
```

### Using the Crypto Module

The `/crypto` module is for **signature verification** and **utilities**, NOT key storage:

```typescript
// In Oxy Accounts app (has full KeyManager)
import { KeyManager, SignatureService, RecoveryPhraseService } from '@oxyhq/services/crypto';

// Generate identity (only in accounts app)
const publicKey = await KeyManager.createIdentity();
const { phrase, words } = await RecoveryPhraseService.generateIdentityWithRecovery();

// Sign challenges (only in accounts app)
const signature = await SignatureService.sign(challenge);

// ─────────────────────────────────────────────────────────────

// In other apps (verification only)
import { SignatureService } from '@oxyhq/services/crypto';

// Verify signatures (works anywhere)
const isValid = await SignatureService.verify(message, signature, publicKey);
```

---

## Authentication Methods

Oxy supports multiple authentication methods that ALL map to the same user account:

### 1. Identity (Passwordless)

Primary method using cryptographic keypair. The phone IS the password.

```typescript
// From third-party app - show Sign In with Oxy button
import { OxySignInButton } from '@oxyhq/services';

function LoginScreen() {
  return <OxySignInButton variant="contained" text="Sign in with Oxy" />;
}

// This opens Oxy Accounts app via deep link or shows QR code
// User authorizes in accounts app → session created
```

**Flow**:
1. App creates auth session → gets sessionToken + QR code
2. User scans QR or opens Oxy Accounts app via deep link
3. Oxy Accounts app signs authorization with private key
4. Server verifies, links session to user
5. Original app receives session via polling

### 2. Password (Traditional)

For web users who prefer traditional login:

```typescript
// Web login form
const session = await oxyServices.signIn({
  email: 'user@example.com',
  password: 'secret123',
});
```

**Requirements**:
- User must have set email + password on their account
- Can be added to existing identity account via account linking

### 3. FedCM (Browser-Native SSO)

Modern browser-native authentication (Chrome 108+, Safari 16.4+):

```typescript
import { useAuth } from '@oxyhq/services/web';

function LoginButton() {
  const { signIn, isFedCMSupported } = useAuth();

  return (
    <button onClick={signIn}>
      {isFedCMSupported() ? 'Sign in with Oxy' : 'Sign in'}
    </button>
  );
}
```

**Flow**:
1. Browser shows native account picker (like Google sign-in)
2. No popup or redirect needed
3. Seamless UX with existing Oxy session

### 4. Popup / Redirect (OAuth-style)

Fallback for browsers without FedCM:

```typescript
// Popup (opens auth.oxy.so in popup window)
const session = await crossDomainAuth.signInWithPopup();

// Redirect (full page redirect to auth.oxy.so)
crossDomainAuth.signInWithRedirect();
// On return:
const session = crossDomainAuth.handleRedirectCallback();
```

### Auth Method Priority

When calling `signIn()`, OxyServices automatically selects the best method:

```
1. FedCM (if browser supports)
   ↓ fallback
2. Popup (default for web)
   ↓ fallback
3. Redirect (if popup blocked)
```

---

## User Linking

Users can have **multiple auth methods** linked to the **same account**.

### Use Cases

1. **Started with password, want identity**: Link publicKey to existing account
2. **Started with identity, want password**: Add email/password to identity account
3. **Social login**: Link Google/Apple/etc. to existing account
4. **Multiple devices**: Same identity on multiple devices (via recovery phrase)

### Linking API

```typescript
// Link identity to existing password account
POST /api/auth/link
Headers: { Authorization: "Bearer <jwt>" }  // Must be logged in
Body: {
  type: "identity",
  publicKey: "04abc...",
  signature: "...",  // Proof of key ownership
  timestamp: 123456789
}

// Link password to existing identity account
POST /api/auth/link
Headers: { Authorization: "Bearer <jwt>" }
Body: {
  type: "password",
  email: "user@example.com",
  password: "newpassword123"
}

// Get linked auth methods
GET /api/auth/methods
Headers: { Authorization: "Bearer <jwt>" }
Response: {
  methods: [
    { type: "identity", publicKey: "04abc...", linkedAt: "2024-01-15T..." },
    { type: "password", email: "user@example.com", linkedAt: "2024-01-20T..." }
  ]
}

// Unlink auth method (must keep at least one)
DELETE /api/auth/link/:type
Headers: { Authorization: "Bearer <jwt>" }
```

### Database Schema for Linking

```javascript
// User document
{
  _id: ObjectId,

  // Primary identifiers (all optional, sparse unique indexes)
  publicKey: "04abc...",     // ECDSA secp256k1 public key
  email: "user@example.com",
  username: "johndoe",

  // Auth credentials
  password: "hashed...",     // bcrypt hash (select: false)

  // Auth methods tracking
  authMethods: [
    { type: "identity", linkedAt: Date, primaryPublicKey: "04abc..." },
    { type: "password", linkedAt: Date, email: "user@example.com" },
    { type: "google", linkedAt: Date, googleId: "123..." },
  ],

  // Profile data...
}
```

### Linking Rules

1. **At least one method required**: Cannot unlink last auth method
2. **Identity is transferable**: Recovery phrase works on any device
3. **Email verification**: Required before linking password
4. **Signature required**: Linking identity requires signed proof

---

## API Reference

### Authentication Endpoints

```
POST /api/auth/register           # Register with publicKey (identity)
POST /api/auth/signup             # Register with email/password
POST /api/auth/login              # Login with email/password
POST /api/auth/challenge          # Get challenge for identity auth
POST /api/auth/verify             # Verify signed challenge

GET  /api/auth/validate           # Validate current token
GET  /api/auth/check-username/:u  # Check username availability
GET  /api/auth/check-email/:e     # Check email availability
GET  /api/auth/check-publickey/:p # Check publicKey registration
```

### Session Endpoints

```
POST /api/session/register        # Create session (identity)
POST /api/session/login           # Create session (password)
GET  /api/session/user/:id        # Get user by session
GET  /api/session/validate/:id    # Validate session
POST /api/session/logout/:id      # Logout specific session
POST /api/session/logout-all/:id  # Logout all sessions
```

### Cross-App Auth (QR Flow)

```
POST /api/auth/session/create           # Create auth session (for QR)
GET  /api/auth/session/status/:token    # Poll session status
POST /api/auth/session/authorize/:token # Authorize from accounts app
POST /api/auth/session/cancel/:token    # Cancel auth session
```

### FedCM Endpoints

```
GET  /.well-known/web-identity          # FedCM config discovery
GET  /fedcm/config.json                 # FedCM IdP configuration
GET  /fedcm/accounts                    # User's accounts for FedCM
GET  /fedcm/client_metadata             # RP metadata
POST /fedcm/token                       # Exchange for ID token
POST /fedcm/disconnect                  # Revoke FedCM credential
POST /api/fedcm/exchange                # Exchange ID token for session
```

### User Linking Endpoints

```
POST   /api/auth/link                   # Link new auth method
GET    /api/auth/methods                # Get linked auth methods
DELETE /api/auth/link/:type             # Unlink auth method
```

---

## Database Schema

### User Collection

```javascript
{
  // Identity
  _id: ObjectId,
  publicKey: String,           // sparse unique index
  username: String,            // sparse unique index
  email: String,               // sparse unique index

  // Auth
  password: String,            // bcrypt hash, select: false
  refreshToken: String,        // select: false
  twoFactorAuth: {
    enabled: Boolean,
    secret: String,            // TOTP secret, select: false
    backupCodes: [String],     // select: false
    verifiedAt: Date
  },

  // Auth methods tracking
  authMethods: [{
    type: String,              // 'identity' | 'password' | 'google' | etc.
    linkedAt: Date,
    metadata: Mixed            // type-specific data
  }],

  // Profile
  name: { first: String, last: String },
  bio: String,
  avatar: String,              // file ID
  verified: Boolean,
  language: String,

  // Social
  following: [ObjectId],
  followers: [ObjectId],
  _count: { followers: Number, following: Number },

  // Privacy
  privacySettings: { ... },

  // Timestamps
  createdAt: Date,
  updatedAt: Date
}
```

### Session Collection

```javascript
{
  _id: ObjectId,
  userId: ObjectId,            // ref: User
  deviceId: String,
  deviceName: String,
  deviceFingerprint: String,
  platform: String,            // 'ios' | 'android' | 'web'
  ip: String,
  userAgent: String,
  expiresAt: Date,
  lastActiveAt: Date,
  createdAt: Date
}
```

### AuthSession Collection (for QR flow)

```javascript
{
  _id: ObjectId,
  sessionToken: String,        // unique, short-lived
  status: String,              // 'pending' | 'authorized' | 'expired' | 'cancelled'
  appId: String,
  userId: ObjectId,            // set when authorized
  authorizedSessionId: ObjectId,
  deviceName: String,
  deviceFingerprint: String,
  expiresAt: Date,
  createdAt: Date
}
```

---

## Security

### Private Key Security

- **Never transmitted**: Private keys never leave the device
- **Secure storage**: expo-secure-store (iOS Keychain, Android Keystore)
- **No server storage**: Server only stores public keys

### Challenge-Response

- **Time-limited**: Challenges expire in 5 minutes
- **Single-use**: Challenges marked used after verification
- **Replay protection**: Timestamp included in signed message

### Token Security

- **JWT tokens**: Short-lived access tokens (15 min)
- **Refresh tokens**: Long-lived, stored securely, rotated on use
- **Session binding**: Tokens bound to device fingerprint

### Best Practices

1. **Recovery phrase**: Users MUST save their recovery phrase
2. **2FA**: Encourage enabling TOTP 2FA for password accounts
3. **Session management**: Review active sessions regularly
4. **Device trust**: Mark trusted devices, alert on new devices

---

## Quick Start

### For Expo/React Native Apps

```tsx
import { OxyProvider, useAuth } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}

function LoginScreen() {
  const { signIn, user, isAuthenticated } = useAuth();

  if (isAuthenticated) {
    return <Text>Welcome, {user.displayName}</Text>;
  }

  return <Button onPress={signIn} title="Sign In" />;
}
```

### For Web Apps (React, Next.js, Vite)

```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/services/web';

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </WebOxyProvider>
  );
}

function LoginButton() {
  const { signIn, isFedCMSupported, isLoading } = useAuth();

  return (
    <button onClick={signIn} disabled={isLoading}>
      {isFedCMSupported() ? 'Sign in with Oxy' : 'Sign in'}
    </button>
  );
}
```

### For Node.js/Backend

```typescript
import { OxyServices } from '@oxyhq/services/core';
import { SignatureService } from '@oxyhq/services/crypto';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Verify user signature on backend
function verifyRequest(publicKey: string, data: any, signature: string, timestamp: number) {
  const age = Date.now() - timestamp;
  if (age > 5 * 60 * 1000) throw new Error('Request expired');

  const isValid = SignatureService.verifyRequestSignature(publicKey, data, signature, timestamp);
  if (!isValid) throw new Error('Invalid signature');

  return true;
}
```

---

## Migration

### From Password-Only to Identity

```typescript
// 1. User is logged in with password
// 2. Open Oxy Accounts app, create identity
// 3. In your app, link identity:

const linkResponse = await fetch('/api/auth/link', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'identity',
    publicKey: await KeyManager.getPublicKey(),
    signature: await SignatureService.createLinkSignature(),
    timestamp: Date.now(),
  }),
});

// Now user can sign in with either method
```

### From Identity-Only to Password

```typescript
// 1. User is logged in with identity
// 2. Add email and password:

const linkResponse = await fetch('/api/auth/link', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    type: 'password',
    email: 'user@example.com',
    password: 'newpassword123',
  }),
});

// Now user can sign in with either method
```

---

## Related Documentation

- [Cross-Domain Auth](./CROSS_DOMAIN_AUTH.md) - FedCM, popup, redirect flows
- [Public Key Authentication](../packages/services/docs/PUBLIC_KEY_AUTHENTICATION.md) - Detailed crypto docs
- [Services Package](../packages/services/README.md) - Full package documentation
- [API Package](../packages/api/README.md) - Backend API documentation
