# OxyServices Architecture

This document explains the modular architecture of the Oxy SDK and how to use it across different platforms.

## Overview

The Oxy SDK is designed with a layered architecture that separates concerns across dedicated packages:

```
┌─────────────────────────────────────────────────────────────────┐
│                    @oxyhq/services (Main)                       │
│         Full package with everything (Expo/RN)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐                               │
│  │   /native   │  │  @oxyhq/auth│                               │
│  │  Expo/RN    │  │  Pure React │                               │
│  │  Components │  │  No RN deps │                               │
│  └──────┬──────┘  └──────┬──────┘                               │
│         │                │                                      │
│         └────────────────┘                                      │
│                  │                                              │
│                  ▼                                              │
│          ┌───────────────┐                                      │
│          │  @oxyhq/core  │                                      │
│          │  API Client   │                                      │
│          │  FedCM Auth   │                                      │
│          │  Crypto/Utils │                                      │
│          │  No UI deps   │                                      │
│          └───────────────┘                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Packages

| Package | Use Case | Dependencies | Size |
|---------|----------|--------------|------|
| `@oxyhq/services` | Expo apps (native) | Full (RN, Expo) | Large |
| `@oxyhq/auth` | Pure React apps (Vite, Next.js, CRA) | React only | Small |
| `@oxyhq/core` | Node.js / Backend / Utilities / Crypto | None | Minimal |

## Package Descriptions

### `@oxyhq/core` - API Client, Authentication, Utilities & Crypto

No UI dependencies. Works in Node.js and browsers. Includes platform-agnostic utilities, cryptographic identity management, and the core API client.

```typescript
import {
  // API Client & Auth
  OxyServices,
  oxyClient,
  CrossDomainAuth,
  createCrossDomainAuth,

  // Color utilities
  darkenColor,
  lightenColor,
  isLightColor,
  getContrastTextColor,

  // Theme utilities
  normalizeTheme,
  normalizeColorScheme,
  getSystemColorScheme,

  // Error utilities
  getErrorStatus,
  getErrorMessage,
  isRetryableError,

  // Network utilities
  withRetry,
  delay,

  // Crypto / Identity
  KeyManager,
  SignatureService,
  RecoveryPhraseService,
} from '@oxyhq/core';

// Create client
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Use cross-domain auth (FedCM, popup, redirect)
const auth = createCrossDomainAuth(oxy);
const session = await auth.signIn(); // Auto-selects best method

// Generate new identity
const keyManager = new KeyManager();
const keyPair = await keyManager.generateKeyPair();
const recoveryPhrase = RecoveryPhraseService.generate();

// Sign messages
const signature = await SignatureService.sign(message, privateKey);
```

### `@oxyhq/auth` - Pure React Web Apps

For Next.js, Vite, Create React App, and other pure web frameworks.
No React Native dependencies = smaller bundles, no bundler config needed.

```tsx
import { WebOxyProvider, useAuth } from '@oxyhq/auth';

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

### Main Entry Point - Full Expo/RN

For Expo apps that need everything (native + web).

```tsx
import { OxyProvider, useOxy, OxySignInButton } from '@oxyhq/services';

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <YourApp />
    </OxyProvider>
  );
}
```

## Authentication Methods

OxyServices supports three authentication methods that work across all platforms:

### 1. FedCM (Federated Credential Management)

Browser-native authentication. Best UX - no popups or redirects.

```typescript
// Automatic (tries FedCM first, falls back to popup/redirect)
const session = await auth.signIn();

// Explicit FedCM
const session = await auth.signInWithFedCM();
```

**Supported Browsers:**
- Chrome 108+
- Safari 16.4+
- Edge 108+

### 2. Popup Authentication

OAuth2-style popup window.

```typescript
const session = await auth.signInWithPopup();
```

### 3. Redirect Authentication

Full page redirect to auth.oxy.so.

```typescript
auth.signInWithRedirect();

// On return, handle callback
const session = auth.handleRedirectCallback();
```

## Silent Sign-In (SSO)

Check for existing session without user interaction:

```typescript
// In useEffect or on app startup
const session = await auth.silentSignIn();
if (session) {
  // User is already signed in
}
```

## Choosing the Right Package

```
┌─────────────────────────────────────────────────────────────┐
│                    What are you building?                    │
└─────────────────────────────────────────────────────────────┘
                              │
           ┌──────────────────┼──────────────────┐
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │ Expo App    │    │ React Web   │    │ Node.js     │
    │ (iOS/And/Web)│    │ (Next/Vite) │    │ Backend     │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
           ▼                  ▼                  ▼
    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
    │@oxyhq/      │    │@oxyhq/auth  │    │@oxyhq/core  │
    │services     │    │             │    │             │
    └─────────────┘    └─────────────┘    └─────────────┘
```

## Migration Guide

### From Old Structure

```typescript
// OLD (might import RN deps in web)
import { normalizeTheme, darkenColor } from '@oxyhq/services';

// NEW (guaranteed no RN deps)
import { normalizeTheme, darkenColor } from '@oxyhq/core';
```

### For Web-Only Apps

```typescript
// OLD (pulls in RN deps, needs bundler config)
import { WebOxyProvider } from '@oxyhq/services';

// NEW (no RN deps, no config needed)
import { WebOxyProvider, useAuth } from '@oxyhq/auth';
```

## Best Practices

1. **Use the most specific package** - Don't import from `@oxyhq/services` if you only need `@oxyhq/core`
2. **Web apps should use `@oxyhq/auth`** - Smaller bundles, no bundler configuration
3. **Backend should use `@oxyhq/core`** - No UI dependencies, works in Node.js
4. **Check FedCM support** - Use `isFedCMSupported()` to show appropriate UI
5. **Handle auth errors** - FedCM can fail, always have fallback to popup/redirect
