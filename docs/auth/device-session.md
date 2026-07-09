# DeviceSession — server-authority session state per device

The `DeviceSession` document is the **single server-side authority** for "which accounts are signed in on this device, and which one is active". Every Oxy surface that shows or mutates the signed-in account set — RP apps via `OxyProvider` (`@oxyhq/services`), the IdP account chooser on auth.oxy.so — reads and writes the same document, and every mutation is pushed in realtime to all apps on the device via one socket room.

Source of truth (code):

| Piece | File |
|-------|------|
| Mongoose model (collection `devicesessions`) | `packages/api/src/models/DeviceSession.ts` |
| Service (state machine + healing + convergence) | `packages/api/src/services/deviceSession.service.ts` |
| REST routes `/session/device/*` | `packages/api/src/routes/sessionDevice.ts` |
| Socket broadcast | `packages/api/src/utils/socket.ts` (`broadcastDeviceState`, `socketRoomsFor`) |
| Wire contracts | `packages/contracts/src/deviceSession.ts` |
| Client (`SessionClient`) | `packages/core/src/session/` |

Related docs: [third-party integration guide](./integration-guide.md) (OAuth — third parties never use DeviceSession), [oxy-auth-platform.md](../architecture/oxy-auth-platform.md) (architecture plan).

> **Transport note (zero-cookie):** device identity rides `deviceId` + `deviceSecret` in first-party storage (localStorage per web origin; SecureStore on native). Restore/refresh mints a short access token via `POST /session/device/token` (no bearer, no cookies). There is no `oxy_device` cookie, no refresh-token family, and no `#oxy_boot` bootstrap hop — all deleted in the zero-cookie cutover. See [SESSION-ARCHITECTURE.md](../SESSION-ARCHITECTURE.md) § Session transport.

---

## Model & semantics

One document per `deviceId` (unique index):

```typescript
interface IDeviceSession {
  deviceId: string;                       // server-minted, never client-supplied
  accounts: IDeviceSessionAccount[];      // the device set
  activeAccountId: ObjectId | null;       // which account the device is "on"
  secretHash?: string;                    // sha256 of the current deviceSecret (sparse-unique)
  revision: number;                       // monotone change counter
  createdAt: Date; updatedAt: Date;
}

interface IDeviceSessionAccount {
  accountId: ObjectId;                    // User _id
  sessionId: string;                      // the ONE session for this account on this device
  authuser: number;                       // per-device account index (>= 0)
  addedAt: Date;
  operatedByUserId?: ObjectId | null;     // set for managed (act_as) accounts
}
```

### `revision`

Monotone per device: every state-changing write does `$inc: { revision: 1 }`. Clients apply pushes **last-writer-wins by revision within a deviceId** — a stale push (`revision <= current`) is discarded. When a push arrives for a *different* deviceId (device convergence, see below), the client resets its baseline and accepts it regardless of revision; the revision comparison is only meaningful within one device. Idempotent no-op writes (re-registering the same account+session on reload) do **not** bump the revision and do **not** broadcast.

### `authuser`

A small non-negative integer identifying the account's slot on this device — the lowest free index at registration time (`lowestFreeAuthuser`). It is per-device, assigned server-side, and exists so URLs/UI can reference "account 0 / account 1" on a device without leaking account ids. It is not guaranteed stable across a remove + re-add.

### `operatedByUserId`

Present when the entry is a **managed account** (org / project / bot) the operator switched into via the account graph (`account:act_as`). It records who is operating the account (audit) and drives two behaviors:

- **Sign-out cascade:** signing the operator's own account out of the device also removes every account entry whose `operatedByUserId` is that operator (one level deep).
- **Revocation healing:** managed entries are re-validated against the operator's live `act_as` membership before any token mint or switch; a revoked one is dropped from the device set instead of lingering (see healing below).

`operatedByUserId` lives on the `Session` document (not in the JWT), so routes resolve it from the session record when registering an account.

### One session per account per device

The device set stores exactly **one `sessionId` per account**. Every surface that authenticates the same account on the same device converges on that session (`resolveRegisteredSession`) instead of minting per-origin sessions — this is what makes all apps on a device join the same socket room and see each other's changes. Re-adding the same account with a *different* sessionId (a deliberate re-auth) replaces the entry and deactivates the displaced session.

OAuth token exchange, password login, QR handoff, and hub-ticket sync all thread the same `deviceId` so cross-origin web apps (official domains like `mention.earth` and third-party RPs) share one `DeviceSession` document server-side. Each origin still persists its own `{ deviceId, deviceSecret }` copy in `localStorage` (zero cookies); convergence happens via hub-ticket sync + silent OAuth (`prompt=none`) documented in [`SESSION-ARCHITECTURE.md`](../SESSION-ARCHITECTURE.md).

### Self-healing

Dead entries never sit in the set silently:

- `getState` validates a **managed** active account's session; if its `act_as` membership was revoked, the account is dropped through the normal signout cascade before the state is returned. Personal accounts are never dropped by this path (a transient token issue must not sign a human out).
- `switchActive` re-validates the target session **before** committing; a revoked target is removed (healed) and the switch is rejected with the healed state so other tabs drop it too.
- `resolveActiveToken` re-validates before minting; it never hands out a token for a revoked session.

---

## Contracts (`@oxyhq/contracts`)

Defined in `packages/contracts/src/deviceSession.ts`, exported from the package root:

```typescript
import {
  sessionAccountSchema,     // { accountId, sessionId, authuser, operatedByUserId? }
  deviceSessionStateSchema, // { deviceId, accounts[], activeAccountId, revision, updatedAt }
  activeTokenSchema,        // { accessToken, expiresAt }
  deviceSessionSyncSchema,  // { state, activeToken | null }
  type SessionAccount,
  type DeviceSessionState,
  type ActiveToken,
  type DeviceSessionSync,
} from '@oxyhq/contracts';
```

- **`DeviceSessionState`** is the token-free projection of the document (`updatedAt` as epoch ms). It is the socket payload and the `state` half of every REST response.
- **`DeviceSessionSync`** (`{ state, activeToken }`) is the REST response body: the state plus a freshly-minted access token for the active account, or `activeToken: null` when there is no active account or its session cannot mint.

The API validates its output against these schemas and `SessionClient` validates its input against the same definitions (`safeParseContract`), so producer and consumer cannot drift.

---

## REST API — `/session/device/*`

Router: `packages/api/src/routes/sessionDevice.ts`, mounted at `/session/device` in `server.ts`. `POST /session/device/token` is **public** (no bearer, no cookies) — possession of the `deviceSecret` is the proof. The other four routes share two gates:

1. **`requireSameSiteOrigin`** — browser-enforced CSRF guard (`Origin` allowlist / `Sec-Fetch-Site` fallback).
2. **Bearer auth** (`authMiddleware`). The `deviceId` is always read from the **bearer JWT's `deviceId` claim** — never from the body, query, or a header. There is no way to address another device's document.

| Method | Path | Body | Behavior |
|--------|------|------|----------|
| POST | `/session/device/token` | `{ deviceId, deviceSecret }` | **Zero-cookie mint** — public. Verifies `sha256(deviceSecret)` (constant-time) against the device's `secretHash`, mints a short access token for the active account, and rotates the secret in-use (returns `nextDeviceSecret`; the presented secret stays valid for a 60s grace). `401 invalid_device_secret` on a bad/diverged secret; `401 no_active_session` when the device is known but has no live session (no rotation). Per-device lockout + `rl:session:device-token:` rate limit. |
| GET | `/session/device/state` | — | Returns the device set for the caller's JWT device. `401` when the bearer carries no `deviceId` claim. |
| POST | `/session/device/add` | — | Registers the **caller's own bearer session** (account id from `req.user`, session id from the JWT) into the device set. Idempotent: re-registering the same account+session (the reload handoff) is a pure no-op — no active flip, no revision bump, no broadcast. A different sessionId for an existing account replaces the entry and deactivates the displaced session. `401` when the session record is expired/revoked. |
| POST | `/session/device/switch` | `{ accountId }` | Sets `activeAccountId` after re-validating the target session. `404` when the account is not on this device; `403` (plus a broadcast of the healed state) when the target session was revoked. |
| POST | `/session/device/signout` | `{ accountId }` or `{ all: true }` | Removes the account (or all). Cascades: removes operated accounts of the signed-out operator, deactivates each removed session, and — on `all` only — clears the device's `secretHash`. Elects the next remaining account as active (or `null`). |
| POST | `/session/device/hub-ticket` | `{ returnOrigin }` | **Bearer required.** Mints a one-time ticket (~60s TTL) so an official satellite app can redirect to `auth.oxy.so/sync` and plant the same `{ deviceId, deviceSecret }` on the IdP hub origin. `deviceId` comes from the JWT claim. Rate limit: `rl:session:hub-ticket:`. |
| POST | `/session/device/redeem-ticket` | `{ ticket, returnOrigin }` | **Public.** Single-use redeem → `{ deviceId, deviceSecret }` via `issueDeviceSecret`. Validates `returnOrigin` against the official allowlist. Rate limit: `rl:session:redeem-ticket:`. |

**Response shape (all routes):** `{ data: DeviceSessionSync }` — i.e. `{ data: { state, activeToken } }` validating `deviceSessionSyncSchema`. `activeToken` is minted per response after re-validating the active account's session; it is `null` rather than stale when the session cannot mint. Hub-ticket routes return `{ data: { ticket, expiresIn } }` or `{ data: { deviceId, deviceSecret } }` instead.

**Broadcast discipline:** every route broadcasts `session_state` to the device room after a *real* change (`changed === true`); idempotent no-ops stay silent so reload storms do not fan out.

Registration also happens server-side outside this router:

- `POST /accounts/:id/switch` (account graph, `packages/api/src/routes/accounts.ts`) registers the freshly-minted managed session into the operator's device set with `activate: 'always'` and broadcasts.
- Every first-party sign-in (`/auth/login`, `/auth/signup`, `/auth/verify`, `/security/2fa/verify-login`) registers itself into its device set with `activate: 'if-empty'` and mints the `deviceSecret` for the response (`finalizeDeviceLogin`, `packages/api/src/services/deviceLogin.service.ts`) — add-only, never steals the device's current active selection.

> **Do not confuse** these routes with the older fingerprint-based listing at `GET /session/device/sessions/:sessionId` / `POST /session/device/logout-all/:sessionId` (routes in `packages/api/src/routes/session.ts`, DTO `DeviceLinkedSession*` in contracts). Those enumerate `Session` documents that share a device fingerprint for the security screen; they are **not** the device set and do not carry `revision`/`activeAccountId`.

---

## Socket sync — room `device:<deviceId>`, event `session_state`

Every mutation broadcasts the projected state to the device's room:

```typescript
// packages/api/src/utils/socket.ts
server.to(`device:${state.deviceId}`).emit('session_state', state); // DeviceSessionState — token-free
```

- **Payload is `DeviceSessionState` only.** No access tokens ever cross the socket. A client that needs the active token follows up with `GET /session/device/state` (bearer-authed), which returns `activeToken` alongside the same state.
- **Rooms are server-resolved** (`socketRoomsFor` in `utils/socket.ts`): a socket must present a valid bearer access token and joins `user:<id>` + `device:<deviceId>` from its **JWT claims**. Client-supplied room ids are never trusted. Sockets are **bearer-only** — a signed-out client (no bearer) opens no socket, so there is no anonymous device socket.

---

## Client — `SessionClient` (`@oxyhq/core`)

`packages/core/src/session/` implements the client half. Apps normally never touch it — `OxyProvider` from `@oxyhq/services` wires it up (see the [integration guide](./integration-guide.md)); the surface below is for SDK/internal work.

```typescript
import { OxyServices, createSessionClient, type DeviceSessionState } from '@oxyhq/core';
import { io } from 'socket.io-client';

const oxy = new OxyServices({ baseURL: 'https://api.oxy.so' });

const { client, host } = createSessionClient(
  oxy,
  {
    // Platform-specific token mint for state.activeAccountId (best-effort).
    async ensureActiveToken(state: DeviceSessionState): Promise<void> {
      /* refresh-family mint (web) or shared-keychain sign-in (native) */
    },
  },
  io, // statically-injected socket.io-client factory
);

await client.start();                       // GET /state (if a bearer is held) + socket connect
const unsubscribe = client.subscribe((state) => { /* render account set */ });

await client.registerAndActivate(userId);   // after a deliberate sign-in: add + switch
await client.switchAccount(accountId);      // POST /switch
await client.signOut({ accountId });        // POST /signout (or { all: true })
```

Behavior worth knowing:

- **`applyState`** validates against `deviceSessionStateSchema` and applies last-writer-wins by revision (per device, with the cross-device reset described above). **`applySync`** additionally plants `activeToken` on the host when the response's active account still matches — token planting is decoupled from whether the revision advanced.
- **`registerAndActivate`** exists because `POST /add` alone honors the server's add semantics (a background add must not steal focus); after a deliberate sign-in the client adds *and then* switches to the authenticated account.
- **Sockets are bearer-only:** a signed-out client opens no socket (there is no anonymous device socket). Cross-app instant sync therefore applies between authenticated sessions on the same device; a signed-out surface picks up a sibling's sign-in on its next reload / cold boot.
- **`onUnauthenticated`** fires when an applied state has zero accounts (a device signout-all), so the provider clears its persisted auth store and a reload does not resurrect a dead session.

---

## Multi-account: device set vs account graph

Two distinct layers — do not conflate them:

| Layer | Question it answers | API |
|-------|--------------------|-----|
| **DeviceSession** (this doc) | Which accounts are signed in **on this device** right now, and which is active | `/session/device/*`, socket `session_state` |
| **Account graph** | Which accounts the user **can** use (own, org, project, bot, shared via membership) | `GET /accounts`, `POST /accounts/:id/switch` (`packages/api/src/services/account.service.ts`) |

The account switcher unions both: accounts already in the device set (instant switch via `POST /session/device/switch`) plus graph accounts available for `act_as` that are not yet signed in on the device.

**Switching into a graph account** (`POST /accounts/:id/switch`):

1. The operator's `account:act_as` role over the target is verified (`verifyActingAs`); personal accounts are never switch targets (that would be impersonation).
2. A **real session** is minted for the managed account with `operatedByUserId = operator` and — critically — the **operator's deviceId** inherited from their bearer, so the org session joins the same device document.
3. The session is registered into the device set server-side (`addAccount`, `activate: 'always'`) and broadcast, so the switch survives reload and syncs to every app on the device instantly. The response mirrors the login shape and the SDK plants the returned access token directly.
4. Session validity stays bound to the membership: revoking `act_as` kills the session, and the healing paths above drop it from the device set.

Signing a device out of an account **never** revokes graph membership — the device set and the graph are independent; the account simply disappears from this device.

The `GET /session/device/state` device subset is deliberately **not** the graph: the IdP chooser mirrors the device subset only, while RP clients union the graph from `GET /accounts` on top.
