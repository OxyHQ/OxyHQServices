# OxyServices Architecture

This document explains the modular architecture of `@oxyhq/services` and how to use it across different platforms.

## Overview

OxyServices is designed with a layered architecture that separates concerns:

```
┌─────────────────────────────────────────────────────────────────┐
│                    @oxyhq/services (Main)                       │
│         Full package with everything (Expo/RN + Web)            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   /native   │  │    /web     │  │   /crypto   │             │
│  │  Expo/RN    │  │  Pure React │  │  Identity   │             │
│  │  Components │  │  No RN deps │  │  Management │             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
│         │                │                │                     │
│         └────────────────┼────────────────┘                     │
│                          │                                      │
│                  ┌───────┴───────┐                              │
│                  │    /core      │                              │
│                  │  API Client   │                              │
│                  │  FedCM Auth   │                              │
│                  │  No UI deps   │                              │
│                  └───────┬───────┘                              │
│                          │                                      │
│                  ┌───────┴───────┐                              │
│                  │   /shared     │                              │
│                  │  Utilities    │                              │
│                  │  No deps      │                              │
│                  └───────────────┘                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Entry Points

| Entry Point | Use Case | Dependencies | Size |
|------------|----------|--------------|------|
| `@oxyhq/services` | Expo apps (native + web) | Full (RN, Expo) | Large |
| `@oxyhq/services/web` | Pure React apps (Vite, Next.js, CRA) | React only | Small |
| `@oxyhq/services/core` | Node.js / Backend | None | Minimal |
| `@oxyhq/services/shared` | Utilities anywhere | None | Tiny |
| `@oxyhq/services/crypto` | Identity management | Node crypto | Small |

## Module Descriptions

### `/shared` - Platform-Agnostic Utilities

Zero dependencies. Works everywhere.

```typescript
import {
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
} from '@oxyhq/services/shared';
```

### `/core` - API Client & Authentication

No UI dependencies. Works in Node.js and browsers.

```typescript
import {
  OxyServices,
  oxyClient,
  CrossDomainAuth,
  createCrossDomainAuth,
} from '@oxyhq/services/core';

// Create client
const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

// Use cross-domain auth (FedCM, popup, redirect)
const auth = createCrossDomainAuth(oxy);
const session = await auth.signIn(); // Auto-selects best method
```

### `/web` - Pure React Web Apps

For Next.js, Vite, Create React App, and other pure web frameworks.
No React Native dependencies = smaller bundles, no bundler config needed.

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

### `/crypto` - Identity Management

Cryptographic identity for local-first authentication.

```typescript
import {
  KeyManager,
  SignatureService,
  RecoveryPhraseService,
} from '@oxyhq/services/crypto';

// Generate new identity
const keyManager = new KeyManager();
const keyPair = await keyManager.generateKeyPair();
const recoveryPhrase = RecoveryPhraseService.generate();

// Sign messages
const signature = await SignatureService.sign(message, privateKey);
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

## Choosing the Right Entry Point

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
    │@oxyhq/      │    │@oxyhq/      │    │@oxyhq/      │
    │services     │    │services/web │    │services/core│
    └─────────────┘    └─────────────┘    └─────────────┘
```

## Migration Guide

### From Old Structure

```typescript
// OLD (might import RN deps in web)
import { normalizeTheme, darkenColor } from '@oxyhq/services';

// NEW (guaranteed no RN deps)
import { normalizeTheme, darkenColor } from '@oxyhq/services/shared';
```

### For Web-Only Apps

```typescript
// OLD (pulls in RN deps, needs bundler config)
import { WebOxyProvider } from '@oxyhq/services';

// NEW (no RN deps, no config needed)
import { WebOxyProvider, useAuth } from '@oxyhq/services/web';
```

## Best Practices

1. **Use the most specific entry point** - Don't import from main if you only need `/shared`
2. **Web apps should use `/web`** - Smaller bundles, no bundler configuration
3. **Backend should use `/core`** - No UI dependencies, works in Node.js
4. **Check FedCM support** - Use `isFedCMSupported()` to show appropriate UI
5. **Handle auth errors** - FedCM can fail, always have fallback to popup/redirect
