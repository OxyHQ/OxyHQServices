# @oxyhq/sdk

Monorepo for the OxyHQ SDK. Provides modular packages for building web, mobile, and server applications on the Oxy platform.

## Packages

### Libraries

| Package | Path | Description |
|---------|------|-------------|
| `@oxyhq/contracts` | `packages/contracts/` | Contract-first API schemas (Zod). Zero React/RN/Expo — server and clients import from it directly. |
| `@oxyhq/protocol` | `packages/protocol/` | Oxy Protocol — signed-record envelope, canonical JSON, signature/verification, platform crypto. |
| `@oxyhq/core` | `packages/core/` | Platform-agnostic foundation. API client, session engine (`SessionClient`), crypto, and types. Works in Node.js, browsers, and React Native. |
| `@oxyhq/services` | `packages/services/` | **The single UI SDK** for Expo, React Native, and web (React Native Web). `OxyProvider`, auth UI (`OxyAccountDialog`, `OxySignInButton`, `OxyConsentScreen`), screens, hooks. |
| `@oxyhq/api` | `packages/api/` | Express.js backend API server. |
| `@oxyhq/node` | `packages/node/` | Self-hostable personal data node that stores a user's own signed records. |
| `@oxyhq/expo-splash` | `packages/expo-splash/` | Shared native-splash toolkit for Oxy Expo apps. |

There is no separate web-only auth SDK: web apps use `@oxyhq/services` via React Native Web, so every platform shares one provider and one auth UI.

### Applications

| App | Path | Description |
|-----|------|-------------|
| accounts | `packages/accounts/` | **Accounts by Oxy** — keyless management-only Expo app (sessions, privacy, settings). The sole owner of account management. Identity creation lives in Commons. |
| commons | `packages/commons/` | **Commons by Oxy** — native-only Expo app that owns self-sovereign identity creation, signed records, domain verification, and "Sign in with Oxy" cross-device QR/deep-link handoff. |
| auth | `packages/auth/` | `auth.oxy.so` — the OAuth authorize/consent IdP for third-party apps. Mounts `@oxyhq/services` components (Vite + React Native Web). Not a relying party. |
| inbox | `packages/inbox/` | Inbox app (`inbox.oxy.so`). |
| console | `packages/console/` | Developer console (`console.oxy.so`) — Application registry, credentials, usage. |
| test-app-expo | `packages/test-app-expo/` | Expo test playground. |

## Architecture

Each platform has a clear import path. Packages do not re-export from one another.

| Platform | Imports |
|----------|---------|
| Expo / React Native / Web | `@oxyhq/services` for the provider and UI, `@oxyhq/core` for types and services |
| Node.js / backends | `@oxyhq/core` for the API client, `@oxyhq/core/server` for Express auth middleware, `@oxyhq/contracts` for schemas |

Sessions are **device-first**: the SDK's cold boot restores the session from the device session state on the server (see [docs/auth/device-session.md](./docs/auth/device-session.md)); interactive sign-in is an in-app dialog, never a redirect. Third-party apps integrate with standard OAuth 2.0 + PKCE via `auth.oxy.so` (see [docs/auth/integration-guide.md](./docs/auth/integration-guide.md)).

## Quick Start

### Prerequisites

- Node.js 18+
- Bun 1.3+

### Install and Build

```bash
bun install
bun run build:all
```

Build order (derived by turbo from the dependency graph): `contracts` -> `protocol` -> `core` -> `services` -> remaining packages.

### React (Expo, React Native, or Web via React Native Web)

```tsx
import { OxyProvider, useAuth } from "@oxyhq/services";
import type { User } from "@oxyhq/core";

function App() {
  return (
    <OxyProvider clientId={process.env.OXY_CLIENT_ID} baseURL="https://api.oxy.so">
      <MyComponent />
    </OxyProvider>
  );
}

function MyComponent() {
  const { user, signIn, signOut, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <button onClick={() => signIn()}>Sign In</button>;
  return <p>Welcome, {user?.username}</p>;
}
```

`signIn()` opens the in-app sign-in surface (`OxyAccountDialog`: Commons QR, or password under "Sign in without the app"). Cold boot is silent — the provider never redirects to a login page.

### Node.js

```ts
import { OxyServices, oxyClient } from "@oxyhq/core";

// Use the pre-configured singleton
const user = await oxyClient.getUserById("user-id");

// Or create a custom instance
const oxy = new OxyServices({ baseURL: "https://api.oxy.so" });
const profile = await oxy.getProfileByUsername("johndoe");
```

## Development

```bash
# Build all packages in order
bun run build:all

# Run the API server
bun run start

# Run dev mode across workspaces
bun run dev

# Run tests (turbo dispatches each package's own runner)
bun run test
```

## License

AGPL-3.0-only -- The Oxy Foundation, Inc. See the [LICENSE](LICENSE) file for details.
