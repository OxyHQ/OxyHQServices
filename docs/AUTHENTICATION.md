# Authentication quickstart

Add Oxy sign-in to an app. One SDK owns all auth UI and session state: **`@oxyhq/services`** (`OxyProvider`) — the same package on Expo/React Native and on web via React Native Web. The previous web-only auth SDK package was removed from the monorepo.

Deeper references:

- [Third-party integration guide](./auth/integration-guide.md) — OAuth + PKCE end to end: Console registration, web SPA, confidential server, native custom scheme, grant revocation.
- [Device sessions](./auth/device-session.md) — `DeviceSession` server model, `/session/device/*` API, socket sync, multi-account.
- [Platform architecture](./architecture/oxy-auth-platform.md) — decisions and phase history.

## How sessions work today

- **Server authority:** the `DeviceSession` document (collection `devicesessions`) holds `deviceId`, `accounts[]` (`accountId`, `sessionId`, `authuser`, optional `operatedByUserId` for managed accounts), `activeAccountId`, and a `revision` counter. It is mutated only through `/session/device/{state,add,switch,signout}` and mirrored to every app on the same device through the Socket.IO room `device:<deviceId>` (`session_state` event; the payload never contains tokens). The client side is `SessionClient` in `@oxyhq/core` (`packages/core/src/session/`).
- **Transport (frozen):** a durable first-party `oxy_device` cookie (`Domain=.oxy.so`) plus a persisted rotating refresh-token family. Cross-subdomain web boots hand off through a single-use `#oxy_boot` URL fragment (`GET /auth/device/bootstrap` → `POST /auth/device/exchange`). This transport is intentionally frozen until the "workshop 2c" design session; a cookie-free `deviceSecret` mint is a **pending goal only**, not current behavior.
- **Cold boot never redirects.** `OxyProvider` restores the session silently when one exists. When none exists the app simply stays logged out until the user explicitly opens sign-in (`useAuth().signIn()` or `OxySignInButton`) — there is no automatic navigation to a login page.

## Install

```bash
bun add @oxyhq/services @oxyhq/core
```

Get a `clientId` (an `oxy_dk_…` credential public key) by registering an Application in [Oxy Console](https://console.oxy.so).

## Expo / React Native

Mount `OxyProvider` once at the root:

```tsx
// app/_layout.tsx (expo-router)
import { Stack } from 'expo-router';
import { OxyProvider } from '@oxyhq/services';

export default function RootLayout() {
  return (
    <OxyProvider
      baseURL="https://api.oxy.so"
      clientId={process.env.EXPO_PUBLIC_OXY_CLIENT_ID}
    >
      <Stack />
    </OxyProvider>
  );
}
```

`OxyProvider` brings its own React Query client (offline-persisted), Bloom dialog/toast outlets, and the `OxyAccountDialog` overlay — no extra providers required. Pass `requireAuth="soft"` or `requireAuth="hard"` (default `"off"`) to opt into the shared, readiness-safe auth gate instead of hand-rolling one.

## Web (Vite + React Native Web)

The same `OxyProvider` runs on web. Bundle the React Native graph with **rolldown-vite** + `vite-plugin-react-native-web` — the working reference is `packages/console` ([`packages/console/vite.config.ts`](../packages/console/vite.config.ts)):

```jsonc
// package.json — alias vite to rolldown-vite
"vite": "npm:rolldown-vite@^7.3.1",
"vite-plugin-react-native-web": "^3.1.2"
```

```ts
// vite.config.ts — see packages/console/vite.config.ts for the full pattern
// (native-only module shims, Flow stripping, RN platform extensions)
import { defineConfig } from 'vite';
import viteReact from '@vitejs/plugin-react';
import reactNativeWeb from 'vite-plugin-react-native-web';

export default defineConfig({
  plugins: [reactNativeWeb(), viteReact()],
});
```

```tsx
// src/main.tsx
import { OxyProvider } from '@oxyhq/services';

root.render(
  <OxyProvider baseURL="https://api.oxy.so" clientId={import.meta.env.VITE_OXY_CLIENT_ID}>
    <App />
  </OxyProvider>,
);
```

## Reading auth state — `useAuth` / `useOxy`

```tsx
import { Text } from 'react-native';
import { useAuth, OxySignInButton } from '@oxyhq/services';
import { getNormalizedUserHandle } from '@oxyhq/core';

function Header() {
  const { user, isAuthenticated, isAuthResolved, signOut } = useAuth();

  // Cold boot still resolving — `isAuthenticated: false` is not yet definitive.
  if (!isAuthResolved) return null;
  if (!isAuthenticated || !user) return <OxySignInButton />;

  return (
    <Text onPress={() => signOut()}>
      {user.name?.displayName ?? getNormalizedUserHandle(user)}
    </Text>
  );
}
```

| Field / action | Use |
|---|---|
| `isAuthResolved` | `false` until the first cold-boot restore concludes; defer auth-dependent fetches until `true` |
| `canUsePrivateApi` / `isPrivateApiPending` | gate private API calls on SDK readiness — never fire bearer requests before these settle |
| `signIn()` | opens the sign-in surface (`OxyAccountDialog`); it never navigates away — react to `isAuthenticated` |
| `signOut()` / `signOutAll()` | end the current session / all sessions |

`useOxy()` is the lower-level hook on the same context: `oxyServices`, `sessions`, `switchToAccount`, `openAccountDialog(view?)`, and friends.

## Sign-in UX (what users see)

The sign-in surface is `OxyAccountDialog`, built on Bloom `<Dialog placement={{ base: 'bottom', md: 'center' }}>` — it slides up from the bottom on phones and centers on larger screens, and doubles as the account switcher. Sign-in is **Commons-first**:

- **Web:** a QR code the user scans with the Oxy app on their phone. Approval is key-signed on the device; the session token never rides the QR.
- **Native:** the shared-keychain Commons identity signs in directly — no QR.
- **Password:** the secondary path, collapsed under "Sign in without the app" (inline 2FA supported).

The user-facing label is always **"Sign in with Oxy"** — never name the mechanism.

## `OxySignInButton`

The pre-styled button resolves your registered Application via `GET /auth/oauth/client/:clientId` and branches on its type:

| Application type | On press |
|---|---|
| `first_party` / `internal` / `system` / `isOfficial` | opens `OxyAccountDialog` in-app (Commons-first, as above) |
| `third_party` | standard OAuth 2.0 Authorization Code redirect to `auth.oxy.so`, with PKCE |

```tsx
// Official Oxy app — the dialog opens in-app
<OxySignInButton />

// Third-party RP — OAuth redirect; must exactly match a redirect URI registered in Console
<OxySignInButton oauthRedirectUri="https://merchant.example/oauth/callback" />
```

For third-party web, the SDK generates the CSRF `state` and PKCE pair with `generateOAuthState()` / `generatePkcePair()` and builds the redirect with `buildOAuthAuthorizeUrl()` (all exported from `@oxyhq/core`), persisting the handshake in `sessionStorage` across the redirect. Your callback validates `state` and exchanges the code:

```http
POST https://api.oxy.so/auth/oauth/token
Content-Type: application/json

{
  "code": "…",
  "clientId": "oxy_dk_…",
  "redirectUri": "https://merchant.example/oauth/callback",
  "codeVerifier": "…"
}
```

Native third-party RPs pass `onOAuthResult` to receive `{ redirectUrl, state, codeVerifier }` from the in-app auth session and finish the same exchange. Consent renders on `auth.oxy.so` via `OxyConsentScreen` (exported from `@oxyhq/services`), showing the Application's name, logo, scopes, and its `privacyPolicyUrl` / `termsUrl`. Full walkthrough: [integration guide](./auth/integration-guide.md).

## Backend — verifying requests

App backends verify Oxy bearer tokens with `@oxyhq/core/server`. Never hand-roll bearer parsing or auth middleware:

```ts
import express from 'express';
import { OxyServices } from '@oxyhq/core';
import { createOxyAuthMiddleware, getRequiredOxyUserId } from '@oxyhq/core/server';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });
const app = express();

app.use('/api', createOxyAuthMiddleware(oxy)); // 401s unauthenticated requests

app.get('/api/me', (req, res) => {
  res.json({ userId: getRequiredOxyUserId(req) });
});
```

Related: `createOptionalOxyAuth` (attach identity when present), `requireOxyAuth`, `createOxyCors`, `createOxyRateLimit`, `safeFetch`, `verifySecret` from the same subpath; Socket.IO auth via `io.use(oxy.authSocket())`.

On the client, calls from an official app to its own backend go through the SDK's linked client — no manual `Authorization` headers or interceptors:

```ts
const client = oxyServices.createLinkedClient({ baseURL: 'https://api.myapp.example' });
```

## The IdP is not an RP

`auth.oxy.so` is the OAuth authorize/consent surface for third-party apps. It mounts the same `OxyProvider` but with `coldBoot={false}` (no session-authority mode) and renders the services sign-in surface plus `OxyConsentScreen`. It does not manage accounts: **accounts.oxy.so** is the sole account-management owner, and the IdP permanently redirects its former `/settings/*` paths there.
