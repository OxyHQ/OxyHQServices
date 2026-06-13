# Cross-Domain SSO — Handoff (2026-06-13)

This document captures everything that has been built today on the Oxy auth stack so a Claude Code agent (or any engineer) can pick up from a cold start, finish the work, and verify it end-to-end in a real browser.

## TL;DR

We are migrating the Oxy web SDK to a **Clerk-style cross-domain SSO** architecture so the session survives a hard reload on Chrome (with FedCM) **and** Safari/Firefox (without FedCM, via first-party cookies). The infrastructure for that — DNS CNAMEs, Cloudflare Pages custom domains, multi-domain FAPI in the IdP worker, and an auto-detect on the SDK — is **done and live in production**. The remaining gap is that **`@oxyhq/services` (the RN/Expo+web SDK consumed by `accounts.oxy.so` and `inbox.oxy.so`) still does cookie-first / FedCM-fallback cold boot**, and the user reports the session is lost on reload in **all** apps (`accounts.oxy.so`, `inbox.oxy.so`, Mention; Alia and Homiio not yet tested). We need to (1) figure out why the cookie path is failing today and (2) port the FedCM-first cold-boot order from `@oxyhq/auth@3.1.0` (`WebOxyProvider`) into `@oxyhq/services` (`OxyContext`).

## Architecture (target — Clerk-style)

```
RP                          IdP                       API
─────────────────────────   ───────────────────────   ─────────────
mention.earth      ──CNAME──>  auth.mention.earth ─┐
homiio.com         ──CNAME──>  auth.homiio.com    ─┼──> oxy-auth.pages.dev
alia.onl           ──CNAME──>  auth.alia.onl      ─┤    (Cloudflare Pages
oxy.so             ───────>    auth.oxy.so        ─┘     advanced-mode worker)
                                                                   │
                                                                   ▼
                                                              api.oxy.so
                                                              (single backend,
                                                               session store of truth)
```

Why CNAMEs and not "just use cookies": Safari ITP + Firefox Total Cookie Protection partition third-party cookies. If `mention.earth` (the RP) tries to read a cookie set by `auth.oxy.so` (the IdP), that cookie is sandboxed away. With a CNAME `auth.mention.earth → oxy-auth.pages.dev`, the browser sees the IdP as **first-party** with the RP — the `fedcm_session` cookie is first-party in Safari/Firefox just like it is on Chromium-with-FedCM.

Why FedCM **and** cookies: FedCM is Chromium-only (Chrome/Edge/Brave/Opera/Arc). Safari and Firefox do not implement it. We must keep a cookie fallback transitionally until either (a) the CNAME-based first-party cookie works everywhere or (b) browser vendors ship FedCM.

## What is live in production (verified with curl, 2026-06-13)

### IdP — multi-domain FAPI

All four hosts return a manifest where `provider_urls` and `branding.icons[*].url` are absolute to **the request host**, not pinned to `auth.oxy.so`:

| Host                     | `/.well-known/web-identity`                                     | `/fedcm.json` icons[0]                       |
|--------------------------|------------------------------------------------------------------|-----------------------------------------------|
| `auth.oxy.so`            | `{"provider_urls":["https://auth.oxy.so/fedcm.json"]}`           | `https://auth.oxy.so/icons/icon-25.png`       |
| `auth.mention.earth`     | `{"provider_urls":["https://auth.mention.earth/fedcm.json"]}`    | `https://auth.mention.earth/icons/icon-25.png`|
| `auth.alia.onl`          | `{"provider_urls":["https://auth.alia.onl/fedcm.json"]}`         | `https://auth.alia.onl/icons/icon-25.png`     |
| `auth.homiio.com`        | `{"provider_urls":["https://auth.homiio.com/fedcm.json"]}`       | `https://auth.homiio.com/icons/icon-25.png`   |

CORS preflight `OPTIONS /fedcm/assertion` returns HTTP 204 with the right origin echoed on all four hosts.

### DNS + Cloudflare Pages

- Three new CNAMEs created via API today (proxied, TTL auto): `auth.mention.earth`, `auth.alia.onl`, `auth.homiio.com` — all CNAME `oxy-auth.pages.dev`.
- All three added as custom domains on the Cloudflare Pages project `oxy-auth`. ACM certs issued by Google CA. Status: `active`.

### Worker code

The IdP worker (`packages/auth/server/index.ts`) was rewritten today to be multi-domain:

- `resolveConfig()` (line 110) derives `fedcmIssuer` from `c.req.url` per-request. The `FEDCM_ISSUER` env var is kept as an explicit override for tests and local dev (where the request URL is `http://localhost:<port>` but the issuer must be a stable test hostname).
- `/fedcm.json` is a **dynamic handler** (line 369) — it used to live as a static asset under `packages/auth/public/fedcm.json` (which was deleted in commit `e1bfbf2a`) so Cloudflare Pages was serving it before the worker. Now the worker emits the manifest with icon URLs rooted at the request host.
- `/.well-known/web-identity` (line 347) returns `provider_urls: [\`${fedcmIssuer}/fedcm.json\`]` — also derived per-request.

### CRITICAL gotcha discovered today

`FEDCM_ISSUER` was set in **Cloudflare Pages production env vars** for `oxy-auth` (value: probably `https://auth.oxy.so`). The override branch in `resolveConfig()` always wins → every host was returning `auth.oxy.so` as the issuer, breaking multi-domain silently. **The env var was deleted via the Cloudflare API today** and the worker was re-deployed via wrangler. Multi-domain now works.

**Rule (added to `CLAUDE.md`)**: NEVER set `FEDCM_ISSUER` on the `oxy-auth` Pages project. If all custom-domain hosts report the same `provider_urls`, check Pages prod env vars first.

### SDK — `@oxyhq/auth` (web)

`@oxyhq/auth@3.1.0` published today on npm:

- New util `src/utils/fapiAutoDetect.ts` derives `https://auth.<eTLD+1>` from `window.location` (bails out on localhost/IP/single-label/non-http; short-circuits when already on `auth.*`). 12 unit tests cover this.
- `WebOxyProvider` calls the helper when `authWebUrl` is not passed explicitly → the SDK picks the right IdP host without consumer configuration.
- `WebOxyProvider` init effect was reordered to **FedCM-first cold boot**: (1) redirect callback → (2) FedCM silent → (3) cookie-path restore → (4) unauthenticated. 66 tests pass.

Consumers bumped today: `Alia` (root + 4 apps), `tnp`, `website`. All resolve `@oxyhq/auth@3.1.0` in their lockfiles.

## What still needs to be done

### The bug the user reports

"La sesión se pierde al hacer reload, en todos lados, en `accounts.oxy.so` en `inbox.oxy.so`, en Mention todavía no carga sesión, y Alia y Homiio todavía no probé."

This affects the apps that use **`@oxyhq/services`** (RN/Expo SDK running on web via Metro/expo-router web target), NOT `@oxyhq/auth`:

- `accounts.oxy.so` — `packages/accounts` (Expo Router web, uses `@oxyhq/services` `OxyProvider` + `OxyContext`)
- `inbox.oxy.so` — `packages/inbox` (same stack)
- Mention web — `~/Oxy/Mention/packages/frontend` (same stack)

The `WebOxyProvider` fix that lives in `@oxyhq/auth@3.1.0` has **no equivalent** in `@oxyhq/services` `OxyContext.tsx` yet.

### The cookie path — why it appears to be failing

`OxyContext.restoreSessionsFromStorage` (line 549–657) does, in order:

1. `restoreViaRefreshCookie()` (line 474) — `POST /auth/refresh-all` with `credentials: 'include'`. If `accounts.length > 0`, plants the active access token, sets sessions, returns true.
2. If that returns false, validates stored sessionIds via `oxyServices.validateSession()` (which is bearer-protected — 401s on hard reload because the access token is gone).
3. If switching to the active session fails too, the user lands in an unauthenticated state.

In theory step 1 should work on `accounts.oxy.so`: the cookie is `Domain=oxy.so` / `Path=/auth` / `SameSite=Lax` / `HttpOnly` / `Secure`. `accounts.oxy.so` and `api.oxy.so` are same-site (same eTLD+1 = `oxy.so`), so `SameSite=Lax` allows the cookie on the cross-origin `fetch` from `accounts.oxy.so` → `api.oxy.so/auth/refresh-all`. That's the design.

The user reports it's still broken. We need a **real browser session** to figure out which assumption is wrong. Hypotheses (ranked by likelihood):

1. **The cookie is never set on login** because the new login flow (verifyChallenge / FedCM) never calls `setRefreshCookie` for the web path. Possible after the recent SDK refactor (`d6c9d937` / `79681431`).
2. **The cookie gets cleared somewhere** — a stale `Path=/auth/refresh` legacy cookie deletion, or a logout-all on a sibling subdomain.
3. **`/auth/refresh-all` returns 200 with `accounts: []`** because the refresh token validation fails (e.g. expired, or session deleted, or rotated and the cookie now points to a dead token).
4. **`fetch` is sent without `credentials: 'include'`** somewhere on the cold-boot path (axios default in the SDK is `withCredentials: true` already, but worth double-checking on the specific call site).
5. **Mention specifically may be cross-site** to `api.oxy.so` (different eTLD+1) → cookie scoped to `oxy.so` will not travel at all to `api.mention.earth` if Mention's backend is `api.mention.earth`. We need to confirm Mention is hitting `api.oxy.so` or its own backend.

### Tasks for the Claude agent

1. **Reproduce in a real browser.** Open `https://accounts.oxy.so` logged in (or sign in fresh), confirm the session is active, hard-reload, and capture:
   - All `Set-Cookie` headers from the login response (was `oxy_rt` written? what Domain/Path/SameSite/Secure?).
   - The cookies sent on the reload's `POST /auth/refresh-all`.
   - The response body of `/auth/refresh-all` (200 with what `accounts` length?).
   - Whether `validateSession` returns 401 / what happens after.
   - DevTools → Application → Cookies → check both `oxy.so` and `accounts.oxy.so` cookie jars for `oxy_rt`.
2. **Decide between two fixes** based on the data:
   - **Cookie path is fixable** (e.g. cookie just wasn't being set, or Path is wrong): fix it upstream in `packages/api/src/routes/auth.ts` / `refreshToken.service.ts`, redeploy `oxy-api`, verify.
   - **Cookie path is fundamentally broken for cross-domain RPs** (Mention, Alia, Homiio): port the **FedCM-first cold-boot order** from `@oxyhq/auth` `WebOxyProvider` into `@oxyhq/services` `OxyContext.tsx`. On Chromium: silent FedCM runs first and resolves the session from the IdP. On Safari/Firefox: fall back to the (now-first-party-via-CNAME) cookie path against `auth.<rp-domain>` instead of `api.oxy.so`.
3. **Apply the fix.** Make the change in `@oxyhq/services`, bump version (8.1.3 minor → 8.2.0), build, run tests (`bun run test` in the services package + the consumer apps), publish to npm, then bump consumers (`accounts`, `inbox`, Mention, Alia, Homiio) and redeploy.
4. **Verify end-to-end in a real browser** on at least 3 surfaces: `accounts.oxy.so`, Mention web (`mention.earth`), and either Safari or Firefox. The acceptance test is: log in → close tab → reopen tab → session is still active without any user gesture.

### Constraints for the agent

- **No `as any`, `@ts-ignore`, `!` non-null assertions, `console.log` left in committed code, no `TODO/FIXME` comments, no silent `catch {}`.** Code quality must be Clerk/Auth0-grade.
- **Bun, not npm/yarn.** `bunx`, not `npx`. After install, regenerate `bun.lock` and commit it.
- **Fix upstream, never patch.** If the bug is in `@oxyhq/core` or `@oxyhq/api`, fix it there, publish, then bump consumers. No monkey-patching in the consuming apps.
- **Atomic commits** in English, present tense, concise. One commit per logical change. Push to `main` after each unit of verified work.
- **Test it.** `bun run test` in each touched package. For api changes: hit the deployed `api.oxy.so` with curl as part of verification (the deploy goes through `.github/workflows/deploy-aws.yml` → ECS Fargate; takes ~5 min after push).
- **Use Chrome MCP to verify in a real browser.** The agent has the `chrome-devtools` / equivalent tools — use them to script the reload-session test and capture network logs.
- **Refactor freely when it improves correctness, consistency, or clarity.** Two cold-boot flows that should behave identically (one in `WebOxyProvider`, one in `OxyContext`) should be unified — extract the shared logic into `@oxyhq/core` or `@oxyhq/auth` and have both providers consume it. Same goes for the FAPI auto-detect helper (`fapiAutoDetect.ts`) which is currently in `@oxyhq/auth` and needs to be reachable from `@oxyhq/services` — move it to `@oxyhq/core` if that is the right home. Do not paper over duplication with copy-paste; eliminate it.
- **Audit for cruft.** Any dead code, half-applied legacy paths (e.g. parallel `restoreFromCookies` + `restoreViaRefreshCookie`), redundant `useEffect`s, stale `dist/fedcm.json` artefacts, unused exports, `console.log` survivors, barrel re-export shims, or comments that explain workarounds rather than design — DELETE them. The deliverable is a clean codebase, not one with a fix bolted on.
- **Consistency is non-negotiable.** The web SDK (`@oxyhq/auth`) and the RN+web SDK (`@oxyhq/services`) must have **the same** cold-boot semantics, the same FAPI URL resolution, the same FedCM-first ordering. If `WebOxyProvider` does X, `OxyContext` does X (or shares the same primitive). If you find divergence, fix it.
- **No "temporary" anything.** No `// TODO: revisit in Phase 2`, no feature flags, no compat shims for an unspecified deprecation date. Phase 2 (deprecate cookie endpoints) and Phase 3 (delete them) are real milestones in `Next Steps` — schedule them, write them down with concrete dates, or do them now.
- **Keep the surface small.** Public exports from each SDK package belong in exactly one place (`src/index.ts`). No barrel files in subdirectories. If a helper is internal, do not export it.

## Files / state map (cold start cheat sheet)

### IdP worker (live)

- `packages/auth/server/index.ts:110` `resolveConfig()` — derives issuer per-request, env override at line 112.
- `packages/auth/server/index.ts:347` `GET /.well-known/web-identity` — dynamic.
- `packages/auth/server/index.ts:369` `GET /fedcm.json` — dynamic, icons absolute to request host.
- `packages/auth/server/__tests__/fedcm.idp.test.ts` — 23 tests passing.
- `packages/auth/dist/` — local build. `_worker.js` is 29.0 KB. **CRITICAL**: do not leave a stale `dist/fedcm.json` here; the Pages static asset overrides the worker route. The fresh `bun run build:worker` does not create one, but a `bun run build` (vite + bun) used to copy one from `public/`. The `public/fedcm.json` was deleted in commit `e1bfbf2a`.
- Deployment: `.github/workflows/deploy-cloudflare.yml` `deploy-auth` job. Direct Upload via `cloudflare/wrangler-action@v3` `pages deploy packages/auth/dist --project-name=oxy-auth --branch=main`.

### Web SDK — `@oxyhq/auth` (FedCM-first cold boot DONE)

- `packages/auth-sdk/src/WebOxyProvider.tsx:175` calls `autoDetectAuthWebUrl()` for default `authWebUrl`.
- `packages/auth-sdk/src/WebOxyProvider.tsx:295+` init effect: redirect callback → FedCM silent → cookie-path restore → unauthenticated.
- `packages/auth-sdk/src/utils/fapiAutoDetect.ts` — eTLD+1 derivation helper, 12 tests.
- `packages/auth-sdk/package.json` version `3.1.0`. Published. Confirmed propagation via `npm view @oxyhq/auth version`.

### Web/RN SDK — `@oxyhq/services` (NEEDS THE FIX)

- `packages/services/src/ui/context/OxyContext.tsx:474` `restoreViaRefreshCookie()` — calls `oxyServices.refreshAllSessions()`.
- `packages/services/src/ui/context/OxyContext.tsx:549` `restoreSessionsFromStorage()` — cookie path first, then stored-session validation, then nothing.
- `packages/services/src/ui/context/OxyContext.tsx:659` init `useEffect`.
- `packages/services/src/ui/context/OxyContext.tsx:735` `useWebSSO({...})` — silent FedCM hook. Currently does NOT block the init flow; it runs in parallel.
- `packages/services/src/ui/context/OxyContext.tsx:767` hardcoded `auth.oxy.so` as the FAPI URL (the auto-detect helper in `@oxyhq/auth` is NOT yet ported here).

### API — refresh cookies

- `packages/api/src/services/refreshToken.service.ts:522` `buildRefreshCookieOptions()` — `httpOnly: true`, `secure: prod`, `sameSite: 'lax'`, `domain: 'oxy.so'`, `path: '/auth'`, `maxAge: 30d`. The `REFRESH_COOKIE_DOMAIN` env var overrides the default `oxy.so`.
- `packages/api/src/services/refreshToken.service.ts:571` `setRefreshCookie()` — writes both per-`authuser` suffix cookie and legacy `oxy_rt` cookie.
- `packages/api/src/routes/auth.ts` — refresh-all + login + logout endpoints.

### Allowed origins (api)

- `packages/api/src/config/allowedOrigins.ts:22-34` — apex + subdomain pattern for `oxy.so`, `mention.earth`, `homiio.com`, `alia.onl`. `auth.<rp>` accepted automatically.

### Production endpoints

- `https://api.oxy.so` — ECS Fargate cluster `oxy-cluster`, service `oxy-oxy-api`, region `eu-west-1`. Deploy via `git push origin main` → `.github/workflows/deploy-aws.yml`.
- `https://api.mention.earth`, `https://api.alia.onl`, `https://api.homiio.com` — same ALB, separate hostnames.
- `https://auth.oxy.so` + 3 new CNAMEs — Cloudflare Pages `oxy-auth`.
- `https://accounts.oxy.so`, `https://inbox.oxy.so`, `https://console.oxy.so` — Cloudflare Pages.

### Tooling

- Cloudflare API token: `~/.config/oxy/cloudflare.token`. Verified active today.
- AWS profile `oxy` (IAM user `oxy-admin`, account `237343248947`, region `eu-west-1`).
- npm publish account `nateisern`.
- GitHub Actions OIDC role `oxy-github-deploy`.

## Commits made today (chronological)

1. `10f7234f` — `fix(auth/fedcm): add OPTIONS preflight handlers for /fedcm/assertion and /fedcm/disconnect`
2. `66e72e59` — `feat(auth-sdk): FedCM-first cold boot in WebOxyProvider`
3. `e1bfbf2a` — `feat(auth/fedcm): multi-domain FAPI (derive issuer + manifest from request host)`
4. `1899948a` — `feat(auth-sdk): auto-detect auth.<rp-apex> as the FAPI URL on web`
5. `72c2a0b3` — `chore(auth-sdk): release @oxyhq/auth@3.1.0`
6. `f5b55289` — `docs(claude): document Clerk-style multi-domain FAPI architecture`

Consumer bumps (separate repos):

- `~/Oxy/Alia` — `cf8368e2`
- `~/Oxy/tnp` — `7f4df4a`
- `~/Oxy/website` — `f4caa87`

## Key design decisions to preserve

- **CNAME pattern over cookie-domain juggling or session-bridge backend.** Zero code in RP backends. Per-RP isolation.
- **SDK auto-detect over Clerk's `publishableKey` with FAPI base64-encoded.** Simpler API, same result.
- **Cookie fallback stays until soak proven.** Safari/Firefox have no FedCM. Removing cookies today breaks 25–30% of traffic.
- **`fedcm.json` dynamic, not static.** Entire FedCM flow single-origin with the RP.
- **`FEDCM_ISSUER` env var override kept for tests/local dev.** Must never be set in production.
- **Service must be Clerk-grade.** No `as any`, no barrel re-exports, no compatibility shims.

## Known good test commands

```bash
# IdP server tests
cd ~/Oxy/OxyHQServices/packages/auth && bun run test          # 23/23

# auth-sdk tests
cd ~/Oxy/OxyHQServices/packages/auth-sdk && bun run test      # 66/66

# core tests
cd ~/Oxy/OxyHQServices/packages/core && bun run test          # 174/174

# api tests
cd ~/Oxy/OxyHQServices/packages/api && bunx jest              # 291/291

# Live IdP smoke
for d in auth.oxy.so auth.mention.earth auth.alia.onl auth.homiio.com; do
  echo "=== $d ==="
  curl -s "https://$d/.well-known/web-identity?cb=$(date +%s)"
  echo
  curl -s "https://$d/fedcm.json?cb=$(date +%s)" \
    | python3 -c "import json,sys;r=json.load(sys.stdin);print('icons[0]:',r['branding']['icons'][0]['url'])"
done
```
