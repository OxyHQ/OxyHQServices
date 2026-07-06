# Session Architecture

> Device-first session model for the Oxy ecosystem. The server is the single session
> authority (`DeviceSession`); clients mirror it through `SessionClient` in `@oxyhq/core`
> and receive real-time pushes over Socket.IO. There is **one** UI SDK: `@oxyhq/services`
> (`OxyProvider`) — the former web-only SDK package was deleted from the monorepo.
>
> Related docs: [device-session API reference](./auth/device-session.md) ·
> [third-party integration guide](./auth/integration-guide.md) ·
> [platform master plan](./architecture/oxy-auth-platform.md)

## Principles

- **Server authority.** Which accounts are signed in on a device — and which one is
  active — lives in one MongoDB document per device. Clients never own that state; they
  project it.
- **Silent cold boot.** `OxyProvider` restores the session on mount with zero UI. It never
  redirects to a login page and never opens a dialog on its own. Signed-out is a silent,
  valid outcome; interactive sign-in is always user-initiated (profile button →
  `OxyAccountDialog`).
- **Tokens never ride the socket.** Socket pushes carry token-free state only. Access
  tokens are minted and delivered exclusively over authenticated REST.
- **One write path.** Every mutation (add / switch / sign-out) goes through
  `/session/device/*`, bumps `revision`, and broadcasts — so every app on the device
  converges instantly.

## Server authority: `DeviceSession`

Model: `packages/api/src/models/DeviceSession.ts` (collection `devicesessions`).

```
deviceId          string   unique — stable identifier for one device/origin
accounts[]        { accountId, sessionId, authuser, addedAt, operatedByUserId? }
activeAccountId   ObjectId | null
cookieKeyHash     sha256 of the device cookie secret (sparse-unique; see Transport)
revision          number   monotonic — $inc on every mutation
```

`accounts[]` is the **device set**: the accounts currently signed in on this device.
`operatedByUserId` records the human operator when the entry is a managed account
(org/project/bot) — audit trail for `act_as` switches. `revision` gives clients a total
order: state application is last-writer-wins by revision across the device set.

### REST surface (`/session/device/*`)

Routes: `packages/api/src/routes/sessionDevice.ts`. All require a bearer token; the
`deviceId` is always derived from the **validated JWT claim** (or the device cookie),
never from the request body.

| Method | Route | Body | Behavior |
|--------|-------|------|----------|
| GET | `/session/device/state` | — | Returns current state. Converges a split-brain (JWT device vs. canonical cookie device) on read. |
| POST | `/session/device/add` | — | Registers the caller's account into the device set. Account + session ids come from the bearer (IDOR-safe); `operatedByUserId` is resolved from the session document. Idempotent — an unchanged re-register does not broadcast. |
| POST | `/session/device/switch` | `{ accountId }` | Sets `activeAccountId`, bumps `revision`, broadcasts. If the target session was revoked, heals the device set (drops the dead account), broadcasts the healed state, and returns 403. |
| POST | `/session/device/signout` | `{ accountId }` or `{ all: true }` | Removes one account or clears the device set; picks the next active account; broadcasts. |

Every response is validated against `deviceSessionSyncSchema` from `@oxyhq/contracts`:

```
{ data: { state: DeviceSessionState, activeToken: { accessToken, expiresAt } | null } }
```

Contracts (`packages/contracts/src/deviceSession.ts`): `sessionAccountSchema`,
`deviceSessionStateSchema`, `activeTokenSchema`, `deviceSessionSyncSchema` — shared by
the server (output validation) and `SessionClient` (input validation).

## Session transport (current)

The transport that carries "which device is this?" across reloads and origins is, today:

1. **`oxy_device` cookie** — a durable, first-party cookie (`Domain=.oxy.so`) holding an
   opaque random 256-bit secret. The server stores only its SHA-256
   (`DeviceSession.cookieKeyHash`), so a database dump cannot forge the cookie and the
   cookie value reveals nothing about the `deviceId`.
2. **Rotating refresh-token family** — persisted per app (localStorage on web,
   SecureStore on native) and rotated via `POST /auth/refresh-token`. A revoked family
   clears the local store.
3. **Boot fragment handoff** — an origin that cannot present the cookie to the API
   directly performs one top-level hop: `GET /auth/device/bootstrap?return_to&state`
   reads the cookie and bounces back to the app with a `#oxy_boot` fragment; the app then
   burns the single-use, origin-bound code with `POST /auth/device/exchange` (atomic
   GETDEL) and receives the session bundle. Same-apex web origins skip the hop entirely
   and use an inline credentialed `POST /auth/device/web-session` fetch.
4. **Converge on read/write** — `/session/device/{state,add}` reconcile a caller whose
   JWT carries a different `deviceId` than the canonical cookie device, merging the two
   documents and out-ranking the retired document's `revision` so stale state can never
   win.
5. **Native** — no cookies. A shared device token in the app-group keychain
   (`group.so.oxy.shared`, issued via `POST /auth/device/token`) joins every native Oxy
   app on the phone to the same `DeviceSession`.

> **Frozen by decision.** This transport is intentionally frozen until the "workshop 2c"
> design session. The long-term objective — a zero-cookie transport where a per-device
> secret mints tokens directly — is **pending only**: do not implement it, and do not
> modify the current transport, ahead of that workshop.

## Cold boot

`runSessionColdBoot` (`packages/core/src/boot/coldBootV2.ts`, exported from
`@oxyhq/core`) is a pure ordered short-circuit: the first step that yields a session
wins. It is invoked by `OxyProvider` on mount — apps never implement restore themselves.

1. **`bootstrap-return`** (web) — consume a `#oxy_boot` fragment: verify the expected
   `state`, exchange the code, plant the token.
2. **`stored-tokens`** — warm-plant a still-valid persisted access token (no network), or
   rotate the persisted refresh family.
3. **`shared-key-signin`** (native) — re-mint from the shared Commons identity in the
   keychain; on first use, issue and mirror the shared device token so all native apps
   share one device.
4. **`bootstrap-hop`** (web, terminal) — same-apex: inline credentialed web-session
   fetch; cross-apex: **one** visible top-level navigation to
   `GET /auth/device/bootstrap`, attempted once ever per origin.

If nothing yields a session, the app is silently signed out — no redirect, no dialog.

```mermaid
flowchart TD
  Mount["OxyProvider mount"] --> CB["runSessionColdBoot"]
  CB --> Frag{"boot fragment in URL?"}
  Frag -->|yes| Exchange["POST /auth/device/exchange"]
  Exchange -->|session| In["Authenticated — no UI"]
  Exchange -->|no session| Stored
  Frag -->|no| Stored{"persisted tokens?"}
  Stored -->|warm access token| In
  Stored -->|rotate family| Rotate["POST /auth/refresh-token"]
  Rotate -->|ok| In
  Rotate -->|revoked| Native
  Stored -->|none| Native{"native + Commons key?"}
  Native -->|yes| Shared["signInWithSharedIdentity"]
  Shared --> In
  Native -->|no / web| Apex{"same apex as API?"}
  Apex -->|yes| WS["POST /auth/device/web-session"]
  WS -->|session| In
  WS -->|signed out| Out["Signed out — silent"]
  Apex -->|"cross-apex, once ever"| Hop["top-level hop: GET /auth/device/bootstrap → back with boot fragment"]
  Hop --> Frag
  Out --> Btn["User taps profile button → OxyAccountDialog"]
```

## `SessionClient` (`@oxyhq/core`)

`packages/core/src/session/` — a framework-agnostic client mirror of the server state.
Exported from `@oxyhq/core` as `SessionClient`, plus the wiring helpers
`createSessionClient` and `createSessionClientHost`. `OxyProvider` constructs it; apps
consume it only through hooks.

Key behavior:

- `getState()` / `subscribe(listener)` — synchronous access to the current
  `DeviceSessionState` projection.
- `bootstrap()` — initial `GET /session/device/state` fetch + token plant.
- `switchAccount(accountId)` / `signOut({ accountId } | { all: true })` /
  `addCurrentAccount()` / `registerAndActivate()` — the only mutation paths; each calls
  the corresponding REST route and applies the returned sync.
- **`applyState` is last-writer-wins by `revision`** across the device set — a stale
  push or response can never regress newer state.
- **`applySync`** validates `{ state, activeToken }` against `deviceSessionSyncSchema`
  and plants the access token host-side; token planting is decoupled from revision
  advancement (an idempotent re-fetch still plants).
- `start()` attaches the Socket.IO listener; when the device set empties,
  `onUnauthenticated` clears the persisted store so a reload cannot restore a dead
  session.

## Real-time sync: `session_state`

Server side (`packages/api/src/utils/socket.ts`): each authenticated socket joins the
room `device:<deviceId>` — the id is derived from the **validated JWT claim**
(`deviceRoomFor`), never from a client-supplied value. Every `DeviceSession` mutation
calls `broadcastDeviceState(state)`, which emits `session_state` to that room with the
**token-free** `DeviceSessionState` payload.

Client side: on a `session_state` push, `SessionClient` applies the state
(revision-gated) and then asks its transport to `ensureActiveToken` — an authenticated
`GET /session/device/state` that returns `{ state, activeToken }` and plants the token.
Tokens therefore only ever travel over authenticated REST.

### Switch → broadcast (cross-app, same device)

```mermaid
sequenceDiagram
  participant A as App A (device X)
  participant SCA as SessionClient A
  participant API as api.oxy.so
  participant Room as Socket.IO room device:X
  participant SCB as SessionClient B (App B, device X)

  A->>SCA: switchAccount(accountId)
  SCA->>API: POST /session/device/switch { accountId }
  API->>API: activeAccountId = accountId, revision++
  API->>Room: emit session_state (token-free)
  API-->>SCA: { data: { state, activeToken } }
  SCA->>SCA: applyState + plant activeToken
  Room-->>SCB: session_state push
  SCB->>SCB: applyState (revision wins)
  SCB->>API: GET /session/device/state (bearer)
  API-->>SCB: { data: { state, activeToken } }
  SCB->>SCB: plant activeToken → UI switches instantly
```

## Multi-account: device set + account graph

Two distinct layers — do not conflate them:

| Layer | What it is | API |
|-------|-----------|-----|
| **DeviceSession** (device set) | Accounts signed in **on this device** right now | `/session/device/*`, `SessionClient` |
| **Account graph** | Accounts the user **may** use — own, child orgs/projects/bots, shared via membership | `GET /accounts`, `POST /accounts/:id/switch` (`account.service.ts`) |

The account switcher (`OxyAccountDialog`) shows both: the device set, plus graph accounts
available for `act_as` that are not yet signed in here.

Switch semantics (`useOxy().switchToAccount(accountId)`):

- **Account already in the device set** → `POST /session/device/switch` — flips
  `activeAccountId`, no new session minted.
- **Graph account not yet in the device set** (first entry) → `POST /accounts/:id/switch`
  mints a real session with `operatedByUserId` set to the operator, then registers it via
  `POST /session/device/add` — after which it switches like any other account. One
  uniform path; minting happens only on first entry.

Because the state lives server-side keyed by device, **a switch persists across reloads**
— the next cold boot reads the same `DeviceSession` and restores the same
`activeAccountId`. Signing an account out of the device set never revokes its graph
membership. See [device-session.md](./auth/device-session.md) for the full API detail.

## SDK surface

`@oxyhq/services` is the single UI SDK for Expo, React Native, and React Native Web:

```tsx
import { OxyProvider, useAuth, OxySignInButton } from '@oxyhq/services';

export function App() {
  return (
    <OxyProvider clientId={process.env.OXY_CLIENT_ID} baseURL="https://api.oxy.so">
      <Home />
    </OxyProvider>
  );
}

function Home() {
  const { isAuthenticated, signIn } = useAuth();
  if (!isAuthenticated) return <OxySignInButton />;
  return <Dashboard />;
}
```

- **`useAuth().signIn()`** opens the in-app dialog — interactive sign-in is never a
  redirect to a login page.
- **`OxyAccountDialog`** — the single account surface (switcher + Commons QR sign-in +
  collapsed password), built on Bloom
  `<Dialog placement={{ base: 'bottom', md: 'center' }}>`. Opened via
  `useOxy().openAccountDialog()`.
- **`OxySignInButton`** resolves the registered Application via
  `GET /auth/oauth/client/:clientId`: official apps open the dialog in-app;
  `third_party` apps perform a standard OAuth redirect with PKCE (`generatePkcePair`,
  `generateOAuthState`, `buildOAuthAuthorizeUrl` from `@oxyhq/core`). See the
  [integration guide](./auth/integration-guide.md).
- **`OxyConsentScreen`** — the IdP's OAuth consent surface, exported from
  `@oxyhq/services` and mounted by auth.oxy.so.

### IdP exception

auth.oxy.so is the OAuth authorize/consent surface, **not** a relying party and not a
session authority. It mounts `OxyProvider` with `coldBoot={false}` — no cold boot, no
device-session ownership — and redirects all `/settings/*` paths to accounts.oxy.so,
which is the sole owner of account management.

### Removed

FedCM, the silent-restore iframe, the cross-domain redirect-chain restore, and the
legacy client-side auth manager were all deleted. Cold boot is the four-step device-first
chain above — nothing else. Do not reintroduce multi-provider setups or per-app session
restore.
