# OxyHQServices — Platform Documentation

Comprehensive developer documentation for the Oxy platform: the identity
provider, the SDK, the "Oxy ID" self-sovereign identity + civic layer, and the
decentralization (user data nodes) layer.

---

## What Oxy is, on one screen

OxyHQServices (`@oxyhq/sdk`) is the platform layer for the whole Oxy ecosystem. It
is four things in one Bun-workspaces monorepo:

1. **An API + a device-first session model.** `api.oxy.so` owns the durable
   `oxy_device` cookie and the rotating refresh-token family; every web/native
   app restores its session through the shared SDK's device-first cold boot
   with zero redirects for first-party apps. `auth.oxy.so` is a third-party
   OAuth authorize/consent IdP (for apps that don't embed the SDK) plus a
   device-account chooser feed.

2. **A client SDK.** `@oxyhq/core` (platform-agnostic client + `/server`
   middleware), `@oxyhq/auth` (web `WebOxyProvider`), `@oxyhq/services` (Expo/RN
   `OxyProvider`), and `@oxyhq/contracts` (Zod API contracts). Every Oxy app
   (Mention, Allo, Homiio, Syra, accounts, console, inbox) consumes these for
   auth, profiles, payments, and media — zero per-app SSO code.

3. **Oxy ID — self-sovereign identity.** Account-anchored `did:web` documents,
   cryptographically signed records on a per-user hash chain, verifiable
   credentials, proof-of-personhood, and signed data export. Surfaced through the
   native-only **Commons by Oxy** vault app.

4. **Decentralization — user data nodes.** A user can run their own
   `@oxyhq/node` server that *owns* their signed records; Oxy keeps a fast,
   always-available read copy and re-verifies everything it ingests. Reads never
   touch a node.

The unifying thesis: **ownership comes from cryptography, not from Oxy granting
it.** A record signed in Commons verifies identically on Oxy, on a personal node,
and in any third-party verifier — using the exact same `@oxyhq/core` code.

---

## Table of contents (this doc set)

| Doc | What it covers |
|---|---|
| [architecture/overview.md](architecture/overview.md) | Monorepo packages, dependency graph, build order, package boundaries, end-to-end request flow |
| [auth/README.md](auth/README.md) | Device-first session model, the `oxy_device` cookie, `runSessionColdBoot`, the in-app sign-in modal, OAuth consent/trust, service tokens, linked clients, `@oxyhq/core/server` middleware |
| [identity/README.md](identity/README.md) | `did:web` documents (custodial ↔ self-sovereign), signed records (envelope v2, hash chain, `verifyEnvelope`), signed export, domain verification, "Sign in with Oxy" |
| [reputation/README.md](reputation/README.md) | Oxy Trust ledger (tiers/influence), crypto-owned reputation, F2 real-life attestation + validator jury, F3 proof-of-personhood, F4 verifiable credentials |
| [nodes/README.md](nodes/README.md) | The data-node model, `@oxyhq/node` server, registration, Oxy→node export, node→Oxy ingest (verify/LWW/fork/counter-sign), managed vault |
| [CHANGELOG.md](CHANGELOG.md) | Chronological "what changed and why" for the whole F0→F5 + Oxy ID rename + Commons/Reputation UI initiative, with commit SHAs |

### Reading paths

- **New to the platform?** Start with [architecture/overview.md](architecture/overview.md),
  then [auth/README.md](auth/README.md).
- **Integrating auth/SSO into an app?** [auth/README.md](auth/README.md) is the
  full reference; RPs use the SDK providers and are zero-config.
- **Working on Oxy ID / Commons / civic features?** Read
  [identity/README.md](identity/README.md) → [reputation/README.md](reputation/README.md)
  → [nodes/README.md](nodes/README.md), in that order — each builds on the prior.
- **Want the history?** [CHANGELOG.md](CHANGELOG.md) maps every phase to its
  commits.

---

## Reference docs (existing, deployment/ops focused)

These pre-existing documents cover infrastructure, email, and platform-specific
topics and remain authoritative for their areas:

- [ARCHITECTURE.md](ARCHITECTURE.md) — original system architecture / identity vs auth
- [AUTHENTICATION.md](AUTHENTICATION.md) — auth integration guide (Expo, Web, Node, WebSockets)
- [CROSS_DOMAIN_AUTH.md](CROSS_DOMAIN_AUTH.md) — cross-domain SSO (device-first: `oxy_device` cookie + rotating refresh, native shared-keychain)
- [SESSION-ARCHITECTURE.md](SESSION-ARCHITECTURE.md) — session architecture notes
- [SERVICE_TOKENS.md](SERVICE_TOKENS.md) — service-to-service auth (OAuth2 client credentials)
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — AWS resources (ECS, ALB, ECR, ElastiCache, MongoDB)
- [DEPLOYMENT.md](DEPLOYMENT.md) — GitHub OIDC, ECS Fargate, env vars, Cloudflare Pages
- [REDIS.md](REDIS.md) — ElastiCache Valkey: rate limiting, Socket.IO adapter, caching
- [EMAIL.md](EMAIL.md) — native email (`username@oxy.so`), DKIM/SPF/DMARC, inbound webhook
- [EXPO_54_GUIDE.md](EXPO_54_GUIDE.md) — building universal apps with Expo

For the authoritative rules and version matrix, see the repo
[`AGENTS.md`](../AGENTS.md); for the F5 handoff, see
[`CONTINUATION.md`](../CONTINUATION.md).

---

## License

MIT (c) OxyHQ
