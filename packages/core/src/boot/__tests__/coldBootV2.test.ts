import type { OxyServices } from '../../OxyServices';
import type {
  AuthTokenBundle,
  DeviceTokenMintResponse,
  TokenRefreshResponse,
  WebSessionResult,
} from '@oxyhq/contracts';
import type { SessionLoginResponse } from '../../models/session';
import {
  runSessionColdBoot,
  createBrowserColdBootDom,
  isSameApex,
  BOOT_ATTEMPTED_KEY,
  type ColdBootDom,
} from '../coldBootV2';
import { BOOT_STATE_SESSION_KEY } from '../deviceBootReturn';
import { createMemoryAuthStateStore, type AuthStateStore } from '../../session/authStateStore';
import { KeyManager } from '../../crypto/keyManager';

const BUNDLE: AuthTokenBundle = {
  sessionId: 'sess-boot',
  accessToken: 'access-boot',
  refreshToken: 'refresh-boot-abcdefghij',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: 'user-boot', name: {} } as AuthTokenBundle['user'],
};

const ROTATED: TokenRefreshResponse = {
  accessToken: 'access-rot',
  refreshToken: 'refresh-rot-abcdefghij',
  expiresAt: '2030-01-01T00:00:00.000Z',
  sessionId: 'sess-rot',
};

interface OxyOverrides {
  baseURL?: string;
  exchangeBootCode?: OxyServices['exchangeBootCode'];
  refreshWithToken?: OxyServices['refreshWithToken'];
  signInWithSharedIdentity?: OxyServices['signInWithSharedIdentity'];
  issueNativeDeviceToken?: OxyServices['issueNativeDeviceToken'];
  requestWebSession?: OxyServices['requestWebSession'];
  mintFromDeviceSecret?: OxyServices['mintFromDeviceSecret'];
}

function makeOxy(overrides: OxyOverrides = {}): { oxy: OxyServices; setTokens: jest.Mock } {
  const setTokens = jest.fn();
  const oxy = {
    getBaseURL: () => overrides.baseURL ?? 'https://api.oxy.so',
    setTokens,
    exchangeBootCode: overrides.exchangeBootCode ?? (async () => BUNDLE),
    refreshWithToken: overrides.refreshWithToken ?? (async () => ROTATED),
    signInWithSharedIdentity: overrides.signInWithSharedIdentity ?? (async () => null),
    issueNativeDeviceToken: overrides.issueNativeDeviceToken ?? (async () => 'native-device-token'),
    requestWebSession:
      overrides.requestWebSession
      ?? (async () => ({ reason: 'no_session', deviceToken: 'dt-web' }) as WebSessionResult),
    // Default: no persisted secret in these fixtures, so the mint step skips
    // before ever calling this. Tests that exercise the mint pass an override.
    mintFromDeviceSecret:
      overrides.mintFromDeviceSecret
      ?? (async () => {
        throw new Error('mintFromDeviceSecret not stubbed');
      }),
    buildBootstrapUrl: (returnTo: string, state: string) =>
      `https://api.oxy.so/auth/device/bootstrap?return_to=${encodeURIComponent(returnTo)}&state=${state}`,
  } as unknown as OxyServices;
  return { oxy, setTokens };
}

const MINT: DeviceTokenMintResponse = {
  accessToken: 'access-minted',
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  nextDeviceSecret: 'ds-next-secret',
  state: {
    deviceId: 'dev-mint',
    accounts: [{ accountId: 'user-mint', sessionId: 'sess-mint', authuser: 0 }],
    activeAccountId: 'user-mint',
    revision: 2,
    updatedAt: 1_700_000_000_000,
  },
};

/** A 401 error shaped like `HttpService`/`handleError` output for the given body. */
function mint401(body: string): Error & { status: number } {
  return Object.assign(new Error(body), { status: 401 });
}

interface DomHandle {
  dom: ColdBootDom;
  navigate: jest.Mock;
  strip: jest.Mock;
  session: Map<string, string>;
  local: Map<string, string>;
}

function makeDom(opts: { hash?: string; hostname?: string; sessionState?: string; attempted?: boolean } = {}): DomHandle {
  const session = new Map<string, string>();
  const local = new Map<string, string>();
  if (opts.sessionState !== undefined) session.set(BOOT_STATE_SESSION_KEY, opts.sessionState);
  if (opts.attempted) local.set(BOOT_ATTEMPTED_KEY, '1');
  const navigate = jest.fn();
  const strip = jest.fn();
  const dom: ColdBootDom = {
    getHash: () => opts.hash ?? '',
    stripFragment: strip,
    getSessionItem: (k) => session.get(k) ?? null,
    setSessionItem: (k, v) => {
      session.set(k, v);
    },
    removeSessionItem: (k) => {
      session.delete(k);
    },
    getLocalItem: (k) => local.get(k) ?? null,
    setLocalItem: (k, v) => {
      local.set(k, v);
    },
    getLocationHostname: () => opts.hostname ?? 'accounts.oxy.so',
    getReturnToHref: () => 'https://accounts.oxy.so/home',
    navigate,
    randomState: () => 'state-fixed-1234',
  };
  return { dom, navigate, strip, session, local };
}

const WEB = { isWeb: true, isNative: false };
const NATIVE = { isWeb: false, isNative: true };

describe('isSameApex', () => {
  it('groups by registrable domain', () => {
    expect(isSameApex('accounts.oxy.so', 'api.oxy.so')).toBe(true);
    expect(isSameApex('oxy.so', 'api.oxy.so')).toBe(true);
    expect(isSameApex('app.mention.earth', 'api.oxy.so')).toBe(false);
    expect(isSameApex('homiio.com', 'api.oxy.so')).toBe(false);
  });

  it('does NOT collapse distinct IPv4 hosts that share trailing octets', () => {
    // The last-2-labels heuristic would map both to "1.1" — must be exact.
    expect(isSameApex('192.168.1.1', '10.0.1.1')).toBe(false);
    expect(isSameApex('192.168.1.10', '192.168.1.5')).toBe(false);
    expect(isSameApex('192.168.1.5', '192.168.1.5')).toBe(true);
  });

  it('requires exact equality for single-label / IPv6 / localhost hosts', () => {
    expect(isSameApex('localhost', 'localhost')).toBe(true);
    expect(isSameApex('localhost', 'api.oxy.so')).toBe(false);
    expect(isSameApex('::1', '::1')).toBe(true);
    expect(isSameApex('fe80::1', 'fe80::2')).toBe(false);
  });
});

describe('runSessionColdBoot — step ordering', () => {
  it('stored-tokens warm-plants a still-valid access token before any hop', async () => {
    const store = createMemoryAuthStateStore();
    await store.save({
      sessionId: 'sess-warm',
      refreshToken: 'r-abcdefghij',
      userId: 'user-warm',
      accessToken: 'warm-token',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const { oxy, setTokens } = makeOxy();
    const requestWebSession = jest.spyOn(oxy, 'requestWebSession');
    const onSession = jest.fn();

    const outcome = await runSessionColdBoot({
      oxy, store, platform: WEB, dom: makeDom().dom, onSession,
    });

    expect(outcome).toEqual({ kind: 'session', via: 'stored-tokens', session: expect.any(Object) });
    expect(setTokens).toHaveBeenCalledWith('warm-token');
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-warm', via: 'stored-tokens' }));
    expect(requestWebSession).not.toHaveBeenCalled();
  });

  it('stored-tokens rotates when the warm token is absent/expired', async () => {
    const store = createMemoryAuthStateStore();
    await store.save({ sessionId: 'sess-old', refreshToken: 'r-abcdefghij', userId: 'user-1' });
    const { oxy, setTokens } = makeOxy();

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: makeDom().dom });

    expect(outcome.kind).toBe('session');
    expect(setTokens).toHaveBeenCalledWith('access-rot');
    expect(await store.load()).toMatchObject({ sessionId: 'sess-rot', refreshToken: 'refresh-rot-abcdefghij' });
  });

  it('bootstrap-return wins over later steps when a valid fragment is present', async () => {
    const store = createMemoryAuthStateStore();
    // A base64url fragment carrying reason:session + matching state.
    const frag = {
      v: 1,
      state: 'state-match',
      reason: 'session',
      code: 'c'.repeat(24),
      deviceToken: 'd'.repeat(24),
    };
    const b64 = Buffer.from(JSON.stringify(frag), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const domHandle = makeDom({ hash: `#oxy_boot=${b64}`, sessionState: 'state-match' });
    const { oxy, setTokens } = makeOxy();
    const onSession = jest.fn();

    const outcome = await runSessionColdBoot({
      oxy, store, platform: WEB, dom: domHandle.dom, onSession,
    });

    expect(outcome).toEqual({ kind: 'session', via: 'bootstrap-return', session: expect.any(Object) });
    expect(domHandle.strip).toHaveBeenCalled();
    expect(setTokens).toHaveBeenCalledWith('access-boot');
    expect(onSession).toHaveBeenCalledWith(expect.objectContaining({ via: 'bootstrap-return' }));
  });
});

describe('runSessionColdBoot — device-secret-mint (phase 2c)', () => {
  function makeCredStore(extra: Partial<import('../../session/authStateStore').PersistedAuthState> = {}) {
    const store = createMemoryAuthStateStore();
    return { store, seed: async () => {
      await store.save({
        sessionId: 'sess-old',
        refreshToken: 'r-abcdefghij',
        userId: 'user-old',
        deviceId: 'dev-mint',
        deviceSecret: 'ds-secret-orig',
        ...extra,
      });
    } };
  }

  it('wins FIRST via the mint, persisting nextDeviceSecret BEFORE planting the token', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    const mintFromDeviceSecret = jest.fn(async () => MINT);
    const { oxy, setTokens } = makeOxy({ mintFromDeviceSecret });
    const saveSpy = jest.spyOn(store, 'save');
    const onSession = jest.fn();

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: makeDom().dom, onSession });

    expect(outcome).toEqual({ kind: 'session', via: 'device-secret-mint', session: expect.any(Object) });
    expect(mintFromDeviceSecret).toHaveBeenCalledWith('dev-mint', 'ds-secret-orig');
    expect(setTokens).toHaveBeenCalledWith('access-minted');
    // Session identity comes from the mint's authoritative active account.
    expect(onSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-mint', userId: 'user-mint', via: 'device-secret-mint' }),
    );
    // Rotation-in-use anti-loss: the store held the NEXT secret before the plant.
    const lastSaveOrder = Math.max(...saveSpy.mock.invocationCallOrder);
    const firstPlantOrder = Math.min(...setTokens.mock.invocationCallOrder);
    expect(lastSaveOrder).toBeLessThan(firstPlantOrder);
    expect(await store.load()).toMatchObject({
      deviceSecret: 'ds-next-secret',
      sessionId: 'sess-mint',
      userId: 'user-mint',
      accessToken: 'access-minted',
    });
  });

  it('skips (no mint) when only one of deviceId / deviceSecret is persisted', async () => {
    const store = createMemoryAuthStateStore();
    await store.save({ sessionId: 's', refreshToken: 'r-abcdefghij', userId: 'u', deviceSecret: 'ds-only' });
    const mintFromDeviceSecret = jest.fn(async () => MINT);
    const { oxy } = makeOxy({ mintFromDeviceSecret });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: makeDom().dom });

    expect(mintFromDeviceSecret).not.toHaveBeenCalled();
    // Falls through to the migratory refresh family.
    expect(outcome).toEqual({ kind: 'session', via: 'stored-tokens', session: expect.any(Object) });
  });

  it('401 invalid_device_secret → drops the secret (keeps deviceId) and falls through', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    const mintFromDeviceSecret = jest.fn(async () => {
      throw mint401('invalid_device_secret');
    });
    const { oxy } = makeOxy({ mintFromDeviceSecret });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: makeDom().dom });

    expect(mintFromDeviceSecret).toHaveBeenCalled();
    // The migratory refresh lane recovers the session.
    expect(outcome.kind).toBe('session');
    expect(outcome).toMatchObject({ via: 'stored-tokens' });
    const persisted = await store.load();
    expect(persisted?.deviceSecret).toBeUndefined();
    expect(persisted?.deviceId).toBe('dev-mint');
  });

  it('401 no_active_session → keeps the secret, signed out, NEVER falls to the hop', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    const mintFromDeviceSecret = jest.fn(async () => {
      throw mint401('no_active_session');
    });
    const { oxy } = makeOxy({ mintFromDeviceSecret });
    const refreshWithToken = jest.spyOn(oxy, 'refreshWithToken');
    const requestWebSession = jest.spyOn(oxy, 'requestWebSession');
    const domHandle = makeDom();
    const onSignedOut = jest.fn();

    const outcome = await runSessionColdBoot({
      oxy, store, platform: WEB, dom: domHandle.dom, onSignedOut,
    });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(onSignedOut).toHaveBeenCalledWith('no_session');
    // The known-signed-out device is not bounced and no fallback lane runs.
    expect(refreshWithToken).not.toHaveBeenCalled();
    expect(requestWebSession).not.toHaveBeenCalled();
    expect(domHandle.navigate).not.toHaveBeenCalled();
    // The secret is retained — the device may sign in again.
    expect((await store.load())?.deviceSecret).toBe('ds-secret-orig');
  });

  it('classifies a PLAIN-OBJECT 401 (no Error prototype) — no_active_session still keeps the secret', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    // Cross-realm / ApiError-shaped throw: not `instanceof Error`. Must still be
    // read as no_active_session — misreading it as a stale secret would drop it.
    const mintFromDeviceSecret = jest.fn(async () => {
      throw { status: 401, message: 'no_active_session' };
    });
    const { oxy } = makeOxy({ mintFromDeviceSecret });
    const onSignedOut = jest.fn();

    const outcome = await runSessionColdBoot({
      oxy, store, platform: WEB, dom: makeDom().dom, onSignedOut,
    });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect((await store.load())?.deviceSecret).toBe('ds-secret-orig');
  });

  it('transient (non-401) mint error → keeps the secret and falls through', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    const mintFromDeviceSecret = jest.fn(async () => {
      throw new Error('network down');
    });
    const { oxy } = makeOxy({ mintFromDeviceSecret });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: makeDom().dom });

    expect(outcome).toMatchObject({ kind: 'session', via: 'stored-tokens' });
    // The secret survives a transient failure (rotation preserved through refresh).
    expect((await store.load())?.deviceSecret).toBe('ds-secret-orig');
  });

  it('transient mint + cookie-lane hop whose bundle omits a secret → prior secret preserved', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    // Mint down, refresh family down → the chain lands on bootstrap-hop, whose
    // web-session BUNDLE carries no deviceSecret. The still-valid prior secret
    // must survive the store overwrite (else the mint lane is orphaned forever).
    const mintFromDeviceSecret = jest.fn(async () => {
      throw new Error('network down');
    });
    const refreshWithToken = jest.fn(async () => {
      throw new Error('refresh down');
    });
    const requestWebSession = jest.fn(
      async () => ({ reason: 'session', session: BUNDLE, deviceToken: 'dt-rotated' }) as WebSessionResult,
    );
    const { oxy } = makeOxy({ mintFromDeviceSecret, refreshWithToken, requestWebSession });
    const domHandle = makeDom({ hostname: 'accounts.oxy.so' });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom });

    expect(outcome).toMatchObject({ kind: 'session', via: 'bootstrap-hop' });
    const persisted = await store.load();
    expect(persisted?.deviceSecret).toBe('ds-secret-orig');
    expect(persisted?.deviceId).toBe('dev-mint');
  });

  it('is gated OFF while a #oxy_boot return fragment is present (bootstrap-return wins)', async () => {
    const { store, seed } = makeCredStore();
    await seed();
    const frag = { v: 1, state: 'state-match', reason: 'session', code: 'c'.repeat(24), deviceToken: 'd'.repeat(24) };
    const b64 = Buffer.from(JSON.stringify(frag), 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const domHandle = makeDom({ hash: `#oxy_boot=${b64}`, sessionState: 'state-match' });
    const mintFromDeviceSecret = jest.fn(async () => MINT);
    const { oxy } = makeOxy({ mintFromDeviceSecret });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom });

    expect(outcome).toMatchObject({ via: 'bootstrap-return' });
    expect(mintFromDeviceSecret).not.toHaveBeenCalled();
    expect(domHandle.strip).toHaveBeenCalled();
  });
});

describe('runSessionColdBoot — bootstrap-hop (web)', () => {
  it('same-apex: resolves a session via the inline web-session fetch (no navigation)', async () => {
    const store = createMemoryAuthStateStore();
    // The EXACT post-unwrap server shape (PR #526): a reason-`session` envelope
    // nesting the bundle under `session` plus the rotated deviceToken.
    const sessionEnvelope: WebSessionResult = { reason: 'session', session: BUNDLE, deviceToken: 'dt-rotated' };
    const requestWebSession = jest.fn(async () => sessionEnvelope);
    const { oxy, setTokens } = makeOxy({ requestWebSession });
    const domHandle = makeDom({ hostname: 'accounts.oxy.so' });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom });

    expect(outcome).toEqual({ kind: 'session', via: 'bootstrap-hop', session: expect.any(Object) });
    expect(requestWebSession).toHaveBeenCalledTimes(1);
    expect(setTokens).toHaveBeenCalledWith('access-boot');
    expect(domHandle.navigate).not.toHaveBeenCalled();
    expect(await store.load()).toMatchObject({ sessionId: 'sess-boot', refreshToken: 'refresh-boot-abcdefghij' });
    // deviceToken from the SAME envelope is persisted on the session arm too.
    expect(await store.loadDeviceToken()).toBe('dt-rotated');
  });

  it('same-apex: signed-out device persists the deviceToken and reports signed out', async () => {
    const store = createMemoryAuthStateStore();
    const requestWebSession = jest.fn(async () => ({ reason: 'no_session', deviceToken: 'dt-web' }) as WebSessionResult);
    const { oxy } = makeOxy({ requestWebSession });
    const domHandle = makeDom({ hostname: 'accounts.oxy.so' });
    const onSignedOut = jest.fn();

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom, onSignedOut });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(onSignedOut).toHaveBeenCalledWith('no_session');
    expect(await store.loadDeviceToken()).toBe('dt-web');
    expect(domHandle.navigate).not.toHaveBeenCalled();
  });

  it('cross-apex: navigates ONCE, stashing state + the attempted flag', async () => {
    const store = createMemoryAuthStateStore();
    const { oxy } = makeOxy();
    const domHandle = makeDom({ hostname: 'app.mention.earth' });
    const onSignedOut = jest.fn();
    const onSession = jest.fn();

    await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom, onSignedOut, onSession });

    expect(domHandle.navigate).toHaveBeenCalledTimes(1);
    expect(domHandle.navigate).toHaveBeenCalledWith(expect.stringContaining('/auth/device/bootstrap?return_to='));
    expect(domHandle.session.get(BOOT_STATE_SESSION_KEY)).toBe('state-fixed-1234');
    expect(domHandle.local.get(BOOT_ATTEMPTED_KEY)).toBe('1');
    // Navigating away — neither callback fires (no signed-out flash).
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(onSession).not.toHaveBeenCalled();
  });

  it('cross-apex: NEVER navigates a second time once the attempted flag is set', async () => {
    const store = createMemoryAuthStateStore();
    const { oxy } = makeOxy();
    const domHandle = makeDom({ hostname: 'app.mention.earth', attempted: true });
    const onSignedOut = jest.fn();

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom, onSignedOut });

    expect(domHandle.navigate).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(onSignedOut).toHaveBeenCalledWith('no_session');
  });
});

describe('runSessionColdBoot — native shared-key', () => {
  afterEach(() => jest.restoreAllMocks());

  it('re-mints via shared identity and issues + mirrors a deviceToken the first time', async () => {
    const store = createMemoryAuthStateStore();
    const sharedSession: SessionLoginResponse = {
      sessionId: 'sess-shared',
      deviceId: 'dev-1',
      expiresAt: '2030-01-01T00:00:00.000Z',
      user: { id: 'user-shared', username: 'u', name: {}, avatar: undefined },
      accessToken: 'access-shared',
    };
    const issueNativeDeviceToken = jest.fn(async () => 'fresh-device-token');
    const { oxy } = makeOxy({
      signInWithSharedIdentity: async () => sharedSession,
      issueNativeDeviceToken,
    });
    const getShared = jest.spyOn(KeyManager, 'getSharedDeviceToken').mockResolvedValue(null);
    const setShared = jest.spyOn(KeyManager, 'setSharedDeviceToken').mockResolvedValue(undefined);
    const requestWebSession = jest.spyOn(oxy, 'requestWebSession');

    const outcome = await runSessionColdBoot({ oxy, store, platform: NATIVE, dom: makeDom().dom });

    expect(outcome).toEqual({ kind: 'session', via: 'shared-key-signin', session: expect.any(Object) });
    expect(getShared).toHaveBeenCalled();
    expect(issueNativeDeviceToken).toHaveBeenCalled();
    expect(setShared).toHaveBeenCalledWith('fresh-device-token');
    expect(await store.loadDeviceToken()).toBe('fresh-device-token');
    // bootstrap-hop is web-only — never runs on native.
    expect(requestWebSession).not.toHaveBeenCalled();
  });

  it('skips device-token issuance when the shared token already exists', async () => {
    const store = createMemoryAuthStateStore();
    const issueNativeDeviceToken = jest.fn(async () => 'unused');
    const { oxy } = makeOxy({
      signInWithSharedIdentity: async () => ({
        sessionId: 'sess-shared',
        deviceId: 'dev-1',
        expiresAt: '2030-01-01T00:00:00.000Z',
        user: { id: 'user-shared', username: 'u', name: {}, avatar: undefined },
        accessToken: 'access-shared',
      }),
      issueNativeDeviceToken,
    });
    jest.spyOn(KeyManager, 'getSharedDeviceToken').mockResolvedValue('already-there');

    await runSessionColdBoot({ oxy, store, platform: NATIVE, dom: makeDom().dom });

    expect(issueNativeDeviceToken).not.toHaveBeenCalled();
  });
});

describe('createBrowserColdBootDom', () => {
  it('returns neutral values under the jest node environment (no window)', () => {
    const dom = createBrowserColdBootDom();
    expect(dom.getHash()).toBe('');
    expect(dom.getLocationHostname()).toBeNull();
    expect(dom.getSessionItem('x')).toBeNull();
    expect(() => dom.stripFragment()).not.toThrow();
    expect(() => dom.navigate('https://x')).not.toThrow();
    expect(dom.randomState()).toMatch(/^[0-9a-f]+$/);
  });
});
