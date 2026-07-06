# auth.oxy.so — the Oxy IdP

`packages/auth` is the standalone identity-provider app served at **auth.oxy.so**: a Vite + React DOM SPA deployed to Cloudflare Pages, plus exactly one Pages Function. It owns:

- The **OAuth 2.0 authorize + consent** surface for third-party "Sign in with Oxy" (Authorization Code + PKCE) — see [integration-guide.md](./integration-guide.md).
- The fallback **login / signup / recover** flows (keyless password accounts, 2FA, social providers).
- The **device-account chooser feed** that lets a returning device pick one of its signed-in accounts before authorizing an app.

It does **not** own account management: every `/settings/*` path permanently redirects to **accounts.oxy.so**, the sole owner of security, sessions, and profile settings.

## What the IdP is — and is not

| | |
|---|---|
| **Is** | The OAuth authorize/consent screen for `type: 'third_party'` Applications registered in Console |
| **Is** | A login/signup/recover UI that authenticates against `api.oxy.so` |
| **Is not** | A Relying Party — it never runs the RP cold boot or restores its own session |
| **Is not** | The session authority — that is `api.oxy.so` (`DeviceSession`, see below) |
| **Is not** | An account-management surface — `/settings/*` redirects to accounts.oxy.so |

Session authority and transport live entirely in `api.oxy.so`: the durable first-party `oxy_device` cookie (`Domain=.oxy.so`) plus a rotating refresh-token family, with the `#oxy_boot` fragment handoff (`GET /auth/device/bootstrap` → `POST /auth/device/exchange`) for bootstrapping a new browsing context. The server-side model is `DeviceSession` (`/session/device/*` + the `session_state` socket event) — see [device-session.md](./device-session.md). This transport is frozen by decision until the phase-2c workshop; a cookie-free `deviceSecret` mint remains a **pending future design**, not the current state. FedCM and the legacy silent/cross-domain restore machinery were deleted from the IdP and the SDK.

## Provider mount — `OxyProvider` in IdP mode

The IdP mounts the single UI SDK, `@oxyhq/services`, with cold boot disabled (`packages/auth/src/main.tsx`). The previous separate web SDK package no longer exists in the monorepo.

```tsx
import { OxyProvider } from '@oxyhq/services';

<OxyProvider baseURL={getApiBaseUrl()} clientId={OXY_CLIENT_ID} coldBoot={false}>
  <BrowserRouter>{/* routes */}</BrowserRouter>
</OxyProvider>
```

`coldBoot={false}` means the provider supplies UI context only — the `OxyAccountDialog` (Commons QR device-flow sign-in, opened from the login form via `useOxy().openAccountDialog`) and the `OxyConsentScreen` rendering context — without ever acting as a session-restoring RP. The IdP is the identity provider; treating it as its own RP would be circular.

## Routes / pages

| Route | Page / handler | Purpose |
|-------|----------------|---------|
| `/login`, `/auth/login` | `src/pages/login.tsx` → `LoginForm` | Account chooser (device accounts) → identifier → password → 2FA. "Sign in with Oxy" opens the services `OxyAccountDialog` (Commons QR). Accepts OAuth params (`client_id`, `redirect_uri`, `state`, `code_challenge`, `scope`, `login_hint`) to resume an authorize flow after sign-in |
| `/signup`, `/auth/signup` | `src/pages/signup.tsx` | Keyless password account creation (`POST /auth/signup`) |
| `/authorize`, `/auth/authorize` | `src/pages/authorize.tsx` | OAuth authorize: resolves the Application via `GET /auth/oauth/client/:clientId`, shows the account chooser, checks `GET /auth/oauth/consent`, renders **`OxyConsentScreen`** (from `@oxyhq/services`; shows the Application's name, logo, scopes, `privacyPolicyUrl`/`termsUrl`), mints the single-use code via `POST /auth/oauth/authorize`, redirects to the RP's `redirect_uri` |
| `/recover`, `/auth/recover` | `src/pages/recover.tsx` | Password recovery (`/auth/recover/request` → `verify` → `reset`) |
| `/auth/social/callback` | `src/pages/social-callback.tsx` | Social-provider OAuth callback (no layout) |
| `/settings`, `/settings/password`, `/settings/linked-accounts` | `ExternalRedirect` | → `https://accounts.oxy.so/security` |
| `/settings/sessions` | `ExternalRedirect` | → `https://accounts.oxy.so/sessions` |
| `/` | `ExternalRedirect` | → `https://oxy.so` |
| `*` | `Navigate` | → `/login` |
| `GET /api/device-accounts` | `functions/api/device-accounts.ts` (Pages Function) | Device-account chooser feed — the app's only dynamic route |

## Device-account chooser feed

The chooser ("Choose an account to continue") is fed by the one server-side route:

1. Browser hits same-origin `GET /api/device-accounts` (Cloudflare Pages Function, file-routed from `functions/api/device-accounts.ts`; logic in the framework-free `lib/device-accounts.ts`).
2. The function reads the first-party `oxy_device` cookie and forwards its raw value to the API's internal `POST /auth/device/resolve` under the `X-Oxy-Internal` secret. Fail-closed: no cookie, no secret, non-2xx, or malformed body all yield an empty account list.
3. The response is the device's `DeviceSession` account set (`activeAccountId` + accounts), each with a fresh server-minted bearer held **in memory only** — tokens are never persisted to Web Storage.
4. `lib/use-device-accounts.ts` consumes the feed; `components/account-chooser.tsx` renders it on `/login` and `/authorize`. Selecting the active account continues immediately; selecting another routes to `/login?login_hint=…` for re-auth.

Everything else (login, signup, authorize, recover) is the pure-static Vite SPA with history-fallback — no advanced-mode worker.

## API endpoints the IdP calls

All against `api.oxy.so` (`VITE_OXY_API_URL` in dev):

| Endpoint | Used by |
|----------|---------|
| `POST /auth/login` · `POST /auth/signup` | Login / signup forms |
| `POST /security/2fa/verify-login` | 2FA step |
| `POST /auth/recover/{request,verify,reset}` | Recovery flow |
| `GET /auth/social/:provider` + `/auth/social/callback` | Social sign-in |
| `GET /auth/session/status/:token` · `POST /auth/session/{authorize,cancel}/:token` | Cross-device session handoff (QR approve/deny) |
| `GET /auth/oauth/client/:clientId` | Resolve the requesting Application (public identity) |
| `GET /auth/oauth/consent` | Consent decision for the signed-in user |
| `POST /auth/oauth/authorize` | Mint the single-use authorization code |
| `POST /auth/device/resolve` (internal, via Pages Function) | Device-account chooser feed |
| `GET /csrf-token` | CSRF for cookie-credentialed writes |

The code→token exchange (`POST /auth/oauth/token`) happens on the RP side, never on the IdP — see [integration-guide.md](./integration-guide.md).

## Development

- **Tests:** `cd packages/auth && bun run test` — this package uses Bun's native test runner (`bunfig.toml` preload), not Jest. Never blanket-run `bun test` across the monorepo.
- **Deploy:** Cloudflare Pages (static SPA + `functions/` directory). The Pages Function needs `OXY_API_URL` and the internal-resolve secret as project bindings.

## Related docs

- [oxy-auth-platform.md](../architecture/oxy-auth-platform.md) — master plan and decisions
- [integration-guide.md](./integration-guide.md) — third-party "Sign in with Oxy" (OAuth + PKCE)
- [device-session.md](./device-session.md) — `DeviceSession` API, socket sync, multi-account
