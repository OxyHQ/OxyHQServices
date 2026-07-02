/**
 * `establishIdpSessionAfterClaim` — the post-claim durable-session hop.
 *
 * After a WEB device-flow ("Sign in with Oxy" QR) claim commits, the app holds
 * only in-memory tokens: no `fedcm_session` cookie was ever planted at the IdP,
 * so a reload cannot re-mint a token. This primitive performs ONE top-level
 * establish hop (via the RP-minted establish-URL) so the per-apex IdP cookie is
 * planted and a reload restores via the existing `sso-return` / silent-iframe
 * paths.
 *
 * Invariants pinned here:
 *  - web only (no-op off-web / native);
 *  - never fires while sitting on the central IdP origin (would loop);
 *  - persists the SAME bounce state (`ssoStateKey`/`ssoGuardKey`/`ssoDestKey`)
 *    the `buildSsoBounceUrl` machinery primes, so the post-bounce `sso-return`
 *    step validates the state, exchanges the code, and restores the dest;
 *  - persists ONLY after the establish-URL request succeeds (no stale state on
 *    failure);
 *  - navigates exactly once, to the server-returned establish URL;
 *  - total: an establish-request failure leaves the committed in-memory session
 *    untouched, does NOT navigate, and returns `false` (user no worse off).
 */

import { establishIdpSessionAfterClaim } from '../ssoEstablish';
import {
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
} from '../ssoBounce';
import { CENTRAL_AUTH_URL } from '../authWebUrl';

const RP_ORIGIN = 'https://accounts.oxy.so';
const RP_HREF = 'https://accounts.oxy.so/settings';
const ESTABLISH_URL =
  'https://auth.oxy.so/sso/establish?et=jwt.abc.def&return_to=https%3A%2F%2Faccounts.oxy.so%2F__oxy%2Fsso-callback&state=state-xyz';

function makeStorage(): {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  map: Map<string, string>;
} {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    },
  };
}

describe('establishIdpSessionAfterClaim', () => {
  it('requests the establish URL with the RP origin + generated state and navigates once (web)', async () => {
    const { storage, map } = makeStorage();
    const navigated: string[] = [];
    const requestSsoEstablishUrl = jest.fn(async (origin: string, state: string) => {
      expect(origin).toBe(RP_ORIGIN);
      expect(state).toBe('state-xyz');
      return { establishUrl: ESTABLISH_URL };
    });

    const result = await establishIdpSessionAfterClaim(
      { requestSsoEstablishUrl },
      {
        isWeb: () => true,
        storage,
        location: { origin: RP_ORIGIN, href: RP_HREF },
        navigate: (url) => navigated.push(url),
        generateState: () => 'state-xyz',
        now: () => 1_700_000_000_000,
      },
    );

    expect(result).toBe(true);
    expect(requestSsoEstablishUrl).toHaveBeenCalledTimes(1);
    expect(navigated).toEqual([ESTABLISH_URL]);

    // Bounce state persisted so the post-bounce `sso-return` step validates it.
    expect(map.get(ssoStateKey(RP_ORIGIN))).toBe('state-xyz');
    expect(map.get(ssoGuardKey(RP_ORIGIN))).toBe(String(1_700_000_000_000));
    expect(map.get(ssoDestKey(RP_ORIGIN))).toBe(RP_HREF);
  });

  it('is a no-op off-web (native): no request, no navigation, no state', async () => {
    const { storage, map } = makeStorage();
    const navigated: string[] = [];
    const requestSsoEstablishUrl = jest.fn(async () => ({ establishUrl: ESTABLISH_URL }));

    const result = await establishIdpSessionAfterClaim(
      { requestSsoEstablishUrl },
      {
        isWeb: () => false,
        storage,
        location: { origin: RP_ORIGIN, href: RP_HREF },
        navigate: (url) => navigated.push(url),
      },
    );

    expect(result).toBe(false);
    expect(requestSsoEstablishUrl).not.toHaveBeenCalled();
    expect(navigated).toEqual([]);
    expect(map.size).toBe(0);
  });

  it('never fires while sitting on the central IdP origin (loop guard)', async () => {
    const { storage, map } = makeStorage();
    const navigated: string[] = [];
    const requestSsoEstablishUrl = jest.fn(async () => ({ establishUrl: ESTABLISH_URL }));

    const result = await establishIdpSessionAfterClaim(
      { requestSsoEstablishUrl },
      {
        isWeb: () => true,
        storage,
        location: { origin: new URL(CENTRAL_AUTH_URL).origin, href: `${CENTRAL_AUTH_URL}/` },
        navigate: (url) => navigated.push(url),
      },
    );

    expect(result).toBe(false);
    expect(requestSsoEstablishUrl).not.toHaveBeenCalled();
    expect(navigated).toEqual([]);
    expect(map.size).toBe(0);
  });

  it('on an establish-request failure: no navigation, no persisted state, returns false (single attempt)', async () => {
    const { storage, map } = makeStorage();
    const navigated: string[] = [];
    const onError = jest.fn();
    const requestSsoEstablishUrl = jest.fn(async () => {
      throw new Error('403 unapproved origin');
    });

    const result = await establishIdpSessionAfterClaim(
      { requestSsoEstablishUrl },
      {
        isWeb: () => true,
        storage,
        location: { origin: RP_ORIGIN, href: RP_HREF },
        navigate: (url) => navigated.push(url),
        generateState: () => 'state-xyz',
        onError,
      },
    );

    expect(result).toBe(false);
    expect(requestSsoEstablishUrl).toHaveBeenCalledTimes(1);
    expect(navigated).toEqual([]);
    // No stale bounce state left behind on failure.
    expect(map.size).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('does not navigate when the server returns no establish URL', async () => {
    const { storage, map } = makeStorage();
    const navigated: string[] = [];
    const requestSsoEstablishUrl = jest.fn(async () => ({ establishUrl: '' }));

    const result = await establishIdpSessionAfterClaim(
      { requestSsoEstablishUrl },
      {
        isWeb: () => true,
        storage,
        location: { origin: RP_ORIGIN, href: RP_HREF },
        navigate: (url) => navigated.push(url),
        generateState: () => 'state-xyz',
      },
    );

    expect(result).toBe(false);
    expect(navigated).toEqual([]);
    expect(map.size).toBe(0);
  });

  it.each([
    ['unparseable', 'not a url'],
    ['non-https (http)', 'http://auth.oxy.so/sso/establish?et=x&state=s'],
    ['wrong path', 'https://auth.oxy.so/evil?et=x&state=s'],
    ['non-auth host', 'https://evil.oxy.so/sso/establish?et=x&state=s'],
  ])(
    'aborts silently (no navigation, no state) for a %s establish URL',
    async (_label, badUrl) => {
      const { storage, map } = makeStorage();
      const navigated: string[] = [];
      const requestSsoEstablishUrl = jest.fn(async () => ({ establishUrl: badUrl }));

      const result = await establishIdpSessionAfterClaim(
        { requestSsoEstablishUrl },
        {
          isWeb: () => true,
          storage,
          location: { origin: RP_ORIGIN, href: RP_HREF },
          navigate: (url) => navigated.push(url),
          generateState: () => 'state-xyz',
        },
      );

      expect(result).toBe(false);
      expect(navigated).toEqual([]);
      expect(map.size).toBe(0);
    },
  );
});
