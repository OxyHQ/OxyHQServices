import type { AuthTokenBundle } from '@oxyhq/contracts';
import {
  parseDeviceBootFragment,
  hashHasBootFragment,
  consumeDeviceBootReturn,
  type ConsumeDeviceBootReturnDeps,
} from '../deviceBootReturn';
import { createMemoryAuthStateStore } from '../../session/authStateStore';

const STATE = 'st-1234567890';
const CODE = 'c'.repeat(24);
const DEVICE_TOKEN = 'd'.repeat(24);

// A loose record (fed to `encodeHash(unknown)` and validated by the schema) so
// tests can build the session arm plus invalid variants (missing/extra `code`,
// `v: 2`) without fighting the discriminated-union type.
function fragmentObject(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { v: 1, state: STATE, reason: 'session', code: CODE, deviceToken: DEVICE_TOKEN, ...overrides };
}

function encodeHash(obj: unknown): string {
  const b64 = Buffer.from(JSON.stringify(obj), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `#oxy_boot=${b64}`;
}

const BUNDLE: AuthTokenBundle = {
  sessionId: 'sess-1',
  accessToken: 'access-jwt',
  refreshToken: 'refresh-abcdefghijklmnop',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: 'user-1', name: {} } as AuthTokenBundle['user'],
};

/** Build the injectable deps around a memory store, recording call order. */
function makeDeps(
  hash: string,
  overrides: Partial<ConsumeDeviceBootReturnDeps> & { expectedState?: string | null } = {},
): { deps: ConsumeDeviceBootReturnDeps; calls: string[]; store: ReturnType<typeof createMemoryAuthStateStore> } {
  const calls: string[] = [];
  const store = createMemoryAuthStateStore();
  const deps: ConsumeDeviceBootReturnDeps = {
    hash,
    stripFragment: () => calls.push('strip'),
    readExpectedState: () => (overrides.expectedState !== undefined ? overrides.expectedState : STATE),
    clearExpectedState: () => calls.push('clearState'),
    store,
    exchangeBootCode: overrides.exchangeBootCode
      ?? (async () => {
        calls.push('exchange');
        return BUNDLE;
      }),
    plantAccessToken: overrides.plantAccessToken ?? ((token) => calls.push(`plant:${token}`)),
  };
  return { deps, calls, store };
}

describe('parseDeviceBootFragment', () => {
  it('parses a valid base64url fragment', () => {
    expect(parseDeviceBootFragment(encodeHash(fragmentObject()))).toEqual(fragmentObject());
  });

  it('returns null when the parameter is absent', () => {
    expect(parseDeviceBootFragment('#something=else')).toBeNull();
    expect(parseDeviceBootFragment('')).toBeNull();
  });

  it('returns null for malformed base64 / non-JSON / wrong shape', () => {
    expect(parseDeviceBootFragment('#oxy_boot=!!!not-base64!!!')).toBeNull();
    expect(parseDeviceBootFragment(encodeHash({ nope: true }))).toBeNull();
    // v must be the literal 1
    expect(parseDeviceBootFragment(encodeHash(fragmentObject({ v: 2 })))).toBeNull();
  });

  it('returns null for a session fragment missing its code (discriminated union)', () => {
    expect(parseDeviceBootFragment(encodeHash(fragmentObject({ code: undefined })))).toBeNull();
  });
});

describe('hashHasBootFragment', () => {
  it('detects the fragment regardless of position', () => {
    expect(hashHasBootFragment('#oxy_boot=abc')).toBe(true);
    expect(hashHasBootFragment('#x=1&oxy_boot=abc')).toBe(true);
    expect(hashHasBootFragment('#other=1')).toBe(false);
    expect(hashHasBootFragment('')).toBe(false);
  });
});

describe('consumeDeviceBootReturn', () => {
  it('returns none and does not touch the URL when no fragment is present', async () => {
    const { deps, calls } = makeDeps('#unrelated=1');
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'none' });
    expect(calls).not.toContain('strip');
  });

  it('strips the fragment BEFORE exchanging the code', async () => {
    const { deps, calls } = makeDeps(encodeHash(fragmentObject()));
    const outcome = await consumeDeviceBootReturn(deps);
    expect(outcome.kind).toBe('session');
    expect(calls.indexOf('strip')).toBeLessThan(calls.indexOf('exchange'));
  });

  it('resolves a session, persists it, and plants the token', async () => {
    const { deps, store } = makeDeps(encodeHash(fragmentObject()));
    const outcome = await consumeDeviceBootReturn(deps);
    expect(outcome).toEqual({
      kind: 'session',
      session: { sessionId: 'sess-1', userId: 'user-1', accessToken: 'access-jwt' },
    });
    expect(await store.load()).toMatchObject({
      sessionId: 'sess-1',
      refreshToken: 'refresh-abcdefghijklmnop',
      userId: 'user-1',
      deviceToken: DEVICE_TOKEN,
    });
    expect(await store.loadDeviceToken()).toBe(DEVICE_TOKEN);
  });

  it('captures the bundle deviceSecret (phase 2c) and preserves a prior deviceId', async () => {
    const { deps, store } = makeDeps(encodeHash(fragmentObject()), {
      exchangeBootCode: async () => ({ ...BUNDLE, deviceSecret: 'ds-from-exchange' }),
    });
    // A prior deviceId-bearing login persisted a deviceId; the bundle carries no
    // deviceId, so the overwrite must preserve it to keep the mint lane usable.
    await store.save({ sessionId: 'prev', refreshToken: 'r-prevabcdefghij', userId: 'user-1', deviceId: 'dev-prev' });

    await consumeDeviceBootReturn(deps);

    const persisted = await store.load();
    expect(persisted?.deviceSecret).toBe('ds-from-exchange');
    expect(persisted?.deviceId).toBe('dev-prev');
  });

  it('preserves a prior deviceSecret when the bundle omits one (never orphans the mint lane)', async () => {
    const { deps, store } = makeDeps(encodeHash(fragmentObject()));
    await store.save({
      sessionId: 'prev',
      refreshToken: 'r-prevabcdefghij',
      userId: 'user-1',
      deviceId: 'dev-prev',
      deviceSecret: 'ds-still-valid',
    });

    await consumeDeviceBootReturn(deps);

    const persisted = await store.load();
    expect(persisted?.deviceSecret).toBe('ds-still-valid');
    expect(persisted?.deviceId).toBe('dev-prev');
  });

  it('rejects a state mismatch without persisting or exchanging', async () => {
    const { deps, calls, store } = makeDeps(encodeHash(fragmentObject()), { expectedState: 'WRONG' });
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'state-mismatch' });
    expect(calls).toContain('strip');
    expect(calls).not.toContain('exchange');
    expect(await store.loadDeviceToken()).toBeNull();
  });

  it('rejects when there is no expected state stashed at all', async () => {
    const { deps } = makeDeps(encodeHash(fragmentObject()), { expectedState: null });
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'state-mismatch' });
  });

  it('persists the deviceToken but returns no-session for a signed-out device', async () => {
    const { deps, store, calls } = makeDeps(
      encodeHash(fragmentObject({ reason: 'new_device', code: undefined })),
    );
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'no-session', reason: 'new_device' });
    expect(calls).not.toContain('exchange');
    expect(await store.loadDeviceToken()).toBe(DEVICE_TOKEN);
  });

  it('returns no-session when the code exchange fails (burned/expired code)', async () => {
    const { deps } = makeDeps(encodeHash(fragmentObject()), {
      exchangeBootCode: async () => {
        throw new Error('code already burned');
      },
    });
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'no-session', reason: 'no_session' });
  });

  it('strips even a malformed fragment and returns none', async () => {
    const { deps, calls } = makeDeps('#oxy_boot=!!!malformed!!!');
    expect(await consumeDeviceBootReturn(deps)).toEqual({ kind: 'none' });
    expect(calls).toContain('strip');
  });
});
