# Sesión centralizada — Fase 1: Contratos + Autoridad del servidor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la autoridad central del estado de sesión del dispositivo en el servidor (`@oxyhq/contracts` + `oxy-api`): modelo `DeviceSession`, servicio con `revision`, rutas REST `/session/device/{state,add,switch,signout}`, y broadcast por Socket.IO al room `device:<deviceId>`. Aditivo — no toca ningún cliente y no rompe las rutas `/auth/*` existentes todavía.

**Architecture:** Un `DeviceSession` por dispositivo físico agrega cuentas `[{accountId, sessionId, authuser, operatedByUserId?}]` + `activeAccountId` + `revision` monótono. Las mutaciones REST persisten + suben `revision` + difunden el `SessionState` (sin tokens) al room del dispositivo. Reutiliza `session.service` (createSession/deactivate), `refreshToken.service` (revocación), `requireSameSiteOrigin`, y el singleton `getIO()`.

**Tech Stack:** TypeScript, Express, Mongoose (globalmente mockeado en tests), Socket.IO, Zod (`@oxyhq/contracts`), Jest + ts-jest (sin supertest, sin mongodb-memory-server).

## Global Constraints

- Package manager: **bun** (`bun run test`, nunca `bun test` en `packages/api` → ~81 falsos fallos). Test runner de la API = **jest** vía `bunx jest <file>`.
- **Sin `as any`, sin `@ts-ignore`, sin `!` non-null, sin `console.log`, sin `catch {}` vacío, sin `var`.** `const` por defecto. Tipos explícitos.
- **Corte limpio**: no back-compat, no shims, no `@deprecated`. (En esta fase NO se borra aún `/auth/*` — se hace en Fase 3+ cuando los clientes migren; Fase 1 es aditiva.)
- Rate-limit: cada `rateLimit(...)` requiere un `prefix` único `rl:<scope>:`.
- Sockets: el room se deriva SIEMPRE de la identidad del token/servidor, nunca de input del cliente (anti-IDOR).
- Contratos nuevos van en `@oxyhq/contracts` (Zod), validados con `safeParseContract`. `@oxyhq/contracts` se **publica primero** antes que la API lo consuma en prod (en dev/CI se resuelve de `src` vía `moduleNameMapper`).
- Igualdad de secretos con `verifySecret`, nunca `===`.
- Baseline de tests de la API: **997** (no debe bajar; esta fase añade tests).

---

## Estructura de ficheros (Fase 1)

| Fichero | Responsabilidad |
|---|---|
| `packages/contracts/src/deviceSession.ts` (crear) | `sessionAccountSchema`, `deviceSessionStateSchema`, tipos `SessionAccount`/`DeviceSessionState`. |
| `packages/contracts/src/index.ts` (modificar) | Exportar los nuevos schemas + tipos. |
| `packages/contracts/src/__tests__/deviceSession.test.ts` (crear) | Tests de parse/reject del contrato. |
| `packages/api/src/models/DeviceSession.ts` (crear) | Modelo mongoose `DeviceSession` (colección `devicesessions`). |
| `packages/api/src/services/deviceSession.service.ts` (crear) | `getState`/`addAccount`/`switchActive`/`signout` + `revision`; proyección a `DeviceSessionState`. |
| `packages/api/src/services/__tests__/deviceSession.service.test.ts` (crear) | Tests del servicio (modelo mockeado). |
| `packages/api/src/utils/socket.ts` (modificar) | `broadcastDeviceState(deviceId, state)` helper de emit. |
| `packages/api/src/utils/__tests__/deviceStateBroadcast.test.ts` (crear) | Test del helper de emit. |
| `packages/api/src/routes/sessionDevice.ts` (crear) | Router REST `/session/device/{state,add,switch,signout}`. |
| `packages/api/src/routes/__tests__/sessionDevice.test.ts` (crear) | Tests de rutas + emit (patrón `http.request`). |
| `packages/api/src/server.ts` (modificar) | Join del room `device:<deviceId>`; montar `sessionDeviceRouter`. |

---

### Task 1: Contrato `DeviceSessionState` en `@oxyhq/contracts`

**Files:**
- Create: `packages/contracts/src/deviceSession.ts`
- Modify: `packages/contracts/src/index.ts:13-37` (bloques de export)
- Test: `packages/contracts/src/__tests__/deviceSession.test.ts`

**Interfaces:**
- Produces: `sessionAccountSchema`, `deviceSessionStateSchema` (Zod), tipos `SessionAccount`, `DeviceSessionState`. Firma de tipos:
  - `SessionAccount = { accountId: string; sessionId: string; authuser: number; operatedByUserId?: string }`
  - `DeviceSessionState = { deviceId: string; accounts: SessionAccount[]; activeAccountId: string | null; revision: number; updatedAt: number }`

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/contracts/src/__tests__/deviceSession.test.ts
import { deviceSessionStateSchema, sessionAccountSchema, safeParseContract } from '../index';

describe('deviceSessionStateSchema', () => {
  const account = { accountId: 'a1', sessionId: 's1', authuser: 0 };
  const state = { deviceId: 'd1', accounts: [account], activeAccountId: 'a1', revision: 3, updatedAt: 1720000000000 };

  it('parses a valid state', () => {
    expect(safeParseContract(deviceSessionStateSchema, state)).toEqual(state);
  });

  it('accepts an optional operatedByUserId on an account', () => {
    const withOp = { ...account, operatedByUserId: 'op1' };
    expect(safeParseContract(sessionAccountSchema, withOp)).toEqual(withOp);
  });

  it('accepts activeAccountId=null (device signed out of all)', () => {
    const parsed = safeParseContract(deviceSessionStateSchema, { ...state, accounts: [], activeAccountId: null });
    expect(parsed?.activeAccountId).toBeNull();
  });

  it('rejects a negative authuser', () => {
    expect(safeParseContract(sessionAccountSchema, { ...account, authuser: -1 })).toBeNull();
  });

  it('rejects a state missing revision', () => {
    const { revision, ...noRev } = state;
    expect(safeParseContract(deviceSessionStateSchema, noRev)).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar el test → falla**

Run: `cd packages/contracts && bunx jest src/__tests__/deviceSession.test.ts`
Expected: FAIL — `Cannot find module '../index'`-derived exports `deviceSessionStateSchema`/`sessionAccountSchema` are undefined.

- [ ] **Step 3: Crear el contrato**

```ts
// packages/contracts/src/deviceSession.ts
import { z } from 'zod';

export const sessionAccountSchema = z.object({
  accountId: z.string(),
  sessionId: z.string(),
  authuser: z.number().int().nonnegative(),
  operatedByUserId: z.string().optional(),
});

export const deviceSessionStateSchema = z.object({
  deviceId: z.string(),
  accounts: z.array(sessionAccountSchema),
  activeAccountId: z.string().nullable(),
  revision: z.number().int().nonnegative(),
  updatedAt: z.number(),
});

export type SessionAccount = z.infer<typeof sessionAccountSchema>;
export type DeviceSessionState = z.infer<typeof deviceSessionStateSchema>;
```

- [ ] **Step 4: Exportar desde `index.ts`**

En `packages/contracts/src/index.ts`, en el bloque de value-exports añade (junto a los otros `export { ... } from './...'`):

```ts
export { sessionAccountSchema, deviceSessionStateSchema } from './deviceSession';
```

y en el bloque `export type { ... }`:

```ts
export type { SessionAccount, DeviceSessionState } from './deviceSession';
```

(Imports extensionless, como el resto del fichero — el post-proceso ESM añade `.js`.)

- [ ] **Step 5: Ejecutar el test → pasa**

Run: `cd packages/contracts && bunx jest src/__tests__/deviceSession.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verificar build de contracts**

Run: `cd packages/contracts && bun run build`
Expected: build OK (cjs+esm+types), sin errores tsc.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/deviceSession.ts packages/contracts/src/index.ts packages/contracts/src/__tests__/deviceSession.test.ts
git commit -m "feat(contracts): add DeviceSessionState + SessionAccount schemas"
```

---

### Task 2: Modelo `DeviceSession` (mongoose)

**Files:**
- Create: `packages/api/src/models/DeviceSession.ts`
- Test: `packages/api/src/models/__tests__/deviceSession.model.test.ts`

**Interfaces:**
- Produces: `IDeviceSession` interface + default-export model `DeviceSession` (colección `devicesessions`). Campos: `deviceId: string` (unique), `accounts: [{ accountId: ObjectId, sessionId: string, authuser: number, addedAt: Date, operatedByUserId?: ObjectId }]`, `activeAccountId: ObjectId | null`, `revision: number`, `timestamps:true`.

- [ ] **Step 1: Escribir el test que falla**

El mock global de mongoose no permite instanciar el schema real; se opta por mongoose real (patrón `accountsSwitch.test.ts:27`). El test valida forma y defaults del schema.

```ts
// packages/api/src/models/__tests__/deviceSession.model.test.ts
jest.mock('mongoose', () => jest.requireActual('mongoose'));
import mongoose from 'mongoose';
import DeviceSession from '../DeviceSession';

describe('DeviceSession model', () => {
  it('registers on the "devicesessions" collection', () => {
    expect(DeviceSession.collection.name).toBe('devicesessions');
  });

  it('defaults revision to 0 and activeAccountId to null', () => {
    const doc = new DeviceSession({ deviceId: 'd1' });
    expect(doc.revision).toBe(0);
    expect(doc.activeAccountId).toBeNull();
    expect(doc.accounts).toHaveLength(0);
  });

  it('requires deviceId', () => {
    const doc = new DeviceSession({});
    const err = doc.validateSync();
    expect(err?.errors?.deviceId).toBeDefined();
  });

  it('stores an account subdocument with authuser + sessionId', () => {
    const accountId = new mongoose.Types.ObjectId();
    const doc = new DeviceSession({ deviceId: 'd1', accounts: [{ accountId, sessionId: 's1', authuser: 0 }] });
    expect(doc.accounts[0].sessionId).toBe('s1');
    expect(doc.accounts[0].authuser).toBe(0);
    expect(doc.accounts[0].addedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Ejecutar → falla**

Run: `cd packages/api && bunx jest src/models/__tests__/deviceSession.model.test.ts`
Expected: FAIL — `Cannot find module '../DeviceSession'`.

- [ ] **Step 3: Crear el modelo**

```ts
// packages/api/src/models/DeviceSession.ts
import mongoose, { Document, Schema } from 'mongoose';

export interface IDeviceSessionAccount {
  accountId: mongoose.Types.ObjectId;
  sessionId: string;
  authuser: number;
  addedAt: Date;
  operatedByUserId?: mongoose.Types.ObjectId | null;
}

export interface IDeviceSession extends Document {
  deviceId: string;
  accounts: IDeviceSessionAccount[];
  activeAccountId: mongoose.Types.ObjectId | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IDeviceSessionAccount>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    authuser: { type: Number, required: true, min: 0 },
    addedAt: { type: Date, default: Date.now },
    operatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const DeviceSessionSchema = new Schema<IDeviceSession>(
  {
    deviceId: { type: String, required: true },
    accounts: { type: [AccountSchema], default: [] },
    activeAccountId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DeviceSessionSchema.index({ deviceId: 1 }, { unique: true });

export default mongoose.model<IDeviceSession>('DeviceSession', DeviceSessionSchema);
```

- [ ] **Step 4: Ejecutar → pasa**

Run: `cd packages/api && bunx jest src/models/__tests__/deviceSession.model.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/models/DeviceSession.ts packages/api/src/models/__tests__/deviceSession.model.test.ts
git commit -m "feat(api): add DeviceSession model (device account set + revision)"
```

---

### Task 3: `deviceSession.service.ts` (autoridad + revision)

**Files:**
- Create: `packages/api/src/services/deviceSession.service.ts`
- Test: `packages/api/src/services/__tests__/deviceSession.service.test.ts`

**Interfaces:**
- Consumes: `DeviceSession` model (Task 2); `sessionService.deactivateSession` (existente); `DeviceSessionState` (Task 1).
- Produces (default-export singleton `deviceSessionService`):
  - `getState(deviceId: string): Promise<DeviceSessionState>` — crea el doc si no existe; proyecta a `DeviceSessionState` (siempre devuelve un estado, `accounts:[]` si vacío).
  - `addAccount(deviceId: string, input: { accountId: string; sessionId: string; operatedByUserId?: string }): Promise<DeviceSessionState>` — upsert de la cuenta (reemplaza si ya existe misma `accountId`), asigna `authuser` = menor índice libre, pone `activeAccountId = accountId`, `revision++`.
  - `switchActive(deviceId: string, accountId: string): Promise<DeviceSessionState | null>` — si la cuenta existe, `activeAccountId = accountId`, `revision++`; `null` si no existe.
  - `signout(deviceId: string, target: { accountId: string } | { all: true }): Promise<DeviceSessionState>` — quita la(s) cuenta(s), revoca su `Session` (`sessionService.deactivateSession(sessionId)`), recalcula `activeAccountId` (primera restante o `null`), `revision++`.
  - `projectState(doc: IDeviceSession): DeviceSessionState` (helper puro exportado para tests/rutas).

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/api/src/services/__tests__/deviceSession.service.test.ts
const mockFindOne = jest.fn();
const mockFindOneAndUpdate = jest.fn();
const mockDeactivate = jest.fn();

jest.mock('../../models/DeviceSession', () => ({
  __esModule: true,
  default: {
    findOne: (...a: unknown[]) => mockFindOne(...a),
    findOneAndUpdate: (...a: unknown[]) => mockFindOneAndUpdate(...a),
  },
}));
jest.mock('../session.service', () => ({
  __esModule: true,
  default: { deactivateSession: (...a: unknown[]) => mockDeactivate(...a) },
}));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import deviceSessionService, { projectState } from '../deviceSession.service';

const lean = (v: unknown) => ({ lean: () => Promise.resolve(v) });

beforeEach(() => jest.clearAllMocks());

describe('projectState', () => {
  it('maps a doc to DeviceSessionState with string ids', () => {
    const doc = {
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 2,
      updatedAt: new Date(1720000000000),
    };
    expect(projectState(doc as never)).toEqual({
      deviceId: 'd1',
      accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }],
      activeAccountId: 'a1',
      revision: 2,
      updatedAt: 1720000000000,
    });
  });
});

describe('addAccount', () => {
  it('adds a new account at authuser 0, sets it active, bumps revision', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0, operatedByUserId: null }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
      updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.addAccount('d1', { accountId: 'a1', sessionId: 's1' });
    expect(state.activeAccountId).toBe('a1');
    expect(state.accounts[0].authuser).toBe(0);
    expect(state.revision).toBe(1);
  });
});

describe('signout', () => {
  it('revokes the account session and drops it from the set', async () => {
    mockFindOne.mockReturnValueOnce(lean({
      deviceId: 'd1',
      accounts: [{ accountId: { toString: () => 'a1' }, sessionId: 's1', authuser: 0 }],
      activeAccountId: { toString: () => 'a1' },
      revision: 1,
    }));
    mockDeactivate.mockResolvedValueOnce(true);
    mockFindOneAndUpdate.mockReturnValueOnce(lean({
      deviceId: 'd1', accounts: [], activeAccountId: null, revision: 2, updatedAt: new Date(1720000000000),
    }));
    const state = await deviceSessionService.signout('d1', { accountId: 'a1' });
    expect(mockDeactivate).toHaveBeenCalledWith('s1');
    expect(state.accounts).toHaveLength(0);
    expect(state.activeAccountId).toBeNull();
    expect(state.revision).toBe(2);
  });
});

describe('switchActive', () => {
  it('returns null when the account is not on the device', async () => {
    mockFindOne.mockReturnValueOnce(lean({ deviceId: 'd1', accounts: [], activeAccountId: null, revision: 0 }));
    expect(await deviceSessionService.switchActive('d1', 'ghost')).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar → falla**

Run: `cd packages/api && bunx jest src/services/__tests__/deviceSession.service.test.ts`
Expected: FAIL — `Cannot find module '../deviceSession.service'`.

- [ ] **Step 3: Implementar el servicio**

```ts
// packages/api/src/services/deviceSession.service.ts
import type { DeviceSessionState, SessionAccount } from '@oxyhq/contracts';
import DeviceSession, { IDeviceSession, IDeviceSessionAccount } from '../models/DeviceSession';
import sessionService from './session.service';
import { logger } from '../utils/logger';

function idToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toString' in (value as object)) return (value as { toString(): string }).toString();
  return String(value);
}

export function projectState(doc: IDeviceSession): DeviceSessionState {
  const accounts: SessionAccount[] = (doc.accounts ?? []).map((a: IDeviceSessionAccount) => {
    const operatedBy = idToString(a.operatedByUserId ?? null);
    const account: SessionAccount = { accountId: idToString(a.accountId) ?? '', sessionId: a.sessionId, authuser: a.authuser };
    if (operatedBy) account.operatedByUserId = operatedBy;
    return account;
  });
  return {
    deviceId: doc.deviceId,
    accounts,
    activeAccountId: idToString(doc.activeAccountId),
    revision: doc.revision ?? 0,
    updatedAt: (doc.updatedAt ?? new Date()).getTime(),
  };
}

function lowestFreeAuthuser(accounts: IDeviceSessionAccount[]): number {
  const used = new Set(accounts.map((a) => a.authuser));
  let i = 0;
  while (used.has(i)) i += 1;
  return i;
}

class DeviceSessionService {
  private async load(deviceId: string): Promise<IDeviceSession | null> {
    return DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
  }

  async getState(deviceId: string): Promise<DeviceSessionState> {
    const existing = await this.load(deviceId);
    if (existing) return projectState(existing);
    const created = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $setOnInsert: { deviceId, accounts: [], activeAccountId: null, revision: 0 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(created as IDeviceSession);
  }

  async addAccount(
    deviceId: string,
    input: { accountId: string; sessionId: string; operatedByUserId?: string },
  ): Promise<DeviceSessionState> {
    const current = (await this.load(deviceId)) ?? { deviceId, accounts: [], activeAccountId: null, revision: 0 } as IDeviceSession;
    const others = (current.accounts ?? []).filter((a) => idToString(a.accountId) !== input.accountId);
    const authuser = lowestFreeAuthuser(others);
    const account = {
      accountId: input.accountId,
      sessionId: input.sessionId,
      authuser,
      addedAt: new Date(),
      operatedByUserId: input.operatedByUserId ?? null,
    };
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      {
        $set: { accounts: [...others, account], activeAccountId: input.accountId },
        $inc: { revision: 1 },
      },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(updated as IDeviceSession);
  }

  async switchActive(deviceId: string, accountId: string): Promise<DeviceSessionState | null> {
    const current = await this.load(deviceId);
    if (!current || !(current.accounts ?? []).some((a) => idToString(a.accountId) === accountId)) return null;
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { activeAccountId: accountId }, $inc: { revision: 1 } },
      { new: true },
    ).lean<IDeviceSession>();
    return projectState(updated as IDeviceSession);
  }

  async signout(deviceId: string, target: { accountId: string } | { all: true }): Promise<DeviceSessionState> {
    const current = await this.load(deviceId);
    if (!current) return this.getState(deviceId);
    const removing = 'all' in target ? current.accounts ?? [] : (current.accounts ?? []).filter((a) => idToString(a.accountId) === target.accountId);
    for (const a of removing) {
      try {
        await sessionService.deactivateSession(a.sessionId);
      } catch (error) {
        logger.warn('deviceSession.signout: deactivate failed', { sessionId: a.sessionId, error });
      }
    }
    const remaining = 'all' in target ? [] : (current.accounts ?? []).filter((a) => idToString(a.accountId) !== target.accountId);
    const activeStillPresent = remaining.some((a) => idToString(a.accountId) === idToString(current.activeAccountId));
    const nextActive = activeStillPresent ? idToString(current.activeAccountId) : (remaining[0] ? idToString(remaining[0].accountId) : null);
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { accounts: remaining, activeAccountId: nextActive }, $inc: { revision: 1 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(updated as IDeviceSession);
  }
}

const deviceSessionService = new DeviceSessionService();
export default deviceSessionService;
```

- [ ] **Step 4: Ejecutar → pasa**

Run: `cd packages/api && bunx jest src/services/__tests__/deviceSession.service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/deviceSession.service.ts packages/api/src/services/__tests__/deviceSession.service.test.ts
git commit -m "feat(api): deviceSession.service — device account authority with revision"
```

---

### Task 4: `broadcastDeviceState` (emit helper)

**Files:**
- Modify: `packages/api/src/utils/socket.ts:1-16`
- Test: `packages/api/src/utils/__tests__/deviceStateBroadcast.test.ts`

**Interfaces:**
- Consumes: `getIO()` (existente en `utils/socket.ts`), `DeviceSessionState` (Task 1).
- Produces: `export function broadcastDeviceState(state: DeviceSessionState): void` — emite el evento `session_state` (con el `state`) al room `device:<state.deviceId>`. No-op seguro si `getIO()` es null.

- [ ] **Step 1: Escribir el test que falla**

`broadcastDeviceState` vive en `utils/socket.ts` junto a `getIO`/`initializeIO`. Como llama a `getIO()` del mismo módulo (no se puede auto-mockear una función del propio módulo), el test inyecta un io falso vía `initializeIO(...)` y lo limpia con `closeIO()`:

```ts
// packages/api/src/utils/__tests__/deviceStateBroadcast.test.ts
jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
import { initializeIO, closeIO, broadcastDeviceState } from '../socket';
import type { DeviceSessionState } from '@oxyhq/contracts';

const state: DeviceSessionState = { deviceId: 'd1', accounts: [], activeAccountId: null, revision: 5, updatedAt: 1720000000000 };

afterEach(() => closeIO());

describe('broadcastDeviceState', () => {
  it('emits session_state to the device room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    initializeIO({ to } as never);
    broadcastDeviceState(state);
    expect(to).toHaveBeenCalledWith('device:d1');
    expect(emit).toHaveBeenCalledWith('session_state', state);
  });

  it('is a no-op when io is not initialised', () => {
    closeIO();
    expect(() => broadcastDeviceState(state)).not.toThrow();
  });
});
```

- [ ] **Step 2: Ejecutar → falla**

Run: `cd packages/api && bunx jest src/utils/__tests__/deviceStateBroadcast.test.ts`
Expected: FAIL — `broadcastDeviceState` no existe.

- [ ] **Step 3: Añadir el helper a `utils/socket.ts`**

Al final de `packages/api/src/utils/socket.ts` (que ya tiene `io`, `initializeIO`, `getIO`, `closeIO`):

```ts
import type { DeviceSessionState } from '@oxyhq/contracts';
import { logger } from './logger';

export function broadcastDeviceState(state: DeviceSessionState): void {
  const server = getIO();
  if (!server) {
    logger.debug('broadcastDeviceState: io not initialised', { deviceId: state.deviceId });
    return;
  }
  server.to(`device:${state.deviceId}`).emit('session_state', state);
}
```

- [ ] **Step 4: Ejecutar → pasa**

Run: `cd packages/api && bunx jest src/utils/__tests__/deviceStateBroadcast.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/utils/socket.ts packages/api/src/utils/__tests__/deviceStateBroadcast.test.ts
git commit -m "feat(api): broadcastDeviceState — emit session_state to device room"
```

---

### Task 5: Rutas REST `/session/device/{state,add,switch,signout}`

**Files:**
- Create: `packages/api/src/routes/sessionDevice.ts`
- Modify: `packages/api/src/server.ts` (montar el router)
- Test: `packages/api/src/routes/__tests__/sessionDevice.test.ts`

**Interfaces:**
- Consumes: `deviceSessionService` (Task 3), `broadcastDeviceState` (Task 4), `authMiddleware` (existente, pone `req.user`), `requireSameSiteOrigin`.
- `deviceId` de esta fase: se deriva de la **sesión del bearer del llamante** (su `req` → sesión → `deviceId`). Se lee vía un helper `resolveCallerDeviceId(req)` que decodifica el bearer (`decodeToken`) → `deviceId` claim. (La unificación del `deviceId` cross-domain por el IdP es Task 6 / fase posterior; aquí basta el `deviceId` de la sesión.)
- Rutas (todas `authMiddleware` + `requireSameSiteOrigin`):
  - `GET /session/device/state` → `200 { data: DeviceSessionState }`.
  - `POST /session/device/add { accountId, sessionId, operatedByUserId? }` → persist + broadcast → `200 { data: DeviceSessionState }`.
  - `POST /session/device/switch { accountId }` → `200 { data }` o `404 { error }` si la cuenta no está.
  - `POST /session/device/signout { accountId? , all? }` → persist + broadcast → `200 { data }`.

- [ ] **Step 1: Escribir el test que falla** (patrón `http.request`, mocks a nivel de módulo)

```ts
// packages/api/src/routes/__tests__/sessionDevice.test.ts
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

const mockAuthMiddleware = jest.fn();
const mockGetState = jest.fn();
const mockAddAccount = jest.fn();
const mockSwitchActive = jest.fn();
const mockSignout = jest.fn();
const mockBroadcast = jest.fn();
const mockDecodeToken = jest.fn();

jest.mock('../../middleware/auth', () => ({
  authMiddleware: (...a: unknown[]) => mockAuthMiddleware(...a),
}));
jest.mock('../../middleware/originGuard', () => ({
  requireSameSiteOrigin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({ rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next() }));
jest.mock('../../middleware/authUtils', () => ({
  decodeToken: (...a: unknown[]) => mockDecodeToken(...a),
  extractTokenFromRequest: () => 'tkn',
}));
jest.mock('../../services/deviceSession.service', () => ({
  __esModule: true,
  default: {
    getState: (...a: unknown[]) => mockGetState(...a),
    addAccount: (...a: unknown[]) => mockAddAccount(...a),
    switchActive: (...a: unknown[]) => mockSwitchActive(...a),
    signout: (...a: unknown[]) => mockSignout(...a),
  },
}));
jest.mock('../../utils/socket', () => ({ broadcastDeviceState: (...a: unknown[]) => mockBroadcast(...a) }));
jest.mock('../../utils/logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

import sessionDeviceRouter from '../sessionDevice';
import { errorHandler } from '../../middleware/errorHandler';

const STATE = { deviceId: 'd1', accounts: [{ accountId: 'a1', sessionId: 's1', authuser: 0 }], activeAccountId: 'a1', revision: 1, updatedAt: 1720000000000 };

async function requestJson(server: http.Server, method: string, path: string, payload?: unknown) {
  const address = server.address() as AddressInfo;
  const body = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = http.request({ method, host: '127.0.0.1', port: address.port, path,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), Authorization: 'Bearer t' } },
      (res) => { let raw = ''; res.on('data', c => { raw += c; }); res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: raw.length ? JSON.parse(raw) : {} }); }); });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
}

let server: http.Server;
beforeAll((done) => {
  mockAuthMiddleware.mockImplementation((req: { user?: unknown }, _res: unknown, next: () => void) => {
    (req as { user?: unknown }).user = { _id: { toString: () => '64b0000000000000000000aa' }, id: '64b0000000000000000000aa' };
    next();
  });
  mockDecodeToken.mockReturnValue({ sessionId: 's1', deviceId: 'd1' });
  const app = express();
  app.use(express.json());
  app.use('/session/device', sessionDeviceRouter);
  app.use(errorHandler);
  server = app.listen(0, '127.0.0.1', done);
});
afterAll((done) => server.close(done));
beforeEach(() => jest.clearAllMocks());

describe('GET /session/device/state', () => {
  it('returns the device state', async () => {
    mockGetState.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'GET', '/session/device/state');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(STATE);
    expect(mockGetState).toHaveBeenCalledWith('d1');
  });
});

describe('POST /session/device/switch', () => {
  it('switches active account and broadcasts', async () => {
    mockSwitchActive.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSwitchActive).toHaveBeenCalledWith('d1', 'a1');
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
  });

  it('404 when the account is not on the device', async () => {
    mockSwitchActive.mockResolvedValueOnce(null);
    const res = await requestJson(server, 'POST', '/session/device/switch', { accountId: 'ghost' });
    expect(res.status).toBe(404);
    expect(mockBroadcast).not.toHaveBeenCalled();
  });
});

describe('POST /session/device/signout', () => {
  it('signs out one account and broadcasts', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { accountId: 'a1' });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { accountId: 'a1' });
    expect(mockBroadcast).toHaveBeenCalledWith(after);
  });

  it('signs out all when { all: true }', async () => {
    const after = { ...STATE, accounts: [], activeAccountId: null, revision: 2 };
    mockSignout.mockResolvedValueOnce(after);
    const res = await requestJson(server, 'POST', '/session/device/signout', { all: true });
    expect(res.status).toBe(200);
    expect(mockSignout).toHaveBeenCalledWith('d1', { all: true });
  });
});

describe('POST /session/device/add', () => {
  it('adds an account and broadcasts', async () => {
    mockAddAccount.mockResolvedValueOnce(STATE);
    const res = await requestJson(server, 'POST', '/session/device/add', { accountId: 'a1', sessionId: 's1' });
    expect(res.status).toBe(200);
    expect(mockAddAccount).toHaveBeenCalledWith('d1', { accountId: 'a1', sessionId: 's1', operatedByUserId: undefined });
    expect(mockBroadcast).toHaveBeenCalledWith(STATE);
  });
});
```

- [ ] **Step 2: Ejecutar → falla**

Run: `cd packages/api && bunx jest src/routes/__tests__/sessionDevice.test.ts`
Expected: FAIL — `Cannot find module '../sessionDevice'`.

- [ ] **Step 3: Implementar el router**

```ts
// packages/api/src/routes/sessionDevice.ts
import { Router, Response } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { requireSameSiteOrigin } from '../middleware/originGuard';
import { decodeToken, extractTokenFromRequest } from '../middleware/authUtils';
import deviceSessionService from '../services/deviceSession.service';
import { broadcastDeviceState } from '../utils/socket';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

function resolveCallerDeviceId(req: AuthRequest): string | null {
  const token = extractTokenFromRequest(req);
  const decoded = token ? decodeToken(token) : null;
  return decoded?.deviceId ?? null;
}

router.use(requireSameSiteOrigin, authMiddleware);

router.get('/state', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  res.json({ data: await deviceSessionService.getState(deviceId) });
}));

router.post('/add', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId, sessionId, operatedByUserId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId || !sessionId) { res.status(400).json({ error: 'accountId and sessionId required' }); return; }
  const state = await deviceSessionService.addAccount(deviceId, { accountId, sessionId, operatedByUserId });
  broadcastDeviceState(state);
  res.json({ data: state });
}));

router.post('/switch', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  const { accountId } = req.body ?? {};
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }
  const state = await deviceSessionService.switchActive(deviceId, accountId);
  if (!state) { res.status(404).json({ error: 'Account not on this device' }); return; }
  broadcastDeviceState(state);
  res.json({ data: state });
}));

router.post('/signout', asyncHandler(async (req: AuthRequest, res: Response) => {
  const deviceId = resolveCallerDeviceId(req);
  if (!deviceId) { res.status(401).json({ error: 'No device' }); return; }
  const { accountId, all } = req.body ?? {};
  const target = all === true ? { all: true as const } : accountId ? { accountId } : null;
  if (!target) { res.status(400).json({ error: 'accountId or all required' }); return; }
  const state = await deviceSessionService.signout(deviceId, target);
  broadcastDeviceState(state);
  res.json({ data: state });
}));

export default router;
```

> Nota: confirmar el path exacto de `asyncHandler` (grep `export.*asyncHandler` en `packages/api/src/middleware`). Si no existe como módulo propio, envolver los handlers en try/catch que llamen `next(error)` (el proyecto ya usa `asyncHandler` en `routes/auth.ts`, así que existe — usar ese import).

- [ ] **Step 4: Ejecutar → pasa**

Run: `cd packages/api && bunx jest src/routes/__tests__/sessionDevice.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Montar el router en `server.ts`**

En `packages/api/src/server.ts`, junto a `import sessionRouter from './routes/session'` (línea ~8):

```ts
import sessionDeviceRouter from './routes/sessionDevice';
```

y junto a `app.use('/session', userRateLimiter, csrfProtection, sessionRouter);` (línea ~515), ANTES de esa línea (para que `/session/device/*` no lo capture el genérico), montar:

```ts
app.use('/session/device', userRateLimiter, sessionDeviceRouter);
```

(El router ya aplica `requireSameSiteOrigin`+`authMiddleware`; no lleva `csrfProtection` porque son escrituras con bearer, no cookie ambiental — coherente con el spec §9.)

- [ ] **Step 6: Verificar que la suite completa de la API sigue verde**

Run: `cd packages/api && bun run test`
Expected: PASS — baseline 997 + los nuevos (≈ 997 + 16). Sin regresiones.

- [ ] **Step 7: Commit**

```bash
git add packages/api/src/routes/sessionDevice.ts packages/api/src/routes/__tests__/sessionDevice.test.ts packages/api/src/server.ts
git commit -m "feat(api): /session/device/{state,add,switch,signout} routes + broadcast"
```

---

### Task 6: Join del room `device:<deviceId>` en el socket

**Files:**
- Modify: `packages/api/src/server.ts:263-282` (`io.on('connection')`)
- Test: `packages/api/src/utils/__tests__/deviceRoom.test.ts` (test de una función extraída `joinDeviceRoom`)

**Interfaces:**
- Consumes: el `socket` autenticado (`socket.user.id` ya lo pone el auth middleware del socket; el `deviceId` viene del token en `socket.handshake.auth`).
- Produces: helper puro `export function deviceRoomFor(decoded: { deviceId?: string }): string | null` en `utils/socket.ts` (o junto al connection handler) que devuelve `device:<deviceId>` o null. El connection handler hace `socket.join(room)` además del `user:<id>` existente.

> **Diseño testeable:** el `io.on('connection')` de `server.ts` no está bajo test (ningún test importa `../server`). Para poder testear, se extrae la derivación del room a una función pura en `utils/socket.ts` y el handler la usa. El test cubre la función; el `socket.join` se verifica en integración manual (§verificación).

- [ ] **Step 1: Escribir el test que falla**

```ts
// packages/api/src/utils/__tests__/deviceRoom.test.ts
import { deviceRoomFor } from '../socket';

describe('deviceRoomFor', () => {
  it('returns device:<deviceId> when present', () => {
    expect(deviceRoomFor({ deviceId: 'd1' })).toBe('device:d1');
  });
  it('returns null when deviceId is absent', () => {
    expect(deviceRoomFor({})).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar → falla**

Run: `cd packages/api && bunx jest src/utils/__tests__/deviceRoom.test.ts`
Expected: FAIL — `deviceRoomFor` no existe.

- [ ] **Step 3: Añadir `deviceRoomFor` a `utils/socket.ts`**

```ts
export function deviceRoomFor(decoded: { deviceId?: string | null }): string | null {
  return decoded?.deviceId ? `device:${decoded.deviceId}` : null;
}
```

- [ ] **Step 4: Usarlo en `server.ts` connection handler**

En `io.on('connection', (socket: AuthenticatedSocket) => { ... })` (líneas 263-282), tras el `socket.join('user:'+id)` existente, añadir (el token decodificado ya está disponible en `socket.user` gracias al middleware de auth del socket, que hace `socket.user = { id, ...decoded }`):

```ts
const deviceRoom = deviceRoomFor(socket.user ?? {});
if (deviceRoom) socket.join(deviceRoom);
```

y añadir el import: `import { deviceRoomFor } from './utils/socket';` (junto a `initializeIO`).

- [ ] **Step 5: Ejecutar → pasa** + suite API verde

Run: `cd packages/api && bunx jest src/utils/__tests__/deviceRoom.test.ts && bun run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/utils/socket.ts packages/api/src/utils/__tests__/deviceRoom.test.ts packages/api/src/server.ts
git commit -m "feat(api): join device:<deviceId> socket room on connection"
```

---

## Verificación de integración (manual, tras Fase 1)

Fase 1 es servidor puro y no la consume ningún cliente todavía, así que se verifica con `curl`/un cliente socket de prueba (no requiere navegador):

1. Con un bearer válido, `POST /session/device/add {accountId, sessionId}` → `200 {data}` con `revision:1`, `activeAccountId=accountId`.
2. `GET /session/device/state` → devuelve la misma cuenta.
3. Conectar un cliente Socket.IO con `auth.token=<bearer>` → debe unirse a `device:<deviceId>`; un segundo `POST /session/device/switch` → el cliente recibe `session_state` con `revision:2`.
4. `POST /session/device/signout {all:true}` → `accounts:[]`, `activeAccountId:null`, `revision:3`, y las `Session` revocadas (`isActive:false`).

(La verificación en navegador real cross-domain llega en la fase de cliente — Fase 3+ — donde el `SessionClient` consume esto.)

---

## Fuera de alcance de la Fase 1 (fases siguientes)

- **Unificación del `deviceId` central por el IdP** (propagación FedCM/`/sso/establish` para que apps de dominios distintos compartan `deviceId`): Fase 1b / servidor-IdP. En Fase 1 el `deviceId` es el de la sesión del bearer (suficiente para same-app/same-device pruebas).
- **Borrado de `/auth/refresh`, `/auth/refresh-all`, `/auth/session`, `/auth/logout` + esquema `oxy_rt`**: se hace cuando los clientes migren (Fase 3+), para no romper prod. Fase 1 es aditiva.
- **`SessionClient` + `TokenTransport`** (`@oxyhq/core`): Fase 2.
- **Refactor de `services`/`auth-sdk`/`accounts`**: Fases 3-5.
