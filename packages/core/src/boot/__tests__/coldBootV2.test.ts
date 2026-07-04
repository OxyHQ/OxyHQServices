import type { OxyServices } from '../../OxyServices';
import type { AuthTokenBundle, TokenRefreshResponse } from '@oxyhq/contracts';
import type { SessionLoginResponse } from '../../models/session';
import type { WebSessionResult } from '../../mixins/OxyServices.deviceBoot';
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
    buildBootstrapUrl: (returnTo: string, state: string) =>
      `https://api.oxy.so/auth/device/bootstrap?return_to=${encodeURIComponent(returnTo)}&state=${state}`,
  } as unknown as OxyServices;
  return { oxy, setTokens };
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

describe('runSessionColdBoot — bootstrap-hop (web)', () => {
  it('same-apex: resolves a session via the inline web-session fetch (no navigation)', async () => {
    const store = createMemoryAuthStateStore();
    const requestWebSession = jest.fn(async () => BUNDLE as WebSessionResult);
    const { oxy, setTokens } = makeOxy({ requestWebSession });
    const domHandle = makeDom({ hostname: 'accounts.oxy.so' });

    const outcome = await runSessionColdBoot({ oxy, store, platform: WEB, dom: domHandle.dom });

    expect(outcome).toEqual({ kind: 'session', via: 'bootstrap-hop', session: expect.any(Object) });
    expect(requestWebSession).toHaveBeenCalledTimes(1);
    expect(setTokens).toHaveBeenCalledWith('access-boot');
    expect(domHandle.navigate).not.toHaveBeenCalled();
    expect(await store.load()).toMatchObject({ sessionId: 'sess-boot' });
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
