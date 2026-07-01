# Sesión centralizada — Fase 2: `SessionClient` + `TokenTransport` en `@oxyhq/core` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Un `SessionClient` framework-agnóstico en `@oxyhq/core` que es el cliente de la autoridad central de Fase 1: mantiene el `DeviceSessionState`, se suscribe al canal Socket.IO central (`session_state`), muta vía REST `/session/device/*`, valida todo con `safeParseContract`, y delega el minteo del token de la cuenta activa a un `TokenTransport` inyectable. Sin React (core lo prohíbe). Unit-testeable con fetch-stub + fake socket.

**Architecture:** `SessionClient` orquesta estado + socket + REST; `TokenTransport` (interfaz inyectada) obtiene el token per-dominio de la cuenta activa (impls concretas web/native en Fases 3/4). `SessionState` es la única autoridad; el socket empuja, el cliente aplica con last-writer-wins por `revision`.

**Tech Stack:** TypeScript (dual CJS+ESM, NO `require()` en fuente ESM — usar `await import`), `socket.io-client` (ya es dep dura de core `^4.8.1`), Zod contracts, Jest + ts-jest.

## Global Constraints

- **bun** (`bunx jest <file>` en `packages/core`; nunca `bun test`). Core test runner = jest.
- Sin `as any`, `@ts-ignore`, `!` non-null, `console.log` (usar `logger`/`createDebugLogger` de core), `catch {}` vacío, `var`. Tipos explícitos.
- **ESM/CJS**: `packages/core` NO puede tener `require()` en fuente. Cargar `socket.io-client` con `await import('socket.io-client')` (patrón `getSocketIO`), nunca `import io from 'socket.io-client'` estático (mantiene el bundle ESM limpio y no fuerza socket.io en todos los consumidores).
- Core **no importa react / react-native / expo**. `SessionClient` es una clase plana; la integración con React vive en los consumidores (Fase 3/4).
- Contratos desde `@oxyhq/contracts` (`deviceSessionStateSchema`, `safeParseContract`, `DeviceSessionState`). Core resuelve `@oxyhq/contracts` por su **dist construido** (NO hay moduleNameMapper a src en core jest) → si el test importa el símbolo nuevo, **construir contracts primero**: `bun run --filter @oxyhq/contracts build` (ya está construido en este worktree con `deviceSessionStateSchema` desde Fase 1).
- Validar TODO estado entrante (REST y socket) con `safeParseContract(deviceSessionStateSchema, raw)`; descartar (log warn) si no valida — NUNCA aplicar estado no validado (previene el bug de deriva a logged-out).
- Rooms/identidad las decide el servidor; el cliente solo manda su token en el handshake (`auth: cb => cb({ token })`), token fresco por (re)conexión.
- Core baseline de tests: **724** (57 suites). No bajar.

---

## Estructura de ficheros (Fase 2)

| Fichero | Responsabilidad |
|---|---|
| `packages/core/src/session/SessionClient.ts` (crear) | La clase `SessionClient` + `TokenTransport`/`SessionClientOptions` interfaces. Estado + REST + socket + subscribe. |
| `packages/core/src/session/socketLoader.ts` (crear) | `getSocketIO()` lazy loader + tipos `MinimalSocket`/`SocketIOFactory` (portados de auth-sdk, framework-agnósticos). |
| `packages/core/src/session/__tests__/SessionClient.state.test.ts` (crear) | Estado: applyState + revision-gate + subscribe. |
| `packages/core/src/session/__tests__/SessionClient.rest.test.ts` (crear) | REST: bootstrap/switchAccount/signOut/addCurrentAccount (makeRequest spy) + validación. |
| `packages/core/src/session/__tests__/SessionClient.socket.test.ts` (crear) | Socket: connect + session_state apply + token-change reconnect + stop. |
| `packages/core/src/index.ts` (modificar) | Exportar `SessionClient`, `TokenTransport`, tipos. |

---

### Task 1: `socketLoader.ts` (lazy `socket.io-client`) + `SessionClient` estado/subscribe

**Files:**
- Create: `packages/core/src/session/socketLoader.ts`
- Create: `packages/core/src/session/SessionClient.ts`
- Test: `packages/core/src/session/__tests__/SessionClient.state.test.ts`

**Interfaces:**
- Produces `socketLoader.ts`:
  - `interface MinimalSocket { connected: boolean; on(event: string, handler: (...args: unknown[]) => void): void; off(event: string, handler?: (...args: unknown[]) => void): void; connect(): void; disconnect(): void; }`
  - `type SocketIOFactory = (uri: string, opts?: Record<string, unknown>) => MinimalSocket;`
  - `function getSocketIO(): Promise<SocketIOFactory | null>` — lazy dynamic import singleton.
- Produces `SessionClient.ts`:
  - `interface TokenTransport { ensureActiveToken(state: DeviceSessionState): Promise<void>; }`
  - `interface SessionClientHost { makeRequest<T>(method: 'GET' | 'POST', url: string, data?: unknown, options?: { cache?: boolean }): Promise<T>; getBaseURL(): string; getAccessToken(): string | null; onTokensChanged(listener: (token: string | null) => void): () => void; }`
  - `interface SessionClientOptions { transport?: TokenTransport; }`
  - `class SessionClient` with (this task): `constructor(host: SessionClientHost, options?: SessionClientOptions)`, `getState(): DeviceSessionState | null`, `subscribe(listener: (state: DeviceSessionState | null) => void): () => void`, and a `protected applyState(raw: unknown): boolean` (validates via `safeParseContract`, applies only if `revision` strictly greater than current, notifies subscribers, fires `transport.ensureActiveToken` best-effort; returns whether applied).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/session/__tests__/SessionClient.state.test.ts
import type { DeviceSessionState } from '@oxyhq/contracts';
import { SessionClient, type SessionClientHost, type TokenTransport } from '../SessionClient';

function makeHost(): SessionClientHost {
  return {
    makeRequest: jest.fn(),
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => 't',
    onTokensChanged: () => () => undefined,
  };
}
const STATE = (rev: number, active: string | null = 'a1'): DeviceSessionState => ({
  deviceId: 'd1', accounts: active ? [{ accountId: 'a1', sessionId: 's1', authuser: 0 }] : [], activeAccountId: active, revision: rev, updatedAt: 1720000000000,
});

// SessionClient.applyState is protected; a tiny subclass exposes it for the unit test.
class TestClient extends SessionClient { public apply(raw: unknown): boolean { return this.applyState(raw); } }

describe('SessionClient state', () => {
  it('starts with null state', () => {
    expect(new SessionClient(makeHost()).getState()).toBeNull();
  });

  it('applies a valid state and notifies subscribers', () => {
    const c = new TestClient(makeHost());
    const seen: (DeviceSessionState | null)[] = [];
    c.subscribe((s) => seen.push(s));
    expect(c.apply(STATE(1))).toBe(true);
    expect(c.getState()?.revision).toBe(1);
    expect(seen.at(-1)?.revision).toBe(1);
  });

  it('ignores a stale or equal revision (last-writer-wins)', () => {
    const c = new TestClient(makeHost());
    c.apply(STATE(5));
    expect(c.apply(STATE(5))).toBe(false);
    expect(c.apply(STATE(4))).toBe(false);
    expect(c.getState()?.revision).toBe(5);
  });

  it('rejects an invalid (unvalidated) state without applying', () => {
    const c = new TestClient(makeHost());
    expect(c.apply({ deviceId: 'd1', accounts: 'nope', revision: 1 })).toBe(false);
    expect(c.getState()).toBeNull();
  });

  it('calls transport.ensureActiveToken when a state is applied', () => {
    const transport: TokenTransport = { ensureActiveToken: jest.fn().mockResolvedValue(undefined) };
    const c = new TestClient(makeHost(), { transport });
    c.apply(STATE(1));
    expect(transport.ensureActiveToken).toHaveBeenCalledWith(expect.objectContaining({ revision: 1 }));
  });

  it('unsubscribe stops notifications', () => {
    const c = new TestClient(makeHost());
    const seen: unknown[] = [];
    const off = c.subscribe((s) => seen.push(s));
    off();
    c.apply(STATE(1));
    expect(seen).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run → fails**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.state.test.ts`
Expected: FAIL — `Cannot find module '../SessionClient'`.

- [ ] **Step 3: Implement `socketLoader.ts`**

```ts
// packages/core/src/session/socketLoader.ts
import { logger } from '../utils/logger';

export interface MinimalSocket {
  connected: boolean;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler?: (...args: unknown[]) => void): void;
  connect(): void;
  disconnect(): void;
}

export type SocketIOFactory = (uri: string, opts?: Record<string, unknown>) => MinimalSocket;

let cachedFactory: SocketIOFactory | null = null;
let loadAttempted = false;

export async function getSocketIO(): Promise<SocketIOFactory | null> {
  if (cachedFactory) return cachedFactory;
  if (loadAttempted) return null;
  loadAttempted = true;
  try {
    const mod = (await import('socket.io-client')) as { io?: SocketIOFactory; default?: SocketIOFactory };
    cachedFactory = mod.io ?? mod.default ?? null;
    return cachedFactory;
  } catch (error) {
    logger.warn('[SessionClient] socket.io-client import failed; realtime session sync disabled', error);
    return null;
  }
}
```

> Verify the logger import path: core's shared logger is at `packages/core/src/utils/logger.ts` exporting `{ logger }` (used across core). Confirm and match; if it's a default export, adjust.

- [ ] **Step 4: Implement `SessionClient.ts` (state half)**

```ts
// packages/core/src/session/SessionClient.ts
import { deviceSessionStateSchema, safeParseContract, type DeviceSessionState } from '@oxyhq/contracts';
import { logger } from '../utils/logger';
import type { MinimalSocket } from './socketLoader';

export interface TokenTransport {
  /** Ensure this app holds a per-domain access token for state.activeAccountId (mint via FedCM/silent/sso/keychain). Best-effort. */
  ensureActiveToken(state: DeviceSessionState): Promise<void>;
}

export interface SessionClientHost {
  makeRequest<T>(method: 'GET' | 'POST', url: string, data?: unknown, options?: { cache?: boolean }): Promise<T>;
  getBaseURL(): string;
  getAccessToken(): string | null;
  onTokensChanged(listener: (token: string | null) => void): () => void;
}

export interface SessionClientOptions {
  transport?: TokenTransport;
}

type StateListener = (state: DeviceSessionState | null) => void;

export class SessionClient {
  private state: DeviceSessionState | null = null;
  private readonly listeners = new Set<StateListener>();
  protected socket: MinimalSocket | null = null;
  private tokenUnsub: (() => void) | null = null;
  private started = false;

  constructor(
    protected readonly host: SessionClientHost,
    protected readonly options: SessionClientOptions = {},
  ) {}

  getState(): DeviceSessionState | null {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch (error) {
        logger.error('[SessionClient] subscriber threw', error);
      }
    }
  }

  /** Validate + last-writer-wins by revision. Returns true if applied. */
  protected applyState(raw: unknown): boolean {
    const next = safeParseContract(deviceSessionStateSchema, raw);
    if (!next) {
      logger.warn('[SessionClient] discarded invalid session state');
      return false;
    }
    if (this.state && next.revision <= this.state.revision) {
      return false;
    }
    this.state = next;
    this.notify();
    if (this.options.transport) {
      void this.options.transport.ensureActiveToken(next).catch((error) => {
        logger.warn('[SessionClient] ensureActiveToken failed', error);
      });
    }
    return true;
  }
}
```

- [ ] **Step 5: Run → passes**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.state.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session/socketLoader.ts packages/core/src/session/SessionClient.ts packages/core/src/session/__tests__/SessionClient.state.test.ts
git commit -m "feat(core): SessionClient state core + socket.io lazy loader"
```

---

### Task 2: REST bootstrap + mutations

**Files:**
- Modify: `packages/core/src/session/SessionClient.ts`
- Test: `packages/core/src/session/__tests__/SessionClient.rest.test.ts`

**Interfaces:**
- Consumes: `SessionClient` (Task 1), `host.makeRequest`.
- Produces (added to `SessionClient`): `bootstrap(): Promise<void>` (`GET /session/device/state`), `switchAccount(accountId: string): Promise<void>` (`POST /session/device/switch`), `signOut(target: { accountId: string } | { all: true }): Promise<void>` (`POST /session/device/signout`), `addCurrentAccount(): Promise<void>` (`POST /session/device/add`). Each pipes the response through `applyState`. All calls use `{ cache: false }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/session/__tests__/SessionClient.rest.test.ts
import type { DeviceSessionState } from '@oxyhq/contracts';
import { SessionClient, type SessionClientHost } from '../SessionClient';

const STATE = (rev: number): DeviceSessionState => ({
  deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: rev, updatedAt: 1720000000000,
});

function makeHost(makeRequest: jest.Mock): SessionClientHost {
  return { makeRequest, getBaseURL: () => 'http://test.invalid', getAccessToken: () => 't', onTokensChanged: () => () => undefined };
}

describe('SessionClient REST', () => {
  it('bootstrap GETs /session/device/state and applies it', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(3));
    const c = new SessionClient(makeHost(makeRequest));
    await c.bootstrap();
    expect(makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    expect(c.getState()?.revision).toBe(3);
  });

  it('switchAccount POSTs and applies the returned state', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(4));
    const c = new SessionClient(makeHost(makeRequest));
    await c.switchAccount('a1');
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/switch', { accountId: 'a1' }, { cache: false });
    expect(c.getState()?.revision).toBe(4);
  });

  it('signOut one account POSTs { accountId }', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(5));
    const c = new SessionClient(makeHost(makeRequest));
    await c.signOut({ accountId: 'a1' });
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/signout', { accountId: 'a1' }, { cache: false });
  });

  it('signOut all POSTs { all: true }', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(6));
    const c = new SessionClient(makeHost(makeRequest));
    await c.signOut({ all: true });
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/signout', { all: true }, { cache: false });
  });

  it('addCurrentAccount POSTs /session/device/add with no body', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce(STATE(2));
    const c = new SessionClient(makeHost(makeRequest));
    await c.addCurrentAccount();
    expect(makeRequest).toHaveBeenCalledWith('POST', '/session/device/add', undefined, { cache: false });
  });

  it('does not throw / does not apply when the server returns invalid state', async () => {
    const makeRequest = jest.fn().mockResolvedValueOnce({ bogus: true });
    const c = new SessionClient(makeHost(makeRequest));
    await c.bootstrap();
    expect(c.getState()).toBeNull();
  });
});
```

- [ ] **Step 2: Run → fails**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.rest.test.ts`
Expected: FAIL — `c.bootstrap is not a function`.

- [ ] **Step 3: Add the REST methods to `SessionClient`**

Add inside the `SessionClient` class:

```ts
  async bootstrap(): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('GET', '/session/device/state', undefined, { cache: false });
    this.applyState(raw);
  }

  async switchAccount(accountId: string): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/switch', { accountId }, { cache: false });
    this.applyState(raw);
  }

  async signOut(target: { accountId: string } | { all: true }): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/signout', target, { cache: false });
    this.applyState(raw);
  }

  async addCurrentAccount(): Promise<void> {
    const raw = await this.host.makeRequest<unknown>('POST', '/session/device/add', undefined, { cache: false });
    this.applyState(raw);
  }
```

- [ ] **Step 4: Run → passes**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.rest.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/SessionClient.ts packages/core/src/session/__tests__/SessionClient.rest.test.ts
git commit -m "feat(core): SessionClient REST bootstrap + switch/signout/add mutations"
```

---

### Task 3: Socket lifecycle (connect, session_state, reconnect, stop)

**Files:**
- Modify: `packages/core/src/session/SessionClient.ts`
- Test: `packages/core/src/session/__tests__/SessionClient.socket.test.ts`

**Interfaces:**
- Consumes: `getSocketIO` (Task 1), `host.getBaseURL/getAccessToken/onTokensChanged`, `applyState` (Task 1).
- Produces (added to `SessionClient`): `start(): Promise<void>` (bootstrap + connectSocket + subscribe to token changes), `stop(): void` (disconnect socket + unsubscribe token listener), private `connectSocket(): Promise<void>`. The socket connects to `host.getBaseURL()` with `{ transports: ['websocket'], autoConnect: !!token, auth: cb => cb({ token: host.getAccessToken() ?? '' }) }`, listens `session_state` → `applyState`, and reconnects when a token arrives after being disconnected.
- The socket factory is obtained via `getSocketIO()`; if null (import failed), the client works REST-only (no throw).

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/session/__tests__/SessionClient.socket.test.ts
import type { DeviceSessionState } from '@oxyhq/contracts';

type Handler = (...args: unknown[]) => void;
class FakeSocket {
  connected = false;
  handlers = new Map<string, Handler[]>();
  on(event: string, cb: Handler) { const l = this.handlers.get(event) ?? []; l.push(cb); this.handlers.set(event, l); }
  off(event: string, cb?: Handler) { if (!cb) { this.handlers.delete(event); return; } this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== cb)); }
  connect() { this.connected = true; this.trigger('connect'); }
  disconnect() { this.connected = false; }
  trigger(event: string, ...args: unknown[]) { for (const h of this.handlers.get(event) ?? []) h(...args); }
}
let fakeSocket: FakeSocket;
const ioMock = jest.fn((_uri: string, opts?: Record<string, unknown>) => {
  // honor autoConnect like real socket.io (connect immediately unless autoConnect:false)
  if (!opts || opts.autoConnect !== false) fakeSocket.connected = true;
  return fakeSocket;
});
jest.mock('socket.io-client', () => ({ __esModule: true, io: (...args: unknown[]) => ioMock(...(args as [string, Record<string, unknown>?])) }));

import { SessionClient, type SessionClientHost } from '../SessionClient';

const STATE = (rev: number): DeviceSessionState => ({ deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: rev, updatedAt: 1720000000000 });

function makeHost(over: Partial<SessionClientHost> = {}): SessionClientHost {
  return {
    makeRequest: jest.fn().mockResolvedValue(STATE(1)),
    getBaseURL: () => 'http://test.invalid',
    getAccessToken: () => 'tok',
    onTokensChanged: () => () => undefined,
    ...over,
  };
}

beforeEach(() => { fakeSocket = new FakeSocket(); ioMock.mockClear(); });

describe('SessionClient socket', () => {
  it('start() bootstraps then opens ONE socket to the base URL with a token-in-handshake auth callback', async () => {
    const host = makeHost();
    const c = new SessionClient(host);
    await c.start();
    expect(host.makeRequest).toHaveBeenCalledWith('GET', '/session/device/state', undefined, { cache: false });
    expect(ioMock).toHaveBeenCalledTimes(1);
    const [uri, opts] = ioMock.mock.calls[0];
    expect(uri).toBe('http://test.invalid');
    const authCb = jest.fn();
    (opts?.auth as (cb: (d: { token: string }) => void) => void)(authCb);
    expect(authCb).toHaveBeenCalledWith({ token: 'tok' });
    c.stop();
  });

  it('applies a pushed session_state event', async () => {
    const c = new SessionClient(makeHost());
    await c.start();
    fakeSocket.trigger('session_state', STATE(9));
    expect(c.getState()?.revision).toBe(9);
    c.stop();
  });

  it('does not connect the socket when there is no token (autoConnect false)', async () => {
    const c = new SessionClient(makeHost({ getAccessToken: () => null }));
    await c.start();
    const [, opts] = ioMock.mock.calls[0];
    expect(opts?.autoConnect).toBe(false);
    c.stop();
  });

  it('reconnects when a token arrives after being disconnected', async () => {
    let tokenListener: ((t: string | null) => void) | null = null;
    const host = makeHost({ getAccessToken: () => null, onTokensChanged: (l) => { tokenListener = l; return () => undefined; } });
    const c = new SessionClient(host);
    await c.start();
    fakeSocket.connected = false;
    tokenListener?.('fresh-token');
    expect(fakeSocket.connected).toBe(true);
    c.stop();
  });

  it('stop() disconnects the socket', async () => {
    const c = new SessionClient(makeHost());
    await c.start();
    c.stop();
    expect(fakeSocket.connected).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fails**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.socket.test.ts`
Expected: FAIL — `c.start is not a function`.

- [ ] **Step 3: Add `start`/`stop`/`connectSocket` to `SessionClient`**

Add the import at the top: `import { getSocketIO } from './socketLoader';` and add these methods to the class:

```ts
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.tokenUnsub = this.host.onTokensChanged((token) => {
      if (token && this.socket && !this.socket.connected) {
        this.socket.connect();
      }
    });
    await this.bootstrap();
    await this.connectSocket();
  }

  stop(): void {
    this.started = false;
    if (this.tokenUnsub) {
      this.tokenUnsub();
      this.tokenUnsub = null;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  private async connectSocket(): Promise<void> {
    const io = await getSocketIO();
    if (!io) {
      logger.warn('[SessionClient] no socket.io-client; running REST-only (no realtime sync)');
      return;
    }
    if (!this.started) return; // stopped while the dynamic import was in flight
    const hasToken = Boolean(this.host.getAccessToken());
    const socket = io(this.host.getBaseURL(), {
      transports: ['websocket'],
      autoConnect: hasToken,
      auth: (cb: (data: { token: string }) => void) => {
        cb({ token: this.host.getAccessToken() ?? '' });
      },
    });
    socket.on('session_state', (payload: unknown) => {
      this.applyState(payload);
    });
    this.socket = socket;
  }
```

> Note: `applyState` is already defined (Task 1). `logger` already imported (Task 1). `MinimalSocket`/`getSocketIO` come from `./socketLoader`.

- [ ] **Step 4: Run → passes**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest src/session/__tests__/SessionClient.socket.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/SessionClient.ts packages/core/src/session/__tests__/SessionClient.socket.test.ts
git commit -m "feat(core): SessionClient socket lifecycle — connect, session_state, reconnect, stop"
```

---

### Task 4: Export from `@oxyhq/core` + full-suite green

**Files:**
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: public exports `SessionClient`, `TokenTransport`, `SessionClientHost`, `SessionClientOptions` from the package root.

- [ ] **Step 1: Add exports to `index.ts`**

Read `packages/core/src/index.ts`, and in the appropriate value/type export area add:

```ts
export { SessionClient } from './session/SessionClient';
export type { TokenTransport, SessionClientHost, SessionClientOptions } from './session/SessionClient';
```

(Match the file's existing export style — if it uses grouped `export { ... } from './...'` blocks, add there; keep value vs `export type` consistent.)

- [ ] **Step 2: Type-check + build core**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx tsc --noEmit 2>&1 | grep -E 'session/SessionClient|session/socketLoader' || echo "no tsc errors in new files"`
Expected: "no tsc errors in new files".

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bun run build`
Expected: dual build succeeds (cjs+esm+types), no `require()` emitted in ESM for socket.io (it's a dynamic import). Spot-check: `grep -c "require(" dist/esm/session/socketLoader.js` → should be 0 (dynamic import stays `import(...)`).

- [ ] **Step 3: Full core suite green**

Run: `cd /home/nate/Oxy/OxyHQServices-p1/packages/core && bunx jest --silent 2>&1 | tail -4`
Expected: baseline 724 + 17 new = **741 tests**, all suites green (the benign "worker failed to exit" note may appear — not a failure).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export SessionClient + TokenTransport from @oxyhq/core"
```

---

## Verificación (Fase 2)

Unit-testeable en su totalidad (fetch-stub + fake socket). No hay integración con app todavía (eso es Fase 3/4, donde se inyecta el `TokenTransport` web/native concreto y se monta en `OxyContext`/`WebOxyProvider`). La verificación real cross-domain en navegador llega cuando la Fase 3/4 cablea el cliente.

## Fuera de alcance (Fase 3+)
- Impls concretas de `TokenTransport` (web: FedCM/silent/sso; native: keychain) — Fase 3/4.
- Montaje en `OxyContext` (services) y `WebOxyProvider` (auth-sdk); borrado del cold-boot enredado / `AuthManager` / `useSessionSocket` per-dominio.
- Borrado de `/auth/refresh*`, `/auth/session`, `oxy_rt` — Fase 5/6 (cuando ya nadie los use).
