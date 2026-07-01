# Sesión centralizada — Fase 3: Propagación del token de la cuenta activa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Resolver cómo cada app obtiene el token per-dominio de la **cuenta activa** (incluida una subcuenta) sin cookies `oxy_rt`: el servidor mintea y devuelve el access token de la cuenta activa en la respuesta REST de `/session/device/{state,switch,add}` (desde la sesión que ya está en el dispositivo). El `SessionClient` planta ese token. El socket sigue sin llevar tokens (empuja estado; la app hace `GET /state` para obtener el token de la nueva activa).

**Architecture:** Extiende Fase 1 (server) + Fase 2 (core), aditivo, sin tocar comportamiento vivo de apps (las rutas siguen sin consumirse por clientes). Modelo de confianza: cualquier token válido del dispositivo D puede obtener el token de una cuenta que YA está en D (mismo que las cookies `oxy_rt` retiradas). El socket NUNCA lleva tokens.

**Tech Stack:** TS, Express, Mongoose (mockeado en tests), Zod contracts, Jest.

## Global Constraints
- **bun** (`bunx jest`); nunca `bun test` en api/core. Sin `as any`/`@ts-ignore`/`!`/`console.log`/`catch{}` vacío/`var`. Tipos explícitos.
- Corte limpio, aditivo en esta fase (no borra `/auth/*`).
- Contratos nuevos en `@oxyhq/contracts` (Zod). El token de la respuesta se valida en cliente con `safeParseContract`.
- El **socket `session_state` NO lleva token** — solo estado. El token solo viaja en respuestas REST al llamante autenticado del MISMO dispositivo.
- api baseline 1264 tests, core 741 — no bajar.

## Estructura de ficheros
| Fichero | Responsabilidad |
|---|---|
| `packages/contracts/src/deviceSession.ts` (modificar) | `activeTokenSchema` + `deviceSessionSyncSchema` ({state, activeToken}) + tipos. |
| `packages/contracts/src/index.ts` (modificar) | Exportar los nuevos. |
| `packages/contracts/src/__tests__/deviceSession.test.ts` (modificar) | Tests del sync schema. |
| `packages/api/src/services/deviceSession.service.ts` (modificar) | `resolveActiveToken(state)` → mintea el token de la cuenta activa vía `sessionService.getAccessToken(activeSessionId)`. |
| `packages/api/src/routes/sessionDevice.ts` (modificar) | Respuestas `{ data: { state, activeToken } }` en state/switch/add (signout puede omitir token si no hay activa). |
| `packages/api/src/routes/__tests__/sessionDevice.test.ts` (modificar) | Actualizar aserciones al nuevo envelope. |
| `packages/core/src/session/SessionClient.ts` (modificar) | REST parsea `{state, activeToken}` + `host.setTokens(activeToken.accessToken)`; socket-push que cambia la activa → `GET /state` para obtener+plantar token. |
| `packages/core/src/session/__tests__/SessionClient.rest.test.ts` (modificar) | Aserción del planting del token. |

---

### Task 1: Contrato `deviceSessionSyncSchema` ({ state, activeToken })

**Files:** Modify `packages/contracts/src/deviceSession.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/__tests__/deviceSession.test.ts`.

**Interfaces:** Produces `activeTokenSchema` (`{ accessToken: string; expiresAt: string }`), `deviceSessionSyncSchema` (`{ state: DeviceSessionState; activeToken: ActiveToken | null }`), types `ActiveToken`, `DeviceSessionSync`.

- [ ] **Step 1: Add tests to `deviceSession.test.ts`** (append inside the file, after existing tests, importing the new symbols at top):

```ts
// add imports at top of packages/contracts/src/__tests__/deviceSession.test.ts:
import { deviceSessionSyncSchema } from '../index';

describe('deviceSessionSyncSchema', () => {
  const state = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };
  it('parses { state, activeToken }', () => {
    const v = { state, activeToken: { accessToken: 'jwt', expiresAt: '2026-07-07T00:00:00.000Z' } };
    expect(safeParseContract(deviceSessionSyncSchema, v)).toEqual(v);
  });
  it('accepts activeToken=null', () => {
    expect(safeParseContract(deviceSessionSyncSchema, { state, activeToken: null })?.activeToken).toBeNull();
  });
  it('rejects a state-less sync', () => {
    expect(safeParseContract(deviceSessionSyncSchema, { activeToken: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fails** — `cd packages/contracts && bunx jest src/__tests__/deviceSession.test.ts` → FAIL (`deviceSessionSyncSchema` undefined).

- [ ] **Step 3: Add to `deviceSession.ts`** (after `deviceSessionStateSchema`):

```ts
export const activeTokenSchema = z.object({
  accessToken: z.string(),
  expiresAt: z.string(),
});

export const deviceSessionSyncSchema = z.object({
  state: deviceSessionStateSchema,
  activeToken: activeTokenSchema.nullable(),
});

export type ActiveToken = z.infer<typeof activeTokenSchema>;
export type DeviceSessionSync = z.infer<typeof deviceSessionSyncSchema>;
```

- [ ] **Step 4: Export in `index.ts`** — add `activeTokenSchema, deviceSessionSyncSchema` to the value-export block for `./deviceSession` and `ActiveToken, DeviceSessionSync` to the `export type` block.

- [ ] **Step 5: Run → passes** — `cd packages/contracts && bunx jest src/__tests__/deviceSession.test.ts` (9 tests) and `bun run build` (must succeed — the api/core resolve contracts from dist).

- [ ] **Step 6: Commit**
```bash
git add packages/contracts/src/deviceSession.ts packages/contracts/src/index.ts packages/contracts/src/__tests__/deviceSession.test.ts
git commit -m "feat(contracts): deviceSessionSync schema (state + active account token)"
```

---

### Task 2: Server mints + returns the active account token

**Files:** Modify `packages/api/src/services/deviceSession.service.ts`, `packages/api/src/routes/sessionDevice.ts`, `packages/api/src/routes/__tests__/sessionDevice.test.ts`.

**Interfaces:**
- Consumes: `sessionService.getAccessToken(sessionId): Promise<{ accessToken: string; expiresAt: Date } | null>` (existing), the device `SessionState`.
- Produces on `deviceSessionService`: `async resolveActiveToken(state: DeviceSessionState): Promise<{ accessToken: string; expiresAt: string } | null>` — finds `state.activeAccountId`'s account in `state.accounts`, calls `sessionService.getAccessToken(account.sessionId)`, returns `{ accessToken, expiresAt: expiresAt.toISOString() }` or null (no active / no session / mint failed).
- Routes now respond `{ data: { state, activeToken } }` for `/state`, `/switch`, `/add`; `/signout` responds `{ data: { state, activeToken } }` too (activeToken null when no active remains).

- [ ] **Step 1: Update the route test** `packages/api/src/routes/__tests__/sessionDevice.test.ts`:
  - Add a mock for `sessionService.getAccessToken`: at top with the other mocks add `const mockGetAccessToken = jest.fn();` and mock `../../services/session.service` → `{ __esModule: true, default: { getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a) } }`.
  - In `beforeEach`, `mockGetAccessToken.mockResolvedValue({ accessToken: 'jwt-active', expiresAt: new Date('2026-07-07T00:00:00.000Z') })`.
  - Change the `GET /state` assertion from `expect(res.body.data).toEqual(STATE)` to:
    ```ts
    expect(res.body.data.state).toEqual(STATE);
    expect(res.body.data.activeToken).toEqual({ accessToken: 'jwt-active', expiresAt: '2026-07-07T00:00:00.000Z' });
    ```
  - In the `switch` success test, keep `mockSwitchActive` returning STATE and additionally assert `res.body.data.state` + `res.body.data.activeToken.accessToken === 'jwt-active'`.

  > NOTE: the service is mocked in this route test (deviceSessionService methods are jest.fn), so `resolveActiveToken` is ALSO a mocked method here — add it to the `../../services/deviceSession.service` mock: `resolveActiveToken: (...a) => mockResolveActiveToken(...a)` with `const mockResolveActiveToken = jest.fn().mockResolvedValue({ accessToken: 'jwt-active', expiresAt: '2026-07-07T00:00:00.000Z' })` in beforeEach. (The route calls `deviceSessionService.resolveActiveToken(state)`, not sessionService directly — so mock resolveActiveToken, not getAccessToken, in the ROUTE test. The getAccessToken mock belongs in the SERVICE test, Step 3.)

- [ ] **Step 2: Update the routes** in `packages/api/src/routes/sessionDevice.ts` — after each mutation/read that produces `state`, compute the token and wrap:
```ts
// helper at top of the file
async function withActiveToken(state: DeviceSessionState) {
  const activeToken = await deviceSessionService.resolveActiveToken(state);
  return { state, activeToken };
}
```
  - `/state`: `res.json({ data: await withActiveToken(await deviceSessionService.getState(deviceId)) });`
  - `/add`, `/switch`, `/signout`: after computing `state` and `broadcastDeviceState(state)`, respond `res.json({ data: await withActiveToken(state) });`. (Broadcast stays state-only; the token only goes in the REST response.)
  - Import the `DeviceSessionState` type from `@oxyhq/contracts`.

- [ ] **Step 3: Add `resolveActiveToken` to the SERVICE** `packages/api/src/services/deviceSession.service.ts` + a service test.

Add to the service class:
```ts
async resolveActiveToken(state: DeviceSessionState): Promise<{ accessToken: string; expiresAt: string } | null> {
  if (!state.activeAccountId) return null;
  const account = state.accounts.find((a) => a.accountId === state.activeAccountId);
  if (!account) return null;
  const token = await sessionService.getAccessToken(account.sessionId);
  if (!token) return null;
  return { accessToken: token.accessToken, expiresAt: token.expiresAt.toISOString() };
}
```
Add to `packages/api/src/services/__tests__/deviceSession.service.test.ts` (the file already mocks `../session.service`; extend that mock with `getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a)` and add `const mockGetAccessToken = jest.fn();`):
```ts
describe('resolveActiveToken', () => {
  const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };
  it('mints the active account token', async () => {
    mockGetAccessToken.mockResolvedValueOnce({ accessToken: 'jwt', expiresAt: new Date('2026-07-07T00:00:00.000Z') });
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toEqual({ accessToken: 'jwt', expiresAt: '2026-07-07T00:00:00.000Z' });
    expect(mockGetAccessToken).toHaveBeenCalledWith('s1');
  });
  it('returns null when there is no active account', async () => {
    expect(await deviceSessionService.resolveActiveToken({ ...STATE, activeAccountId: null } as never)).toBeNull();
  });
  it('returns null when the session cannot mint a token', async () => {
    mockGetAccessToken.mockResolvedValueOnce(null);
    expect(await deviceSessionService.resolveActiveToken(STATE as never)).toBeNull();
  });
});
```

- [ ] **Step 4: Verify** — `cd packages/api && bunx jest src/routes/__tests__/sessionDevice.test.ts src/services/__tests__/deviceSession.service.test.ts` → PASS. Then full suite `bun run test` → green (1264 + new).

- [ ] **Step 5: Commit**
```bash
git add packages/api/src/services/deviceSession.service.ts packages/api/src/routes/sessionDevice.ts packages/api/src/routes/__tests__/sessionDevice.test.ts packages/api/src/services/__tests__/deviceSession.service.test.ts
git commit -m "feat(api): device routes return active-account token (state-only broadcast unchanged)"
```

---

### Task 3: `SessionClient` plants the active token + fetches on socket push

**Files:** Modify `packages/core/src/session/SessionClient.ts`, `packages/core/src/session/__tests__/SessionClient.rest.test.ts`, `packages/core/src/session/__tests__/SessionClient.socket.test.ts`.

**Interfaces:**
- Consumes: `deviceSessionSyncSchema`/`safeParseContract`, `host.setTokens` — ADD `setTokens(accessToken: string): void` to `SessionClientHost`.
- REST methods now expect `{ state, activeToken }`: add `private applySync(raw: unknown): void` that `safeParseContract(deviceSessionSyncSchema, raw)`, applies `state` (via existing `applyState`) and if `activeToken` present calls `host.setTokens(activeToken.accessToken)`. `bootstrap`/`switchAccount`/`signOut`/`addCurrentAccount` call `applySync` instead of `applyState`.
- Socket `session_state` (state only): on receipt, `applyState(payload)`; if it applied AND `state.activeAccountId` differs from the token the app currently holds, call `bootstrap()` (GET /state) to fetch+plant the new active token. (Guard against loops: bootstrap only when active changed.)

- [ ] **Step 1: Update `SessionClientHost`** — add `setTokens(accessToken: string): void;`. Update the two test host factories (`makeHost`) to include `setTokens: jest.fn()`.

- [ ] **Step 2: REST test** `SessionClient.rest.test.ts` — change the mocked `makeRequest` responses from bare `STATE(n)` to `{ state: STATE(n), activeToken: { accessToken: 'jwt-'+n, expiresAt: 'x' } }`, and in `bootstrap`/`switch` tests assert `host.setTokens` was called with the token, and `c.getState()?.revision` still tracks `state.revision`. Add a test: `activeToken: null` → `setTokens` NOT called, state still applied.

- [ ] **Step 3: Implement `applySync`** and reroute the REST methods:
```ts
import { deviceSessionSyncSchema, deviceSessionStateSchema, safeParseContract, type DeviceSessionState } from '@oxyhq/contracts';

  private applySync(raw: unknown): void {
    const sync = safeParseContract(deviceSessionSyncSchema, raw);
    if (!sync) { logger.warn('[SessionClient] discarded invalid session sync'); return; }
    const applied = this.applyState(sync.state);
    if (applied && sync.activeToken) {
      this.host.setTokens(sync.activeToken.accessToken);
    }
  }
```
Change each REST method's last line from `this.applyState(raw)` to `this.applySync(raw)`.

- [ ] **Step 4: Socket → fetch active token on active-account change.** In `connectSocket`, change the `session_state` handler:
```ts
socket.on('session_state', (payload: unknown) => {
  const applied = this.applyState(payload);
  if (applied) {
    const active = this.state?.activeAccountId ?? null;
    if (active && active !== this.host.getCurrentAccountId()) {
      void this.bootstrap().catch((error) => logger.warn('[SessionClient] post-push token fetch failed', { component: 'SessionClient' }, error));
    }
  }
});
```
Add `getCurrentAccountId(): string | null;` to `SessionClientHost` (maps to `oxy.getCurrentUserId()`); update host factories in tests with `getCurrentAccountId: () => null` (default) or a controllable value.

  > Loop-safety: `bootstrap()` GETs `/state` which returns `{state (same revision), activeToken}`; `applyState` ignores the same revision (no re-apply, no re-notify), and `applySync` plants the token — but bootstrap here calls `applySync`, which plants the token and applies-or-ignores state; since revision is equal it won't re-trigger. No loop.

- [ ] **Step 5: Socket test** — add a case: after `fakeSocket.trigger('session_state', STATE(9))` where host.getCurrentAccountId() !== state.activeAccountId, assert `host.makeRequest` was called with `('GET','/session/device/state', ...)` (the token fetch). And a case where active === current → no extra fetch.

- [ ] **Step 6: Verify** — `cd packages/core && bunx jest src/session` → all green; `bunx tsc --noEmit 2>&1 | grep session || echo ok`; `bun run build`.

- [ ] **Step 7: Commit**
```bash
git add packages/core/src/session/SessionClient.ts packages/core/src/session/__tests__/SessionClient.rest.test.ts packages/core/src/session/__tests__/SessionClient.socket.test.ts
git commit -m "feat(core): SessionClient plants active-account token + fetches it on socket push"
```

---

## Fuera de alcance (fases siguientes, browser-gated)
- `WebTokenTransport`/`NativeTokenTransport` para el **bootstrap** del primer token (FedCM-silent / keychain) — el token de subcuentas ya lo da el server (esta fase). El transport solo cubre el arranque en frío sin token.
- Montaje en `OxyContext`/`WebOxyProvider`; borrado del cold-boot enredado; borrado de `oxy_rt`/`/auth/refresh*`.
- Verificación real cross-domain en navegador.
