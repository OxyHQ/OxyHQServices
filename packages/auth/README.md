# Oxy Auth Web

Standalone Vite app — the Oxy authentication gateway (OAuth-like, similar to "Sign in with Google") and FedCM Identity Provider. Handles sign in, sign up, recovery, and authorization for third-party apps. Not a user dashboard.

## Routes

- `/login` - Password sign-in (email/username + password)
- `/signup` - Password sign-up (email + username + password)
- `/recover` - Password recovery (request → verify → reset)
- `/authorize?token=...&redirect_uri=...&state=...` - Approve a third-party auth session

There is no landing page at `/`.

## API Base URL

The web app calls the API directly. In development it defaults to
`http://localhost:3001`. Override with:

- `VITE_OXY_AUTH_URL` (preferred) — Example: `http://localhost:3001`
- `VITE_OXY_API_URL` (fallback)

## Development

```bash
# Terminal 1 (API)
cd ../api
bun run dev

# Terminal 2 (Auth web)
cd ../auth
bun run dev
```

Default ports:
- Auth web: http://localhost:3000
- API: http://localhost:3001

## Flow Overview

1. A third-party app creates an auth session via the API.
2. The user is sent to `/authorize?token=...` (web) or the Accounts app (mobile).
3. The auth gateway signs in the user and authorizes the session.
4. The app receives the session token/access token and completes login.

## FedCM Identity Provider (IdP) Server

The `server/` directory serves the FedCM IdP endpoints. Requirements for Chrome to accept them:

- `/.well-known/web-identity` MUST be served as `application/json` (not `application/octet-stream` — Chrome rejects it).
- `id_assertion_endpoint` and `disconnect` MUST include:
  - `Access-Control-Allow-Origin: <RP origin>`
  - `Access-Control-Allow-Credentials: true`
  - Enforce the `Sec-Fetch-Dest: webidentity` request guard.
- `POST /fedcm/nonce` mints a server-bound, origin-scoped nonce required before token exchange — purely local UUID nonces are rejected with `invalid_nonce`.

Changes to the IdP server require a redeploy of auth.oxy.so to take effect in production.

## Deploy Safety (IdP is production-only — there is NO staging)

`auth.oxy.so` is the SSO Identity Provider for the entire Oxy ecosystem and has **no staging environment** — every push to `main` deploys straight to production for all users. A broken IdP build (blank SPA, a static-only deploy that drops the `_worker.js`, a crashed `/sso` error page, or a pinned multi-domain issuer) takes SSO down everywhere.

Two gates protect the deploy (`.github/workflows/deploy-cloudflare.yml`, job `deploy-auth`):

1. **Build-time**: `bun run build:worker` runs and the job fails fast unless `dist/_worker.js` exists, so a static-only build can never ship.
2. **Post-deploy smoke gate**: after the Cloudflare Pages deploy, `bun run smoke:idp` (`scripts/smoke-idp.ts`) hits the LIVE host on PUBLIC, unauthenticated endpoints only and turns the job RED on any failure. It asserts: `/.well-known/web-identity` is 200 JSON with `provider_urls`; the FedCM config is JSON (not SPA HTML); `/`, `/login`, `/signup` carry the SPA root marker; `/sso` (no params) renders the branded error page instead of crashing; `POST /fedcm/assertion` is answered by the worker as 4xx JSON (proving `_worker.js` is live, not a 405/SPA-HTML static deploy); and each per-apex host (`auth.mention.earth`, `auth.alia.onl`, `auth.homiio.com`, `auth.syra.fm`) reports its OWN issuer in `provider_urls` (the multi-domain FAPI contract).

Run it locally against production any time:

```bash
cd packages/auth
bun run smoke:idp                                   # default target https://auth.oxy.so
SMOKE_TARGET=https://auth.mention.earth bun run smoke:idp
SMOKE_SKIP_SECONDARY=1 bun run smoke:idp            # primary host only
```

**Contribution norm for IdP changes:**

- **Batch IdP changes and land them via PR**, not rapid direct-to-`main` cosmetic pushes. Each push is an un-staged production deploy; a flawed intermediate build briefly broke `auth.oxy.so` exactly because cosmetic changes were pushed straight to `main` one at a time.
- The **post-deploy smoke gate must stay green**. If it goes red, the live IdP is broken — treat it as an incident, not a flaky test.
- **Always verify the logged-OUT cold-boot path** (`/login` and `/signup` for a fresh, no-cookie visitor). That is the real first-time user path and the one that broke today; a logged-in spot check is not sufficient.

## Key Patterns

- `AuthFormLayout` + `AuthFormHeader` — shared layout for all auth screens
- `AuthLayout` (route layout) — persistent logo/footer, route-level fade transitions via `useNavigationType()`
- Login form: multi-step (identifier → password → 2FA) with per-step animations
- `applyColorPreset()` from `lib/bloom-css.ts` — applies user's Bloom color theme to CSS vars on `:root`
- `OxyServices.lookupUsername()` — lightweight user lookup (validates existence, gets color/avatar)
- Zod schemas in `lib/schemas.ts`; shared types in `lib/types.ts`

## Anti-patterns to Avoid

- No `useEffect` for syncing props to state — derive during render
- No `useEffect` for firing toasts — call `toast()` in event handlers
- No `useEffect` for focus — use `requestAnimationFrame` in event handlers
- No `Suspense` wrappers unless using `React.lazy()` or `use()`
- No render-body side effects — use `useEffect` for `window.location.href`, or `<Navigate>` from react-router
