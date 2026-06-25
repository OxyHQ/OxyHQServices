/**
 * `parseSsoReturnFragment` — SSO return fragment parsing.
 *
 * The central IdP returns the RP via a top-level redirect with the bounce
 * result in the URL fragment. The parser must be pure, total (never throws),
 * and report `kind` strictly as one of `'ok' | 'none' | 'error'`, returning
 * `null` for anything that is not an oxy_sso fragment.
 */

import type { SessionLoginResponse } from '../../models/session';
import { consumeSsoReturn, parseSsoReturnFragment } from '../ssoReturn';
import {
  getSsoCallbackBootstrapScript,
  ssoAttemptedKey,
  ssoCallbackBootstrapKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoStateKey,
} from '../ssoBounce';

class MemorySsoStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const ORIGIN = 'https://app.mention.earth';

const exchangedSession: SessionLoginResponse = {
  sessionId: 'sess_sso',
  deviceId: 'device_sso',
  accessToken: 'access_sso',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: 'user_sso', username: 'sso-user' },
};

describe('parseSsoReturnFragment', () => {
  describe('ok', () => {
    it('parses a success fragment with code and state', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&code=abc123&state=xyz');

      expect(result).toEqual({ kind: 'ok', code: 'abc123', state: 'xyz' });
    });

    it('parses a success fragment without a leading #', () => {
      const result = parseSsoReturnFragment('oxy_sso=ok&code=abc123&state=xyz');

      expect(result).toEqual({ kind: 'ok', code: 'abc123', state: 'xyz' });
    });

    it('omits code when ok carries no code', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&state=xyz');

      expect(result).toEqual({ kind: 'ok', state: 'xyz' });
      expect(result?.code).toBeUndefined();
    });

    it('URL-decodes percent-encoded values', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&code=a%2Bb%2Fc&state=s%20t');

      expect(result).toEqual({ kind: 'ok', code: 'a+b/c', state: 's t' });
    });
  });

  describe('none', () => {
    it('parses a none fragment and carries state but never a code', () => {
      const result = parseSsoReturnFragment('#oxy_sso=none&state=xyz');

      expect(result).toEqual({ kind: 'none', state: 'xyz' });
    });

    it('ignores a stray code on a none outcome', () => {
      const result = parseSsoReturnFragment('#oxy_sso=none&code=leaked&state=xyz');

      expect(result).toEqual({ kind: 'none', state: 'xyz' });
      expect(result?.code).toBeUndefined();
    });
  });

  describe('error', () => {
    it('parses an error fragment', () => {
      const result = parseSsoReturnFragment('#oxy_sso=error&state=xyz');

      expect(result).toEqual({ kind: 'error', state: 'xyz' });
    });

    it('ignores a stray code on an error outcome', () => {
      const result = parseSsoReturnFragment('#oxy_sso=error&code=leaked');

      expect(result).toEqual({ kind: 'error' });
      expect(result?.code).toBeUndefined();
    });
  });

  describe('null (not an oxy_sso fragment)', () => {
    it('returns null for an empty string', () => {
      expect(parseSsoReturnFragment('')).toBeNull();
    });

    it('returns null for a bare #', () => {
      expect(parseSsoReturnFragment('#')).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(parseSsoReturnFragment(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(parseSsoReturnFragment(null)).toBeNull();
    });

    it('returns null for a fragment without oxy_sso', () => {
      expect(parseSsoReturnFragment('#access_token=foo&state=bar')).toBeNull();
    });

    it('returns null for an unrecognised oxy_sso value', () => {
      expect(parseSsoReturnFragment('#oxy_sso=bogus&code=x')).toBeNull();
    });

    it('returns null for an empty oxy_sso value', () => {
      expect(parseSsoReturnFragment('#oxy_sso=&code=x')).toBeNull();
    });
  });

  describe('malformed / defensive', () => {
    it('never throws and returns a valid kind for junk after the marker', () => {
      const result = parseSsoReturnFragment('#oxy_sso=ok&=&&&code=c&&');

      expect(result?.kind).toBe('ok');
      expect(result?.code).toBe('c');
    });

    it('always reports a kind in the strict union', () => {
      for (const input of [
        '#oxy_sso=ok',
        '#oxy_sso=none',
        '#oxy_sso=error',
      ]) {
        const result = parseSsoReturnFragment(input);
        expect(result).not.toBeNull();
        expect(['ok', 'none', 'error']).toContain(result?.kind);
      }
    });
  });
});

describe('consumeSsoReturn pre-hydration callback bootstrap', () => {
  it('continues an ok callback after the HTML bootstrap moved the URL to a hydratable route', async () => {
    const storage = new MemorySsoStorage();
    const replaceStateCalls: string[] = [];
    const dispatchPopState = jest.fn();
    const hardRedirect = jest.fn();
    const exchangeSsoCode = jest.fn(async (): Promise<SessionLoginResponse> => exchangedSession);

    storage.setItem(ssoStateKey(ORIGIN), 'state-ok');
    storage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}/explore?tab=home#top`);
    storage.setItem(ssoCallbackBootstrapKey(ORIGIN), '1');

    const session = await consumeSsoReturn(
      { exchangeSsoCode },
      {
        isWeb: () => true,
        storage,
        location: {
          hash: '#oxy_sso=ok&code=opaque-code&state=state-ok',
          origin: ORIGIN,
          pathname: '/',
          search: '',
        },
        history: {
          replaceState: (_data: unknown, _unused: string, url?: string | URL | null): void => {
            replaceStateCalls.push(String(url ?? ''));
          },
        },
        dispatchPopState,
        hardRedirect,
      },
    );

    expect(session).toBe(exchangedSession);
    expect(exchangeSsoCode).toHaveBeenCalledWith('opaque-code', 'state-ok');
    expect(replaceStateCalls).toEqual(['/', '/explore?tab=home#top']);
    expect(dispatchPopState).toHaveBeenCalledTimes(1);
    expect(hardRedirect).not.toHaveBeenCalled();
    expect(storage.getItem(ssoCallbackBootstrapKey(ORIGIN))).toBeNull();
    expect(storage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    expect(storage.getItem(ssoNoSessionKey(ORIGIN))).toBeNull();
  });

  it('leaves a bootstrapped none callback with loop breakers set and no exchange', async () => {
    const storage = new MemorySsoStorage();
    const replaceStateCalls: string[] = [];
    const dispatchPopState = jest.fn();
    const hardRedirect = jest.fn();
    const exchangeSsoCode = jest.fn(async (): Promise<SessionLoginResponse> => exchangedSession);

    storage.setItem(ssoStateKey(ORIGIN), 'state-none');
    storage.setItem(ssoDestKey(ORIGIN), `${ORIGIN}/library`);
    storage.setItem(ssoCallbackBootstrapKey(ORIGIN), '1');

    const session = await consumeSsoReturn(
      { exchangeSsoCode },
      {
        isWeb: () => true,
        storage,
        location: {
          hash: '#oxy_sso=none&state=state-none',
          origin: ORIGIN,
          pathname: '/',
          search: '',
        },
        history: {
          replaceState: (_data: unknown, _unused: string, url?: string | URL | null): void => {
            replaceStateCalls.push(String(url ?? ''));
          },
        },
        dispatchPopState,
        hardRedirect,
      },
    );

    expect(session).toBeNull();
    expect(exchangeSsoCode).not.toHaveBeenCalled();
    expect(replaceStateCalls).toEqual(['/']);
    expect(dispatchPopState).not.toHaveBeenCalled();
    expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/library`);
    expect(storage.getItem(ssoCallbackBootstrapKey(ORIGIN))).toBeNull();
    expect(storage.getItem(ssoDestKey(ORIGIN))).toBeNull();
    expect(storage.getItem(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.getItem(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  it('exposes a pre-hydration script that preserves the SSO fragment', () => {
    const script = getSsoCallbackBootstrapScript();

    expect(script).toContain('/__oxy/sso-callback');
    expect(script).toContain('oxy_sso=');
    expect(script).toContain('window.history.replaceState');
    expect(script).toContain('window.location.hash');
  });
});
