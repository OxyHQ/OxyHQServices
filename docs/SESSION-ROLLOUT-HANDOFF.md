# Oxy Session/Auth Rollout — HANDOFF

> **Purpose of this file:** a complete, self-contained handoff so another AI (or
> engineer) can continue this work WITHOUT the prior chat context. Read this
> top-to-bottom, then read the design spec `docs/SESSION-ARCHITECTURE.md` (the
> single source of truth for the architecture).
>
> **Date handed off:** 2026-06-12. **Repo:** `OxyHQ/OxyHQServices` (local `~/Oxy/OxyHQServices`).
> **Branch:** `main`. **Backend deploys:** push `main` → `.github/workflows/deploy-aws.yml`
> → ECS Fargate `api.oxy.so`. **Frontends:** Cloudflare Pages via `deploy-cloudflare.yml`.

---

## 0. TL;DR — where we are right now

The original goal: **fix login on accounts.oxy.so and make sessions persist across
reloads, across ALL Oxy apps, securely, with no third-party cookies.**

- ✅ **Login fixed** (earlier — the "No authorization request" bug).
- ✅ **Reload persistence works for `*.oxy.so` apps** (accounts, inbox, allo) via a
  first-party httpOnly refresh cookie.
- ✅ **Google-style account chooser** at `auth.oxy.so/login` (shows the session
  list when you have a session, sign-in form when you don't). Built + deployed +
  verified.
- ✅ **Uniform session architecture decided + foundation built + deployed + verified
  in production** (Phase 1). Includes a **live bug that was found during browser
  verification and fixed** (see §3).
- ✅ **Security audit passed** (no HIGH). 2 MED + 1 LOW hardening items remain (§4).
- ⏳ **Remaining:** hardening (§4), then roll the system to the cross-domain apps —
  **mention** (mention.earth), **homiio** (homiio.com), **alia** (alia.onl) — then a
  cleanup phase (§5).

**The architecture in one sentence:** central IdP (`auth.oxy.so`) for SIGN-IN
(FedCM + popup fallback), and **each app keeps its OWN first-party session on its
OWN domain** (httpOnly cookie on web, SecureStore on native). This is how Google
and Meta actually do it in 2026 — confirmed by research (FedCM only handles
sign-in; the RP keeps its own session; Safari has no FedCM so it can't be the
persistence layer).

---

## 1. Hard constraints (DO NOT VIOLATE — from the user + global CLAUDE.md)

- **Security is paramount** ("todo tiene que ser super seguro"). This is auth for
  billions of users. No hacks, no tricky workarounds ("no hagas cosas tricky").
- **No third-party cookies** (being deprecated). **No `localStorage`/`sessionStorage`
  for tokens** (XSS-readable). Web: httpOnly first-party cookie (refresh) + memory
  (access token). Native: SecureStore (Keychain/Keystore).
- **Ask the user before important/architectural changes** ("si es algun cambio
  importante mejor preguntame"). Especially anything touching the live refresh flow.
- **Fix upstream, never patch downstream.** Bug in a shared package → fix the
  package, build, test, publish, then bump consumers. No monkey-patching.
- **Agent-first workflow.** Do NOT implement in the main thread. Delegate to the
  custom agents: `oxy-core`, `oxy-api`, `oxy-services`, `oxy-auth`, `oxy-frontend`,
  `security-reviewer`, `test-build` (always before push), `git-ops`.
- **Tooling:** `bun`/`bunx` only (never npm/yarn/npx). No `as any`, no `@ts-ignore`,
  no `console.log` in committed code, no TODO/FIXME, no `!` non-null assertions, no
  `var`, no silent `catch {}`. Proper types everywhere.
- **Each rollout step is security-reviewed.** Cleanup uses **verify-then-remove**
  (grep all consumers + test-build before deleting). Never a blind delete that could
  log users out.
- **Respond in the user's language** (Spanish or English — they write Spanish).
- **`test-build` before EVERY push.** When committing, stage files EXPLICITLY — there
  is an untracked stray build artifact `packages/auth/dist-server/node.js` that must
  NEVER be committed (don't `git add -A`).

---

## 2. What is DONE (with commits + how it was verified)

### 2a. Account chooser (Google-style) — DONE, deployed, verified
- **Files:** `packages/auth/lib/use-device-accounts.ts` (detection),
  `packages/auth/components/account-chooser.tsx` (UI),
  `packages/auth/components/login-form.tsx` (chooser gating + "Continue as"),
  `packages/auth/src/pages/authorize.tsx` (OAuth path), `packages/auth/lib/schemas.ts`.
- **How it works:** on `auth.oxy.so/login` boot, `detectAccounts()` does
  `POST /auth/refresh` (the durable httpOnly cookie) → mints an access token →
  decodes the `sessionId` from the JWT → `GET /users/me` (bearer) for the current
  account → `GET /session/device/sessions/:sessionId` (bearer) for sibling accounts
  → renders the chooser. 401/none → sign-in form.
- **Two bugs fixed during verification:** (1) detection originally used
  bearer-protected `/users/me` with no cold-boot token → always "logged out"; fixed
  to bootstrap from the `/auth/refresh` cookie. (2) `/users/me` returns the **raw
  Mongo doc** whose id is **`_id`, not `id`** (it does NOT go through
  `formatUserResponse`); the Zod schema required `id` → parse failed → chooser never
  showed. Fixed: `currentUserResponseSchema` accepts `_id`, and detection reads
  `_id ?? id`. (`/session/device/sessions` DOES use `formatUserResponse`, so its
  `user.id` is correct — left unchanged.)
- **Commits:** `13581deb`, `6d9b681`. **Verified:** browser screenshot showed
  "Choose an account → <user> → Use a different account".

### 2b. SDK published (earlier, to propagate fixes to external apps)
- `@oxyhq/core@1.11.24`, `@oxyhq/services@6.10.8`. (allo picked these up → its
  same-site reload persistence works.)

### 2c. Phase 1 — session foundation — DONE, deployed, verified in prod
- **Commit `923e067a`** (foundation) then **`02ee2ae8`** (the bug fix, see §3).
  `main` HEAD should be `02ee2ae8` (verify with `git log --oneline -3`).
- **`@oxyhq/core`:** added `sessionBaseUrl?: string` to `OxyConfig`
  (`packages/core/src/models/interfaces.ts`) + `getSessionBaseUrl()` returning
  `sessionBaseUrl ?? baseURL` (`packages/core/src/OxyServices.base.ts`). Additive;
  default keeps `*.oxy.so` apps pointing at `api.oxy.so`. **Not yet consumed by
  services/auth** — that's part of Phase 3.
- **`@oxyhq/api`** (`packages/api/src/routes/auth.ts` + `services/refreshToken.service.ts`):
  - `POST /auth/session` — **bearer-gated** (authMiddleware). Establishes the
    first-party `oxy_rt` cookie for the caller's OWN session. `sessionId` is derived
    **ONLY from the validated bearer token** — never from path/body/query (that exact
    "mint from raw sessionId" pattern was a reverted HIGH vuln; DO NOT reintroduce).
    Returns `{ accessToken, expiresAt }`.
  - `POST /auth/refresh` — reads the `oxy_rt` cookie, rotates (single-use) with
    reuse-detection, returns `{ accessToken, expiresAt }`.
  - `POST /auth/logout` — revokes the refresh family + clears the cookie. Idempotent,
    always 200, no bearer required (the cookie is the credential).
  - Cookie `oxy_rt`: `HttpOnly; Secure; SameSite=Lax; Path=/auth; Domain=oxy.so;
    Max-Age=2592000`. Path widened from `/auth/refresh` to `/auth` so the browser
    sends it to all three routes.

### 2d. The refresh-token store (already existed, reused — the security core)
- `packages/api/src/models/RefreshToken.ts` — `{ tokenHash, sessionId, userId,
  family, usedAt, revokedAt, expiresAt }`. Only the **sha256 hash** is stored.
- `packages/api/src/services/refreshToken.service.ts` — 256-bit tokens, single-use
  **rotation** within a **family**, **reuse-detection** (replaying a used token
  revokes the whole family + deactivates the session). This is the security
  foundation — preserve it.

---

## 3. The live bug we found + fixed (important — read this)

**Symptom:** after deploying the foundation (`923e067a`), browser verification on
`accounts.oxy.so` showed login worked but **reload lost the session** (`/auth/refresh`
returned 401).

**Root cause:** widening the cookie `Path` from `/auth/refresh` to `/auth` created a
**duplicate-cookie hazard**. A browser mid-migration can hold TWO `oxy_rt` cookies —
legacy `Path=/auth/refresh` + new `Path=/auth`. Both are sent to `/auth/refresh`;
per RFC 6265 the longer path (legacy) is sent FIRST, and Express `cookie-parser`
exposes only the first value. If the legacy one is stale/used → 401, and worse,
**reuse-detection revoked the family → logged the user out + killed the session**
on the 2nd post-deploy refresh. Proven with curl (stale-first=401, valid-first=200).

**Fix (commit `02ee2ae8`):**
- `parseRefreshTokenCandidates(req.headers.cookie)` — parses **ALL** `oxy_rt` values
  from the raw Cookie header.
- `classifyRefreshCandidates()` — classifies WITHOUT consuming. **Valid wins first**:
  if ANY candidate is currently valid, rotate THAT one and ignore used/revoked
  siblings. A **lone** used/revoked token with NO valid sibling still triggers
  reuse-detection (theft protection preserved — a browser only sends its own httpOnly
  cookies, so multiple candidates == the legit user's own migration duplicates).
- `setRefreshCookie`/`clearRefreshCookie` also emit a **deletion of the legacy
  `Path=/auth/refresh` cookie** via `res.append('Set-Cookie', ...)` so duplicates
  converge to a single `oxy_rt`@`/auth`.
- `/auth/logout` parses all candidates + revokes each family + clears both paths.

**Verified in production (curl):** migration `[used-legacy ; valid-new]` → 200, family
survives (subsequent refresh of the new token = 200), legacy-delete header present;
lone used token → 401 (reuse-detection intact). Browser: `refreshFromAccounts` went
401→200 after the fix; `accounts.oxy.so` reload stays on `/` (authenticated route)
and fires authed `/managed-accounts`. **Lesson: always verify in a real browser, not
just curl — the clean-env curl test passed but the real browser caught the bug.**

---

## 4. Security findings to address (from `security-reviewer`) — DO BEFORE SCALING

The fix itself is clean (no HIGH; reuse-detection intact; `/auth/session` ownership
correct; cookie parsing exact-match safe). Pending hardening:

- **MED-1 — CSRF on `/auth/refresh`, `/auth/session`, `/auth/logout`.** The cookie is
  `SameSite=Lax` (blocks cross-SITE), but `Domain=oxy.so` is shared across ALL
  `*.oxy.so`, so a **same-site XSS on any `*.oxy.so` origin** could POST to
  `/auth/logout` (session-DoS) or `/auth/refresh` (rotate-and-discard). Not credential
  theft. **Fix:** add `verifyCsrfToken` (double-submit) to these routes — but this
  **touches the SDK** (the web client must send `X-CSRF-Token`) and there is a
  **cold-boot chicken-and-egg** (the first `/auth/refresh` on a fresh page load may not
  have a CSRF token yet) that must be designed carefully. Note the asymmetry in
  `packages/api/src/server.ts`: `authLinkingRoutes` HAS `csrfProtection`, `authRoutes`
  does NOT. **This needs user sign-off (touches the live refresh flow).**
- **MED-2 — validate `REFRESH_COOKIE_DOMAIN` at startup.** It's interpolated into a
  hand-built `Set-Cookie` string (`appendLegacyRefreshCookieDeletion`). Add a strict
  hostname check in `validateRequiredEnvVars()` (`packages/api/src/config/env.ts`),
  fail-fast on a malformed value. Trivial + safe.
- **LOW — `/auth/session` accepts `?token=` in the URL** (via `extractTokenFromRequest`),
  which lands in proxy/access logs. Prefer header-only for token endpoints.

**Recommended order:** do MED-2 + LOW immediately (safe). Design MED-1 (CSRF)
carefully with the user's sign-off before touching the refresh flow.

---

## 5. Remaining rollout (the full plan)

> Full design + rationale in `docs/SESSION-ARCHITECTURE.md`. Below is the actionable
> sequence. Each phase: delegate to agents, security-review, verify in a real browser
> + curl, then proceed. Do NOT touch mention/homiio/alia until `*.oxy.so` is solid
> (it now is, modulo the §4 hardening).

### Phase 2.5 — Hardening (§4)
MED-2 + LOW now; MED-1 (CSRF) with user sign-off + SDK coordination.

### Phase 3 — mention (mention.earth) — the first cross-domain app
mention's frontend currently uses `@oxyhq/services` pointed at `api.oxy.so`, and its
backend (`api.mention.earth`) **delegates all auth to Oxy** (uses `oxy.auth()` →
`validateSession` against api.oxy.so; it has NO own sessions). To make persistence
first-party on `mention.earth`:
1. **Backend bridge** on `api.mention.earth` (same-site with mention.earth) — mount a
   thin standard "session bridge" exposing `POST /auth/session`, `/auth/refresh`,
   `/auth/logout` that set/read the first-party `oxy_rt` cookie **on `mention.earth`**
   and FORWARD the user's own refresh credential to `api.oxy.so` to rotate. It mints
   NO service token and holds no secret of its own (see the "Session bridge —
   forwarding contract" section in `docs/SESSION-ARCHITECTURE.md`). The central
   refresh-token store stays at `api.oxy.so` (one source of truth).
2. **SDK wiring** — consume `getSessionBaseUrl()` in `@oxyhq/services`
   (`OxyContext.tsx` `restoreViaRefreshCookie()` currently uses `apiBaseUrl`; make it
   use `sessionBaseUrl`) and `@oxyhq/auth`. Republish core+services, bump mention.
3. **mention frontend** — set `sessionBaseUrl` to `https://api.mention.earth`.
4. **Verify** in a real browser on mention.earth: login → reload → persists; logout
   revokes. Repeat the dual-cookie migration curl test against api.mention.earth.

### Phase 4 — homiio (homiio.com) + alia (alia.onl)
Same bridge pattern. **homiio already has its own JWT infra** (`JWT_SECRET` +
`JWT_REFRESH_SECRET` in its terraform), so it may need less new code. alia =
`api.alia.onl`.

### Phase 5 — Cleanup & hardening (runs LAST, verify-then-remove)
Remove legacy/dead/duplicated auth+session code the new architecture supersedes
(the user explicitly asked: "limpia todo el codigo innecesario, legacy, malo,
duplicado… listo para produccion"). Known targets (grep consumers + test-build before
deleting):
- **localStorage token writes** (violate the spec): `packages/core/src/AuthManager.ts`
  default `LocalStorageAdapter` (writes `oxy_access_token` to localStorage at
  init/handleAuthSuccess/cross-tab); `packages/core/src/mixins/OxyServices.redirect.ts`
  `storeTokens()`/`restoreSession()`.
- **Redirect-auth flow** (`signInWithRedirect`) if no live consumer remains (FedCM +
  popup replaced it).
- **Duplicated session/refresh logic** across core/services/auth; stale FedCM
  scaffolding; the earlier `/simplify` quality items (replace hand-rolled JWT decode
  with `jwt-decode`; `/auth/refresh` could return the user; dedup cookie try/catch;
  unify plant-session helper; fix misleading comments).

---

## 6. Quick reference

### Endpoints (api.oxy.so), all under `/auth`, cookie `oxy_rt` Path=`/auth`
| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /auth/session` | Bearer (own token) | Set first-party cookie for the bearer's session → `{accessToken, expiresAt}` |
| `POST /auth/refresh` | `oxy_rt` cookie(s) | Parse ALL candidates, rotate the valid one (reuse-detect lone used) → `{accessToken, expiresAt}` |
| `POST /auth/logout` | `oxy_rt` cookie(s) | Revoke family + clear both cookie paths → `200 {success:true}` |

### Key files
- `packages/api/src/routes/auth.ts` — the 3 endpoints.
- `packages/api/src/services/refreshToken.service.ts` — rotation, reuse-detection,
  `parseRefreshTokenCandidates`, `classifyRefreshCandidates`, cookie helpers,
  `REFRESH_COOKIE_PATH='/auth'`, `LEGACY_REFRESH_COOKIE_PATH='/auth/refresh'`.
- `packages/api/src/models/RefreshToken.ts`
- `packages/core/src/OxyServices.base.ts` (`getSessionBaseUrl()`),
  `packages/core/src/models/interfaces.ts` (`sessionBaseUrl?`).
- `packages/services/src/ui/context/OxyContext.tsx` — `restoreViaRefreshCookie()`
  (web reload persistence; **TODO Phase 3:** switch from `apiBaseUrl` to `sessionBaseUrl`).
- `packages/auth/lib/use-device-accounts.ts` + `components/account-chooser.tsx` +
  `components/login-form.tsx` + `src/pages/authorize.tsx` + `lib/schemas.ts` — chooser.
- `docs/SESSION-ARCHITECTURE.md` — the design spec (READ IT).

### Commits on `main` (newest first)
- `02ee2ae8` — fix: robust multi-cookie `oxy_rt` read (the §3 bug fix).
- `923e067a` — feat: session foundation (`/auth/session` + `/auth/logout` + cookie
  Path `/auth` + SDK `sessionBaseUrl`).
- `6d9b681`, `13581deb` — account chooser detection fix + `_id` schema fix.

### Verification commands

**Curl — the migration/duplicate test (must all hold):**
```bash
API=https://api.oxy.so
# 1) signup+login a fresh user, capture cookie V1 (use -c jar)
# 2) refresh(V1) -> V2  (V1 now USED)
# 3) refresh with header "Cookie: oxy_rt=<V1>; oxy_rt=<V2>"  => HTTP 200 (rotates V2),
#    response has Set-Cookie "oxy_rt=; Path=/auth/refresh; Max-Age=0" (legacy delete)
# 4) refresh(V3 from step 3)  => 200  (family SURVIVED — no false logout)
# 5) refresh with header "Cookie: oxy_rt=<V1>"  => 401 (reuse-detection on lone used)
```
(The full scripted version was run and passed in prod on 2026-06-12.)

**Browser:** on `accounts.oxy.so`, login a fresh user, reload → must stay signed in
(URL stays at `/`, not `/sign-in`). NOTE: a brand-new **web** signup has no identity
(identity creation is native-only), so the dashboard may render blank — that is the
"fresh user" artifact, NOT an auth failure. The auth signal is the route + an authed
API call (e.g. `/managed-accounts`), not the rendered content.

### Infra / deploy
- **api.oxy.so** = ECS Fargate (cluster `oxy-cluster`, eu-west-1, account
  `237343248947`). Deploy = push `main` → `deploy-aws.yml` builds linux/arm64 → ECR →
  `ecs update-service --force-new-deployment` → `wait services-stable` (~5-6 min).
  Watch: `gh run list -R OxyHQ/OxyHQServices --workflow=deploy-aws.yml -L 1`.
- **Frontends** (accounts, inbox, auth, console) = Cloudflare Pages via
  `deploy-cloudflare.yml` (jobs deploy-auth/accounts/inbox/console). `auth` deploys
  as a CF Pages advanced-mode `dist/_worker.js` (FedCM IdP). Watch:
  `gh run list -R OxyHQ/OxyHQServices --workflow=deploy-cloudflare.yml -L 1`.
- accounts/inbox bundle `@oxyhq/services` + `@oxyhq/core` **from source** (Metro);
  allo/mention use the **published** npm versions.

### Unrelated but important (do NOT bundle with cookie changes)
- JWT secret rotation (`ACCESS_TOKEN_SECRET`/`REFRESH_TOKEN_SECRET`/`FEDCM_TOKEN_SECRET`)
  is pending per project notes. Rotating JWT secrets logs EVERYONE out once — must be
  a deliberate standalone action, never riding along with a cookie/session change.

---

## 6b. Account switcher (Google-style) — a REQUIREMENT across ALL apps

The user's intent: **every Oxy app, on entry, if the user already has active
sessions, must surface the account switcher FIRST (like Google) — never a bare login
form.** Oxy already has the pieces; the job is to UNIFY them (don't build a new one,
don't duplicate):

> **KNOWN BUG (user-reported on `auth.oxy.so`):** the chooser now shows "Choose an
> account", but signing in via **"Use a different account" REPLACES the previous
> session instead of ADDING it.** It must be **true multi-session, Google-style**: all
> signed-in accounts persist simultaneously, "Use a different account" APPENDS a new
> session to the device, the chooser lists ALL of them, and an account is only removed
> when the user explicitly removes/signs-it-out. This requires the device-session model
> + the session cookie/credential to hold MULTIPLE concurrent sessions (the Phase-1
> single `oxy_rt` = one session; multi-session needs an account index / per-account
> session like Google's `authuser`). Endpoint `GET /session/device/sessions/:sessionId`
> already exists to list device accounts — make login ACCUMULATE into it, and make the
> chooser + cookie model honor N concurrent sessions. This is core to the switcher.

- **IdP chooser (web sign-in entry)** — `auth.oxy.so/login` now shows the Google-style
  session list when a session exists (built this session: `packages/auth/lib/
  use-device-accounts.ts` + `components/account-chooser.tsx`). Every app's web sign-in
  should route through `auth.oxy.so` so the chooser is the universal entry. FedCM
  (Chrome) provides the same "pick an existing account" UX natively.
- **In-app multi-account switcher (SDK)** — `@oxyhq/services` already has multi-session
  account switching (bottom-sheet screens; `OxyContext` manages multiple `session_ids`)
  backed by `@oxyhq/core` `accountUtils.ts` (`buildAccountsArray`, `createQuickAccount`)
  + `displayUtils.ts`. This is the in-app "switch account" surface.
**TODO for the implementer:** (1) audit where each surface lives, (2) ensure every app
(web + native, all tiers) shows active sessions first via these EXISTING components,
(3) make the IdP chooser + FedCM + the SDK switcher consistent (same accounts, same
ordering, "use a different account" path) — one unified switcher, not three. Verify in
a real browser that opening an app with an active session shows the switcher, not a
login form.

**ALSO — polish the `@oxyhq/services` account UI into ONE reusable component (user
asked, it's currently messy/"lioso" with disconnected screens).** Like Google's account
menu reused across all Google apps: a single **avatar button** (top-right) that opens a
**unified account menu** with: the current account (avatar, name, email), **"Manage
account"** (→ accounts.oxy.so / the right management surface), the **account switcher**
(list active sessions + "Add another account"/"Use a different account"), and **Sign
out**. The same component must be dropped into EVERY app and behave identically. The
sign-in button, avatar button, and account-switcher screens must be wired together (no
dead-ends). This is a `@oxyhq/services` (+ shared `@oxyhq/core` account helpers:
`accountUtils.ts`, `displayUtils.ts`) job — build/refactor ONE polished component,
delete the duplicated/disconnected ones (verify-then-remove), then verify it in a real
app. Production-grade, consistent, connected.

**Chooser hover-theming (user-requested polish on `auth.oxy.so`):** the chooser already
uses Bloom theming correctly. ADD: when the user HOVERS over an account row, switch the
active theme to THAT account's configured Bloom color (each account has its own chosen
`color`); revert to the base/default theme on mouse-leave. Implementation: the raw
`GET /users/me` already returns a `color` field, but `currentUserResponseSchema` +
`deviceSessionsResponseSchema` (`packages/auth/lib/schemas.ts`) and the `Account` type
(`lib/types.ts`) do NOT capture it yet → add `color`. Check whether
`GET /session/device/sessions/:sessionId` includes `color` per user; if not, add it in
oxy-api (the device-sessions formatter), OR fetch per-account via
`GET /auth/lookup/:username` (already returns `color`). In
`packages/auth/components/account-chooser.tsx`, per row: `onMouseEnter` →
`applyColorPreset(account.color)` (from `lib/bloom-css.ts`), `onMouseLeave` → reapply
the base/default preset. Use a smooth CSS-var transition; respect reduced-motion. Do NOT
replace the brand colors permanently — it's a transient hover preview only.

## 6c. Known bug — Chrome blocks the cross-domain sign-in popup (mention)

User hit this on `mention.earth` (Chrome): the sign-in popup to
`auth.oxy.so/login?...&client_id=https://mention.earth&response_type=token` is BLOCKED.

**Root cause:** the web SSO flow attempts FedCM / silent sign-in (async `await`) BEFORE
opening the popup, so `window.open` (in `packages/core/src/mixins/OxyServices.popup.ts`
`openCenteredPopup`, called from `signInWithPopup`) runs AFTER an `await` → the
user-activation/transient gesture is gone → Chrome's popup blocker kills it.
`signInWithPopup` itself opens synchronously (no internal await before `openCenteredPopup`
at :107), so the lost activation comes from the CALLER chain awaiting FedCM/silent first
(`@oxyhq/services` `ui/hooks/useWebSSO.ts` / `ui/components/SignInModal.tsx:340` /
`ui/hooks/useAuth.ts:126`; `@oxyhq/auth-sdk` `hooks/useWebSSO.ts`).

**Fix (upstream → republish core+services+auth → bump mention/homiio/alia):** open the
popup SYNCHRONOUSLY in the click handler (to `about:blank`) BEFORE any async SSO attempt,
then either (a) silent/FedCM succeeds → `popup.close()`, or (b) navigate it:
`popup.location.href = authUrl`. Make `OxyServices.signInWithPopup` accept an optional
pre-opened `popup: Window` handle so the consumer can open it on the raw gesture and pass
it in. Keep the existing "popup blocked" error as a fallback. Verify on `mention.earth` in
Chrome (no block) AND Safari. NOTE: when the OIDC migration (Tier 2/3, §5) lands, the
popup may be replaced by FedCM + a top-level redirect anyway — but fix the popup now so
sign-in isn't broken in the meantime.

## 7. Immediate next step (what to do first)

The work paused awaiting a user decision: **(a)** do the §4 hardening now (incl. CSRF,
with SDK coordination) before expanding, or **(b)** proceed to Phase 3 (mention) and
batch the CSRF hardening later. The assistant recommended **(a)** — lock `*.oxy.so`
down to production-grade before expanding. Confirm with the user, then execute via the
agent-first workflow (delegate → security-review → test-build → git-ops → verify in a
real browser).
