# OxyHQ Services

Monorepo for the Oxy platform — authentication, user management, real-time features, and client SDKs.

## Quick Links

| Page | Description |
|------|-------------|
| [[Architecture]] | Monorepo structure, packages, dependency graph |
| [[Infrastructure]] | AWS resources (ECS, ALB, ECR, ElastiCache, MongoDB on EC2) |
| [[Deployment]] | GitHub OIDC, ECS Fargate, env vars, Cloudflare Pages |
| [[Authentication]] | JWT flow, session validation, CSRF protection |
| [[Service Tokens]] | Internal service-to-service auth (OAuth2 Client Credentials) |
| [[Redis & Valkey]] | ElastiCache Valkey: rate limiting, Socket.IO adapter, caching strategy |

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| `packages/core/` | `@oxyhq/core` | Platform-agnostic foundation (zero React/RN deps) |
| `packages/auth-sdk/` | `@oxyhq/auth` | Web auth SDK (React hooks, zero RN/Expo) |
| `packages/services/` | `@oxyhq/services` | Expo/React Native SDK (UI, screens, native features) |
| `packages/api/` | `@oxyhq/api` | Express.js backend API |
| `packages/auth/` | — | Vite auth app (FedCM Identity Provider) |
| `packages/accounts/` | — | Expo accounts app |
| `packages/inbox/` | — | Inbox app |
| `packages/console/` | — | Admin console |
| `packages/test-app-expo/` | — | Expo test/playground app |
| `packages/test-app-vite/` | — | Vite test app (web-only) |

## Build commands

```bash
bun run core:build       # Build @oxyhq/core
bun run auth:build       # Build @oxyhq/auth (auth-sdk + auth IdP)
bun run services:build   # Build @oxyhq/services
bun run build:all        # Build all (order: core -> auth -> services -> rest)
bun run test             # Run all workspace tests
bun install              # Install all workspace deps
```

Build order matters: `core` -> `auth` -> `services` -> everything else.

## Live URLs

| Service | URL | Hosted on |
|---------|-----|-----------|
| API | `https://api.oxy.so` | AWS ECS Fargate (eu-west-1) |
| Auth (FedCM IdP) | `https://auth.oxy.so` | Cloudflare Pages (`_worker.js`) |
| Accounts | `https://accounts.oxy.so` | Cloudflare Pages |
| Inbox | `https://inbox.oxy.so` | Cloudflare Pages |
| Console | `https://console.oxy.so` | Cloudflare Pages |
| Mention API | `https://api.mention.earth` | AWS ECS Fargate (eu-west-1) |
| Homiio API | `https://api.homiio.com` | AWS ECS Fargate (eu-west-1) |
| Alia API | `https://api.alia.onl` | AWS ECS Fargate (eu-west-1) |
| Syra API | `https://api.syra.oxy.so` | AWS ECS Fargate (eu-west-1) |
| Allo API | `https://api.allo.oxy.so` | AWS ECS Fargate (eu-west-1) |
