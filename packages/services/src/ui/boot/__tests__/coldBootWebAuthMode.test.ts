/**
 * `runProviderColdBoot` — the `webAuthMode` transport gate (#691 phase 7).
 *
 * `webAuthMode: 'popup'` must never let the boot navigate the RP's top-level
 * window: no silent `prompt=none` restore, no authorize redirect, a signed-out
 * domain simply resolves signed out. `'redirect'` — still the default and the
 * compatibility path — must behave exactly as before.
 *
 * Unlike `__tests__/boot/runProviderColdBoot.test.ts` (deadline + connectivity
 * wiring, with `crossOriginRestore` stubbed out), this suite keeps the restore
 * lane REAL so the redirect-mode assertions reach the actual navigation
 * primitive — the thing popup mode has to suppress.
 */

import type { AuthStateStore, PersistedAuthState, SessionClient } from '@oxyhq/core';

// Only `runSessionColdBoot` and the origin-CLASSIFICATION predicates are faked.
// jsdom's `location` is non-configurable, so origin eligibility has to be driven
// through the predicates (their real behaviour is covered by core's own tests);
// everything else in core (PKCE, authorize-URL builder, handshake store) stays
// real so the redirect-mode lane is exercised end to end.
jest.mock('@oxyhq/core', () => {
  const actual = jest.requireActual('@oxyhq/core');
  return {
    __esModule: true,
    ...actual,
    runSessionColdBoot: jest.fn(),
    isLoopbackOrigin: jest.fn(() => false),
    isOfficialWebOrigin: jest.fn(() => true),
    isIdpHubOrigin: jest.fn(() => false),
  };
});

// The ONLY top-level-window navigation primitive either lane can reach.
jest.mock('../../components/oauthNavigation', () => ({
  redirectToAuthorize: jest.fn(),
}));

// Spied but REAL: redirect mode must still perform the actual restore.
jest.mock('../../utils/crossOriginRestore', () => {
  const actual = jest.requireActual('../../utils/crossOriginRestore');
  return {
    __esModule: true,
    ...actual,
    maybeStartSilentOAuthRestore: jest.fn(actual.maybeStartSilentOAuthRestore),
    consumeSilentOAuthError: jest.fn(actual.consumeSilentOAuthError),
  };
});

jest.mock('../../utils/oauthReturn', () => {
  const actual = jest.requireActual('../../utils/oauthReturn');
  return {
    __esModule: true,
    ...actual,
    tryCompleteOAuthReturn: jest.fn(async () => false),
    consumeHubSyncFailure: jest.fn(actual.consumeHubSyncFailure),
  };
});

import { runSessionColdBoot } from '@oxyhq/core';
import { redirectToAuthorize } from '../../components/oauthNavigation';
import {
  clearCrossOriginRestoreGuards,
  consumeSilentOAuthError,
  maybeStartSilentOAuthRestore,
} from '../../utils/crossOriginRestore';
import { consumeHubSyncFailure, tryCompleteOAuthReturn } from '../../utils/oauthReturn';
import { runProviderColdBoot, type RunProviderColdBootOptions } from '../runProviderColdBoot';

const mockRunSessionColdBoot = runSessionColdBoot as jest.Mock;
const mockRedirectToAuthorize = redirectToAuthorize as jest.Mock;
const mockSilentRestore = maybeStartSilentOAuthRestore as jest.Mock;
const mockConsumeSilentOAuthError = consumeSilentOAuthError as jest.Mock;
const mockConsumeHubSyncFailure = consumeHubSyncFailure as jest.Mock;
const mockTryCompleteOAuthReturn = tryCompleteOAuthReturn as jest.Mock;

const CLIENT_ID = 'oxy_dk_test';

/** An auth store holding no device credential — the signed-out domain case. */
function makeEmptyAuthStore(): AuthStateStore {
  return {
    load: jest.fn(async (): Promise<PersistedAuthState | null> => null),
    save: jest.fn(async () => undefined),
    clear: jest.fn(async () => undefined),
  } as unknown as AuthStateStore;
}

interface Harness {
  options: RunProviderColdBootOptions;
  commitSession: jest.Mock;
  markAuthResolved: jest.Mock;
  setTokenReady: jest.Mock;
  sessionClientStart: jest.Mock;
}

function makeHarness(overrides: Partial<RunProviderColdBootOptions> = {}): Harness {
  const commitSession = jest.fn(async () => undefined);
  const markAuthResolved = jest.fn();
  const setTokenReady = jest.fn();
  const sessionClientStart = jest.fn(async () => undefined);

  const options: RunProviderColdBootOptions = {
    oxyServices: {} as RunProviderColdBootOptions['oxyServices'],
    authStore: makeEmptyAuthStore(),
    clientId: CLIENT_ID,
    sessionClient: { start: sessionClientStart } as unknown as SessionClient,
    syncDeviceCredentialToHost: jest.fn(async () => undefined),
    commitSession,
    markAuthResolved,
    setTokenReady,
    ...overrides,
  };

  return { options, commitSession, markAuthResolved, setTokenReady, sessionClientStart };
}

/** `runSessionColdBoot` finding no session at all — the signed-out domain. */
function stubSignedOutBoot(): void {
  mockRunSessionColdBoot.mockImplementation(async (opts: Parameters<typeof runSessionColdBoot>[0]) => {
    await opts.onSignedOut?.('no_session');
    return { kind: 'unauthenticated' } as const;
  });
}

describe('runProviderColdBoot — webAuthMode transport gate (#691 phase 7)', () => {
  beforeEach(() => {
    mockRunSessionColdBoot.mockReset();
    mockRedirectToAuthorize.mockClear();
    mockSilentRestore.mockClear();
    mockConsumeSilentOAuthError.mockClear();
    mockConsumeHubSyncFailure.mockClear();
    mockTryCompleteOAuthReturn.mockClear();
    mockTryCompleteOAuthReturn.mockImplementation(async () => false);
    globalThis.sessionStorage?.clear();
    clearCrossOriginRestoreGuards();
  });

  describe("webAuthMode: 'popup'", () => {
    it('never starts the silent restore and never navigates the top-level window', async () => {
      stubSignedOutBoot();
      const { options } = makeHarness({ webAuthMode: 'popup' });

      await runProviderColdBoot(options);

      expect(mockSilentRestore).not.toHaveBeenCalled();
      expect(mockRedirectToAuthorize).not.toHaveBeenCalled();
    });

    it('resolves a domain with no local credential SIGNED OUT instead of bouncing', async () => {
      stubSignedOutBoot();
      const { options, markAuthResolved, commitSession, sessionClientStart } = makeHarness({
        webAuthMode: 'popup',
      });

      await runProviderColdBoot(options);

      // Auth resolution concluded (routing can settle), nothing was committed,
      // and with no persisted credential the device socket is not started.
      expect(markAuthResolved).toHaveBeenCalled();
      expect(commitSession).not.toHaveBeenCalled();
      expect(sessionClientStart).not.toHaveBeenCalled();
      expect(mockRedirectToAuthorize).not.toHaveBeenCalled();
    });

    it('still completes an authorization code already on the URL (blocked-popup fallback)', async () => {
      // A popup-mode app lands here whenever the browser blocked the popup and
      // `startWebOAuthSignIn` fell back to a full-page redirect.
      mockTryCompleteOAuthReturn.mockImplementation(async () => true);
      const { options, markAuthResolved, setTokenReady } = makeHarness({ webAuthMode: 'popup' });

      await runProviderColdBoot(options);

      expect(mockTryCompleteOAuthReturn).toHaveBeenCalledTimes(1);
      expect(setTokenReady).toHaveBeenLastCalledWith(true);
      expect(markAuthResolved).toHaveBeenCalled();
      // The device mint is short-circuited by the completed return leg.
      expect(mockRunSessionColdBoot).not.toHaveBeenCalled();
      expect(mockRedirectToAuthorize).not.toHaveBeenCalled();
    });

    it('commits the OAuth return WITHOUT hub sync', async () => {
      mockTryCompleteOAuthReturn.mockImplementation(async () => true);
      const { options } = makeHarness({ webAuthMode: 'popup' });

      await runProviderColdBoot(options);

      const commit = mockTryCompleteOAuthReturn.mock.calls[0][0] as {
        commitSession: (input: unknown) => Promise<void>;
      };
      await commit.commitSession({ sessionId: 's1', userId: 'u1' });
      expect(options.commitSession).toHaveBeenCalledWith(
        { sessionId: 's1', userId: 'u1' },
        { activate: true, hubSync: false },
      );
    });
  });

  describe("webAuthMode: 'redirect' (unchanged compatibility path)", () => {
    it('starts the silent restore and navigates to the IdP with prompt=none', async () => {
      stubSignedOutBoot();
      const { options } = makeHarness({ webAuthMode: 'redirect' });

      await runProviderColdBoot(options);

      expect(mockSilentRestore).toHaveBeenCalledTimes(1);
      expect(mockRedirectToAuthorize).toHaveBeenCalledTimes(1);
      const url = new URL(mockRedirectToAuthorize.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe('https://auth.oxy.so/authorize');
      expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
      expect(url.searchParams.get('prompt')).toBe('none');
    });

    it('is the DEFAULT when no webAuthMode is supplied', async () => {
      stubSignedOutBoot();
      const { options } = makeHarness();

      await runProviderColdBoot(options);

      expect(mockSilentRestore).toHaveBeenCalledTimes(1);
      expect(mockRedirectToAuthorize).toHaveBeenCalledTimes(1);
    });

    it('does NOT restore when the mint already resolved a session', async () => {
      mockRunSessionColdBoot.mockImplementation(async (opts: Parameters<typeof runSessionColdBoot>[0]) => {
        const session = { sessionId: 's1', userId: 'u1', accessToken: 'at', via: 'device-secret-mint' };
        await opts.onSession?.(session);
        return { kind: 'session', via: session.via, session } as const;
      });
      const { options, commitSession } = makeHarness({ webAuthMode: 'redirect' });

      await runProviderColdBoot(options);

      expect(commitSession).toHaveBeenCalledWith(
        { sessionId: 's1', accessToken: 'at', userId: 'u1' },
        { activate: false },
      );
      expect(mockSilentRestore).not.toHaveBeenCalled();
      expect(mockRedirectToAuthorize).not.toHaveBeenCalled();
    });
  });

  describe('URL-cleanup consumers run in BOTH modes', () => {
    it.each(['popup', 'redirect'] as const)(
      'consumes the silent-OAuth error and hub-sync failure params (%s)',
      async (webAuthMode) => {
        stubSignedOutBoot();
        const { options } = makeHarness({ webAuthMode });

        await runProviderColdBoot(options);

        expect(mockConsumeSilentOAuthError).toHaveBeenCalledTimes(1);
        expect(mockConsumeHubSyncFailure).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['popup', 'redirect'] as const)(
      'consumes an authorization code left on the URL (%s)',
      async (webAuthMode) => {
        stubSignedOutBoot();
        const { options } = makeHarness({ webAuthMode });

        await runProviderColdBoot(options);

        expect(mockTryCompleteOAuthReturn).toHaveBeenCalledTimes(1);
      },
    );
  });

  describe('identity mode still skips both web OAuth lanes in either transport', () => {
    it.each(['popup', 'redirect'] as const)('skips the return leg and the restore (%s)', async (webAuthMode) => {
      stubSignedOutBoot();
      const { options } = makeHarness({ webAuthMode, sessionMode: 'identity' });

      await runProviderColdBoot(options);

      expect(mockTryCompleteOAuthReturn).not.toHaveBeenCalled();
      expect(mockSilentRestore).not.toHaveBeenCalled();
      expect(mockRedirectToAuthorize).not.toHaveBeenCalled();
    });
  });
});
