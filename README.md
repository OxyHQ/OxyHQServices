# Oxy

The platform every Oxy app stands on: identity, the signed-record protocol, the API, the SDK, and the first-party apps that own account and identity management.

This is not an SDK repository with some extras attached. The SDK is one of the pieces. So is the backend that runs `api.oxy.so`, the identity vault people install on their phones, and the OAuth provider third parties integrate against.

## What's in here

### The substrate

| Package | Path | What it is |
|---|---|---|
| `@oxyhq/protocol` | `packages/protocol/` | Signed-record envelope, canonical JSON, signing and verification, platform crypto |
| `@oxyhq/contracts` | `packages/contracts/` | Contract-first API schemas (Zod). Zero React/RN/Expo, so server and clients import the same source of truth |
| `@oxyhq/federation` | `packages/federation/` | App-agnostic ActivityPub identity and follow layer |
| `@oxyhq/core` | `packages/core/` | Platform-agnostic foundation: API client, session engine, crypto, types. Runs in Node, browsers and React Native |

### Server and SDK

| Package | Path | What it is |
|---|---|---|
| `@oxyhq/api` | `packages/api/` | The Express backend behind `api.oxy.so` |
| `@oxyhq/services` | `packages/services/` | **The single UI SDK** for Expo, React Native and web (via React Native Web): `OxyProvider`, auth UI, screens, hooks |
| `@oxyhq/node` | `packages/node/` | Self-hostable personal data node holding a user's own signed records |

There is no separate web-only auth SDK. Web apps use `@oxyhq/services` through React Native Web, so every platform shares one provider and one auth UI.

### Applications

| App | Path | What it is |
|---|---|---|
| commons | `packages/commons/` | **Commons by Oxy** — native-only identity vault. Owns identity creation, signed records, domain verification, and "Sign in with Oxy" approvals |
| accounts | `packages/accounts/` | **Accounts by Oxy** — keyless account management: sessions, privacy, settings. The sole owner of account management |
| auth | `packages/auth/` | `auth.oxy.so` — the OAuth authorize/consent provider for third-party apps. Not a relying party |
| console | `packages/console/` | `console.oxy.so` — application registry, credentials, usage |
| inbox | `packages/inbox/` | `inbox.oxy.so` |

### Tooling

| Package | Path | What it is |
|---|---|---|
| `create-oxy-app` | `packages/create-oxy-app/` | `bun create oxy-app` — scaffolds a new Oxy app in the canonical monorepo shape |
| `@oxyhq/app-preset` | `packages/app-preset/` | The Oxy distro of Expo: shared config plugin, Metro/Babel/CSS/ESLint/tsconfig bases |
| `@oxyhq/expo-splash` | `packages/expo-splash/` | Shared native-splash toolkit |
| `@oxyhq/ship` | `packages/ship/` | `oxy-ship` — publishes Expo OTA updates to the Oxy Updates service |

## Architecture

Packages never re-export from one another. Each platform has one import path.

| Platform | Imports |
|---|---|
| Expo, React Native, web | `@oxyhq/services` for the provider and UI, `@oxyhq/core` for types and services |
| Node backends | `@oxyhq/core` for the API client, `@oxyhq/core/server` for Express auth middleware, `@oxyhq/contracts` for schemas |

Sessions are device-first and cookie-free. A device holds a `{deviceId, deviceSecret}` pair per origin and mints short-lived access tokens by presenting it; the server stores only a hash of the secret. Cold boot restores the session without ever redirecting to a login page.

## Quick start

Requires Node 18+ and Bun 1.3+.

```bash
bun install
bun run build:all
```

Build order comes from the dependency graph: `contracts` → `protocol` → `core` → `services` → everything else.

### React (Expo, React Native, or web)

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

`signIn()` opens the in-app sign-in dialog: the accounts already on this device, plus one "Continue with Oxy" action. Oxy picks how the request reaches the identity — opening Commons, pushing to it, or showing a QR — instead of asking the person to choose a transport.

### Node

```ts
import { OxyServices, oxyClient } from "@oxyhq/core";

// Pre-configured singleton
const user = await oxyClient.getUserById("user-id");

// Or your own instance
const oxy = new OxyServices({ baseURL: "https://api.oxy.so" });
const profile = await oxy.getProfileByUsername("johndoe");
```

## Development

```bash
bun run build:all   # build every package in dependency order
bun run start       # run the API server
bun run dev         # dev mode across workspaces
bun run test        # tests (turbo dispatches each package's own runner)
```

## License

AGPL-3.0-only — The Oxy Foundation, Inc. See [LICENSE](LICENSE).
