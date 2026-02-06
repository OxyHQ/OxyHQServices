# OxyHQ Services

Monorepo for the Oxy platform — authentication, user management, real-time features, and client SDKs.

## Quick Links

| Page | Description |
|------|-------------|
| [[Architecture]] | Monorepo structure, packages, dependency graph |
| [[Infrastructure]] | DigitalOcean resources, VPC, databases, firewalls |
| [[Deployment]] | Docker, CI/CD, environment variables |
| [[Authentication]] | JWT flow, session validation, CSRF protection |
| [[Service Tokens]] | Internal service-to-service auth (OAuth2 Client Credentials) |
| [[Redis & Valkey]] | Rate limiting, Socket.IO adapter, caching strategy |

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `packages/core/` | `@oxyhq/core` | Platform-agnostic foundation (zero React/RN deps) |
| `packages/auth-sdk/` | `@oxyhq/auth` | Web auth SDK (React hooks, zero RN/Expo) |
| `packages/services/` | `@oxyhq/services` | Expo/React Native SDK (UI, screens, native features) |
| `packages/api/` | `@oxyhq/api` | Express.js backend API |
| `packages/auth/` | — | Next.js auth app (FedCM Identity Provider) |
| `packages/accounts/` | — | Expo accounts app |
| `packages/inbox/` | — | Inbox app |
| `packages/console/` | — | Admin console |
| `packages/test-app-expo/` | — | Expo test/playground app |
| `packages/test-app-vite/` | — | Vite test app (web-only) |

## Build Commands

```bash
npm run build -w @oxyhq/core     # Build core
npm run build -w @oxyhq/auth     # Build auth SDK
npm run build -w @oxyhq/services # Build services SDK
npm run build:all                # Build all (order: core -> auth -> services -> rest)
npm run test                     # Run all workspace tests
npm install                      # Install all workspace deps
```

Build order matters: `core` -> `auth` -> `services` -> everything else.

## Live URLs

| Service | URL | Hosted On |
|---------|-----|-----------|
| API | `https://api.oxy.so` | Droplet (Docker + Caddy) |
| Auth | `https://auth.oxy.so` | App Platform (oxy-api app) |
| Accounts | `https://accounts.oxy.so` | App Platform (oxy-api app) |
| Inbox | `https://inbox.oxy.so` | App Platform (oxy-api app) |
| Mention | `https://mention.earth` | App Platform |
| Homiio | `https://homiio.com` | App Platform |
| Alia | `https://alia.onl` | App Platform |
