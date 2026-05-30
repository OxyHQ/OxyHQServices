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
