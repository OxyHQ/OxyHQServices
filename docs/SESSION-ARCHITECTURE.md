# Oxy Session Architecture (2026)

Single source of truth for how every Oxy app keeps a user signed in.
Researched against how Google (FedCM, mandatory for GIS since Aug 2025) and
Meta ("Meta Account", Apr 2026) actually work in 2026.

## Principle

> **Central IdP for SIGN-IN. Each app keeps its OWN first-party session on its OWN domain.**

FedCM / passkeys = how you authenticate ONCE. Persistence (staying signed in
across reloads) = each app's own first-party session. This is what Google and
Meta do, and it is confirmed by the FedCM spec: after FedCM returns an identity
token, "the RP validates it and starts its own session"; on later visits the RP
checks ITS OWN session, not FedCM. Safari does not implement FedCM, so FedCM can
never be the persistence mechanism — the app's own session is the universal base.

Consequences:
- No cross-domain cookies. No third-party cookies. No proxy-as-a-hack. No
  per-app subdomain hacks.
- The cross-domain problem disappears because no app depends on another
  domain's cookie.

## Credential storage (NON-NEGOTIABLE, security)

| Token | Web | Native (Expo/RN) |
|-------|-----|------------------|
| Refresh / session (long-lived) | **httpOnly first-party cookie** | **SecureStore** (Keychain/Keystore) |
| Access token (~15 min) | **memory only** (JS variable) | memory |

- NEVER store any token in `localStorage` / `sessionStorage` (XSS-readable).
- Cookie flags: `HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=2592000`,
  `Domain` = the APP's own registrable domain (`oxy.so`, `mention.earth`,
  `homiio.com`, `alia.onl`...). Single-use, rotated on every refresh, with
  reuse-detection that revokes the whole token family + session.

## Components

1. **Central session store** — `api.oxy.so`. Owns the `RefreshToken` model +
   rotation + reuse-detection (already built). The ONE source of truth for
   refresh-token validity. No per-app token stores.
2. **Session bridge** — a thin, standard, same-site middleware each non-`oxy.so`
   app backend mounts (`api.mention.earth`, `api.homiio.com`, `api.alia.onl`).
   It sets/reads the first-party cookie on the app's own domain and FORWARDS the
   user's own refresh credential to `api.oxy.so` to rotate. It does NOT mint
   service tokens and holds no secret of its own — it just moves the user's own
   credential between the app domain and the central store.
3. **SDK** — `@oxyhq/core` + `@oxyhq/services` + `@oxyhq/auth`. A uniform session
   layer with a configurable `sessionBaseUrl` per app. Refresh goes to the app's
   OWN backend; access token kept in memory; native uses SecureStore.

## Scaling to many apps — the professional model is OIDC (not a shared worker)

> An earlier draft proposed a shared Cloudflare Worker forwarding ONE central cookie
> to every vanity domain. **That is SUPERSEDED — it's a clever shortcut, not how the
> pros do it.** The professional, standard, Google/Meta/Auth0/Okta-grade model is
> **OIDC**: the central IdP (`auth.oxy.so`) + each app as a Relying Party (RP). Oxy
> already has the OAuth/OIDC bones (`/authorize`, `/fedcm`, `oauthCode.service.ts`,
> the `DeveloperApp` client registry, the account chooser) — LEAN INTO THEM.

**Sign-in (uniform, every app):** the app sends the user to `auth.oxy.so/authorize`
(OIDC authorization code + PKCE). Because that's a TOP-LEVEL navigation to the IdP, the
IdP's session cookie is FIRST-PARTY there → the **account chooser shows the user's
active sessions** (Google-style — built into the flow, every app gets it for free). The
IdP returns a code; the app exchanges it for tokens. FedCM (Chrome) gives the same
"pick an existing account" UX with no redirect.

**Persistence — each app keeps its OWN first-party session, tiered by what it has:**
- **Tier 1 — `*.oxy.so` apps** (accounts, inbox, console, allo…): same-site with
  `api.oxy.so` → use its first-party cookie directly (the Phase-1 foundation, already
  built). No redirect on reload.
- **Tier 2 — vanity-domain apps WITH a backend** (mention.earth, homiio.com,
  alia.onl): **BFF (Backend-For-Frontend) — the professional standard, what every
  Google property does.** The app's OWN backend is the OIDC confidential client: it
  does the code+PKCE exchange, holds the refresh token SERVER-SIDE, and sets a
  first-party httpOnly session cookie on the app's OWN domain. Tokens are scoped to
  that app's `client_id` (per-app isolation — compromising one app can't touch
  others). No redirect on reload. These apps ALREADY have backends.
- **Tier 3 — frontend-only vanity apps**: OIDC public client + **FedCM** (Chrome:
  silent renewal, no redirect, no third-party cookie) with a silent-redirect/popup
  fallback (Safari/Firefox). Access token in MEMORY (never localStorage). Per-app =
  a `client_id` + the SDK; ZERO per-app infra. Standard SPA model (Auth0/Firebase/
  Clerk) and exactly what Google does for frontend RPs post-3p-cookie.

**Why OIDC beats the shared-worker idea:** it's the industry standard (auditable,
library-supported, what Google/Meta/Okta use); gives PER-APP token scoping (better
isolation than passing one central cookie around); builds the account chooser into the
flow uniformly; and avoids the shared-`oxy.so`-cookie CSRF surface (MED-1, §4) by giving
each app its own cookie on its own domain. Scale = register a `client_id` + use the
SDK; the IdP is the ONE shared piece (already exists). No per-app worker, no per-app
bridge code.

**The SDK hides all tiers** behind one API (`useOxy()` / `restoreSession()`): same-site
cookie (tier 1), BFF cookie (tier 2), or FedCM/silent-renewal (tier 3) — chosen
automatically. App devs never hand-roll auth.

> NOTE: the Phase-1 `*.oxy.so` foundation (the three `/auth/*` endpoints + single
> `oxy_rt` cookie) stays as tier 1. Tiers 2–3 are the NEXT design work and should reuse
> Oxy's existing OAuth/OIDC + FedCM rather than the deprecated worker idea.

### Session bridge — forwarding contract (Phase 1 reference)

The central session store on `api.oxy.so` exposes exactly three endpoints. A
same-site session bridge (or, for `*.oxy.so`, the app directly) talks to these:

| Endpoint | Credential / auth | Behaviour |
|----------|-------------------|-----------|
| `POST /auth/session` | **REQUIRES** the user's bearer access token (`Authorization: Bearer <jwt>`) | Mints/sets `oxy_rt` for THAT token's session and returns `{ accessToken, expiresAt }`. The bound sessionId is derived **only** from the bearer token — it NEVER accepts a sessionId param/body/query (that was a reverted HIGH vuln). Called right after FedCM/login to establish the first-party cookie. |
| `POST /auth/refresh` | The httpOnly `oxy_rt` cookie ONLY (no bearer) | Rotates the token (single-use) and reuse-detects (replay revokes the whole family + deactivates the session). Returns `{ accessToken, expiresAt }`. |
| `POST /auth/logout` | The httpOnly `oxy_rt` cookie (no bearer required) | Revokes the refresh family server-side + clears the cookie. Idempotent and best-effort: a missing/garbage cookie still returns `200 { success: true }`. |

**`oxy_rt` cookie attributes:** `HttpOnly; Secure; SameSite=Lax; Path=/auth;
Max-Age=2592000` (30 days), `Domain` = the app's own registrable domain
(`oxy.so`, `mention.earth`, `homiio.com`, `alia.onl`, …). Single-use, rotated on
every `/auth/refresh`, with reuse-detection that revokes the whole token family +
session. Scoped to `/auth` so the browser sends it to all three routes above.

**The bridge rule:** the bridge forwards the user's OWN credential — it mints no
service token and stores no secret of its own. On the app domain the bridge holds
the first-party cookie; to rotate it forwards to `api.oxy.so`'s `/auth/refresh`
(or establishes the cookie via `/auth/session` using the user's bearer right after
sign-in). It only moves the user's own credential between the app domain and the
central store.

> External-app bridges are NOT wired yet. Phase 1 is `*.oxy.so` only (the cookie
> is already first-party there). Do not touch mention/homiio/alia until the
> foundation is verified on `*.oxy.so`.

## Uniform endpoint contract (`{sessionBase}` = the app's own backend)

- `POST {sessionBase}/auth/session` — establish after sign-in. Input: a
  validated Oxy session reference (sessionId / FedCM assertion). Sets the
  httpOnly cookie on the app's domain. Returns `{ accessToken, expiresAt }`.
- `POST {sessionBase}/auth/refresh` — reads the cookie, rotates it (reuse-
  detection revokes the family on replay), returns `{ accessToken, expiresAt }`.
- `POST {sessionBase}/auth/logout` — revoke server-side + clear the cookie.

For `*.oxy.so` apps, `sessionBase = https://api.oxy.so` (direct — the cookie is
already first-party). For other apps, `sessionBase` = the app's own API, whose
bridge forwards to `api.oxy.so`.

## Sign-in

- Chrome: FedCM via the `auth.oxy.so` IdP + the Google-style account chooser
  (already built).
- Safari / Firefox: popup fallback against `auth.oxy.so` (already built).
- Passkeys (WebAuthn) as the auth factor — future, optional, like Meta Account.

## Rollout (incremental, each step security-reviewed)

1. **Foundation** — central endpoints (`/auth/session`, `/auth/refresh`,
   `/auth/logout`) on `api.oxy.so`; SDK `sessionBaseUrl` config + memory access
   token. Additive, reversible.
2. **Verify** on accounts / inbox / allo (`*.oxy.so`, already same-site).
3. **mention** — mount the bridge on `api.mention.earth`; point the SDK at it.
4. **homiio**, **alia** — same.
5. **Cleanup & hardening** (runs LAST, AFTER the new flow is verified end-to-end)
   — remove every legacy / dead / duplicated auth+session path the new
   architecture supersedes. Production-grade, clean, well-structured.
   **Verify-then-remove**: grep all consumers + `test-build` gate before deleting
   anything — never a blind delete that could log users out. Known targets:
   - localStorage/sessionStorage token writes: `core/AuthManager.ts` default
     `LocalStorageAdapter`; `core/mixins/OxyServices.redirect.ts` `storeTokens()`
     / `restoreSession()`.
   - The redirect-auth flow (`signInWithRedirect`) if no live consumer remains
     (superseded by FedCM + popup).
   - Duplicated session/refresh logic across core/services/auth; stale FedCM
     scaffolding; the earlier `/simplify` quality items.

Do NOT touch mention/homiio/alia until the foundation is verified on `*.oxy.so`.
Phase 5 runs LAST so we never ship clean-but-broken auth.
