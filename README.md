# @oxyhq/sdk

Monorepo for the OxyHQ SDK. Provides modular packages for building web, mobile, and server applications on the Oxy platform.

## Packages

### Libraries

| Package | Path | Description |
|---------|------|-------------|
| `@oxyhq/core` | `packages/core/` | Platform-agnostic foundation. API client, auth, crypto, and types. Works in Node.js, browsers, and React Native. |
| `@oxyhq/auth` | `packages/auth-sdk/` | Web auth SDK with React hooks and provider. Built for Next.js and Vite. No React Native or Expo dependencies. |
| `@oxyhq/services` | `packages/services/` | Expo and React Native SDK. UI components, screens, and native features. |
| `@oxyhq/api` | `packages/api/` | Express.js backend API server. |

### Applications

| App | Path | Description |
|-----|------|-------------|
| accounts | `packages/accounts/` | Expo accounts app. |
| auth | `packages/auth/` | Next.js auth app (standalone). |
| test-app | `packages/test-app/` | Expo test playground. |

## Architecture

Each platform has a clear import path. Packages do not re-export from one another.

| Platform | Imports |
|----------|---------|
| Next.js / Vite | `@oxyhq/core` for types and services, `@oxyhq/auth` for React hooks and provider |
| Expo / React Native | `@oxyhq/services` for UI components, `@oxyhq/core` for types and services |
| Node.js | `@oxyhq/core` for API client, auth, and types |

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install and Build

```bash
npm install
npm run build:all
```

Build order: `core` -> `auth` -> `services` -> remaining packages.

### Next.js / Vite

```tsx
import { WebOxyProvider, useAuth } from "@oxyhq/auth";
import type { User } from "@oxyhq/core";

function App() {
  return (
    <WebOxyProvider baseURL="https://api.oxy.so">
      <MyComponent />
    </WebOxyProvider>
  );
}

function MyComponent() {
  const { user, signIn, signOut, isAuthenticated } = useAuth();
  if (!isAuthenticated) return <button onClick={signIn}>Sign In</button>;
  return <p>Welcome, {user?.username}</p>;
}
```

### Expo / React Native

```tsx
import { OxyProvider, useAuth } from "@oxyhq/services";
import type { User } from "@oxyhq/core";

function App() {
  return (
    <OxyProvider baseURL="https://api.oxy.so">
      <MyComponent />
    </OxyProvider>
  );
}

function MyComponent() {
  const { user, signIn, signOut, isAuthenticated } = useAuth();
  // ...
}
```

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
npm run build:all

# Run the API server
npm start

# Run dev mode across workspaces
npm run dev

# Run tests
npm test
```

## License

MIT -- OxyHQ
