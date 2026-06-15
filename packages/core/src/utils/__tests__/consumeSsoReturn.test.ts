/**
 * @jest-environment jsdom
 *
 * `consumeSsoReturn` — the commit-free, security-critical kernel of the
 * cross-domain SSO `sso-return` step.
 *
 * Every web seam is injected (storage / location / history / isWeb) so the
 * full CSRF / fragment-strip-order / exchange / dest-restore / loop-breaker
 * sequence is asserted deterministically. The injected-seam tests do not need
 * a DOM; the `default dispatchPopState` suite exercises the real
 * `window.dispatchEvent(new PopStateEvent(...))` path, so this file runs under
 * the jsdom environment.
 */

import { consumeSsoReturn } from '../ssoReturn';
import {
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  ssoAttemptedKey,
} from '../ssoBounce';
import type { SessionLoginResponse } from '../../models/session';

const ORIGIN = 'https://mention.earth';

function makeStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

interface LocationParts {
  hash: string;
  origin: string;
  pathname: string;
  search: string;
}

function makeLocation(parts: Partial<LocationParts> = {}): LocationParts {
  return {
    hash: parts.hash ?? '',
    origin: parts.origin ?? ORIGIN,
    pathname: parts.pathname ?? SSO_CALLBACK_PATH,
    search: parts.search ?? '',
  };
}

function makeHistory() {
  const calls: Array<[unknown, string, string | undefined]> = [];
  return {
    calls,
    replaceState: (data: unknown, unused: string, url?: string | URL | null) => {
      calls.push([data, unused, typeof url === 'string' ? url : undefined]);
    },
  };
}

const SESSION: SessionLoginResponse = {
  sessionId: 'sess-1',
  deviceId: 'dev-1',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: { id: 'u1', username: 'alice' },
};

function okExchange() {
  return { exchangeSsoCode: jest.fn(async () => SESSION) };
}

describe('consumeSsoReturn', () => {
  it('returns null off-web (isWeb false) and does nothing', async () => {
    const oxy = okExchange();
    const storage = makeStorage();
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => false,
      storage,
      location: makeLocation({ hash: '#oxy_sso=ok&code=c&state=s' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
  });

  it('returns null for a non-oxy fragment without touching any flags', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoDestKey(ORIGIN)]: `${ORIGIN}/profile` });
    const history = makeHistory();
    const dispatchPopState = jest.fn();
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#section=about' }),
      history,
      dispatchPopState,
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.has(ssoNoSessionKey(ORIGIN))).toBe(false);
    // No fragment strip for an unrelated fragment.
    expect(history.calls).toHaveLength(0);
    // Nothing was consumed — the dest key must be untouched and no popstate.
    expect(storage.map.get(ssoDestKey(ORIGIN))).toBe(`${ORIGIN}/profile`);
    expect(dispatchPopState).not.toHaveBeenCalled();
  });

  it('sets NO_SESSION and returns null on a "none" outcome', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=none&state=s' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    expect(storage.map.has(ssoStateKey(ORIGIN))).toBe(false);
    expect(storage.map.has(ssoGuardKey(ORIGIN))).toBe(false);
  });

  it('sets BOTH ssoNoSessionKey AND ssoAttemptedKey on a none outcome', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
    const history = makeHistory();
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=none&state=s' }),
      history,
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    // Fragment stripped FIRST (history.replaceState called).
    expect(history.calls.length).toBeGreaterThanOrEqual(1);
    expect(history.calls[0]?.[2]).toBe(SSO_CALLBACK_PATH);
  });

  it('sets NO_SESSION and returns null on an "error" outcome', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=error&state=s' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  it('sets NO_SESSION and returns null on a state mismatch (CSRF)', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 'expected' });
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=ok&code=c&state=forged' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  it('sets NO_SESSION and returns null when ok carries no code', async () => {
    const oxy = okExchange();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=ok&state=s' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  it('exchanges, returns the session, strips the fragment, and removes state/guard keys on ok', async () => {
    const oxy = okExchange();
    const storage = makeStorage({
      [ssoStateKey(ORIGIN)]: 's',
      [ssoGuardKey(ORIGIN)]: String(Date.now()),
    });
    const history = makeHistory();
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({
        hash: '#oxy_sso=ok&code=opaque-code&state=s',
        pathname: '/feed',
        search: '?tab=home',
      }),
      history,
    });

    expect(result).toEqual(SESSION);
    expect(oxy.exchangeSsoCode).toHaveBeenCalledWith('opaque-code');
    expect(storage.map.has(ssoStateKey(ORIGIN))).toBe(false);
    expect(storage.map.has(ssoGuardKey(ORIGIN))).toBe(false);
    expect(storage.map.has(ssoNoSessionKey(ORIGIN))).toBe(false);
    // The ok happy-path must NOT set the attempted-flag — a future sign-out
    // should be able to re-probe the central IdP.
    expect(storage.map.has(ssoAttemptedKey(ORIGIN))).toBe(false);
    // Fragment stripped to pathname+search (the first replaceState).
    expect(history.calls[0]?.[2]).toBe('/feed?tab=home');
  });

  it('strips the fragment BEFORE the exchange (opaque code never lingers)', async () => {
    const order: string[] = [];
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
    const history = {
      replaceState: () => {
        order.push('replaceState');
      },
    };
    const oxy = {
      exchangeSsoCode: jest.fn(async () => {
        order.push('exchange');
        return SESSION;
      }),
    };

    await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({
        hash: '#oxy_sso=ok&code=c&state=s',
        pathname: '/somewhere',
      }),
      history,
    });

    expect(order[0]).toBe('replaceState');
    expect(order).toContain('exchange');
    expect(order.indexOf('replaceState')).toBeLessThan(order.indexOf('exchange'));
  });

  it('sets NO_SESSION, returns null, and calls onExchangeError when the exchange throws', async () => {
    const boom = new Error('exchange failed');
    const oxy = {
      exchangeSsoCode: jest.fn(async () => {
        throw boom;
      }),
    };
    const onExchangeError = jest.fn();
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });

    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=ok&code=c&state=s' }),
      history: makeHistory(),
      onExchangeError,
    });

    expect(result).toBeNull();
    expect(onExchangeError).toHaveBeenCalledWith(boom);
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  it('does not throw when the exchange throws and no onExchangeError hook is given', async () => {
    const oxy = {
      exchangeSsoCode: jest.fn(async () => {
        throw new Error('boom');
      }),
    };
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });

    await expect(
      consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({ hash: '#oxy_sso=ok&code=c&state=s' }),
        history: makeHistory(),
      }),
    ).resolves.toBeNull();
  });

  it('sets NO_SESSION when the exchange resolves without a sessionId', async () => {
    const oxy = {
      exchangeSsoCode: jest.fn(async () => ({ sessionId: '' }) as SessionLoginResponse),
    };
    const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });

    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#oxy_sso=ok&code=c&state=s' }),
      history: makeHistory(),
    });

    expect(result).toBeNull();
    expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
  });

  describe('ok dest restore (soft replaceState + popstate)', () => {
    it('restores a same-origin destination when on the callback path, removes the dest key, dispatches popstate, and does NOT hard-redirect', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/profile?x=1#frag`,
      });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toEqual(SESSION);
      // First replaceState = fragment strip; last = dest restore.
      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/profile?x=1#frag');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      // URL-driven routers must be told the location changed.
      expect(dispatchPopState).toHaveBeenCalledTimes(1);
      // ok preserves the in-memory session — NEVER a hard navigation.
      expect(hardRedirect).not.toHaveBeenCalled();
    });

    it('restores a relative same-origin destination (new URL(dest, origin))', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: '/settings?tab=privacy',
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/settings?tab=privacy');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(hardRedirect).not.toHaveBeenCalled();
    });

    it('falls back to the app root on ok when NO dest is stored (soft replaceState to "/")', async () => {
      const oxy = okExchange();
      const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toEqual(SESSION);
      // First replaceState = fragment strip; last = root fallback.
      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/');
      expect(dispatchPopState).toHaveBeenCalledTimes(1);
      expect(hardRedirect).not.toHaveBeenCalled();
    });

    it('falls back to the app root on ok when the stored dest is cross-origin', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: 'https://evil.example/phish',
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(hardRedirect).not.toHaveBeenCalled();
    });

    it('falls back to the app root on ok when the stored dest is protocol-relative cross-origin', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: '//evil.example/phish',
      });
      const history = makeHistory();

      await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
      });

      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('does not restore dest when NOT on the callback path, but still removes the dest key', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/should-not-apply`,
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: '/already-here',
          search: '?a=1',
        }),
        history,
        hardRedirect,
      });

      // Only the fragment strip ran.
      expect(history.calls).toHaveLength(1);
      expect(history.calls[0]?.[2]).toBe('/already-here?a=1');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(hardRedirect).not.toHaveBeenCalled();
    });
  });

  describe('non-ok hard redirect (never strand on the callback path)', () => {
    it('hard-redirects to the app root on a "none" outcome with NO dest stored', async () => {
      const oxy = okExchange();
      const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=none&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toBeNull();
      expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/`);
      // Soft restore is NOT used on a non-ok outcome.
      expect(dispatchPopState).not.toHaveBeenCalled();
      // Loop-breaker flags must still be set.
      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
      expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    });

    it('hard-redirects to a same-origin dest on a "none" outcome', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/explore?x=1#sec`,
      });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=none&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toBeNull();
      expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/explore?x=1#sec`);
      expect(dispatchPopState).not.toHaveBeenCalled();
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
      expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    });

    it('hard-redirects to a same-origin dest on an "error" outcome', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/feed`,
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=error&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      expect(result).toBeNull();
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/feed`);
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
      expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    });

    it('hard-redirects to the dest on a state mismatch (CSRF)', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 'expected',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/notifications`,
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=forged',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      expect(result).toBeNull();
      expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/notifications`);
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    });

    it('hard-redirects to the app root when ok carries a code but the exchange fails', async () => {
      const boom = new Error('exchange failed');
      const oxy = {
        exchangeSsoCode: jest.fn(async () => {
          throw boom;
        }),
      };
      const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
      const history = makeHistory();
      const hardRedirect = jest.fn();
      const onExchangeError = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
        onExchangeError,
      });

      expect(result).toBeNull();
      expect(onExchangeError).toHaveBeenCalledWith(boom);
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/`);
      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
    });

    it('hard-redirects to the app root when ok carries a code but the exchange returns no sessionId', async () => {
      const oxy = {
        exchangeSsoCode: jest.fn(async () => ({ sessionId: '' }) as SessionLoginResponse),
      };
      const storage = makeStorage({ [ssoStateKey(ORIGIN)]: 's' });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      expect(result).toBeNull();
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/`);
    });

    it('falls back to the app root on a "none" outcome when the dest is cross-origin', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: 'https://evil.example/phish',
      });
      const history = makeHistory();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=none&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
        hardRedirect,
      });

      expect(result).toBeNull();
      // Never honour the cross-origin dest — fall back to the same-origin root.
      expect(hardRedirect).toHaveBeenCalledTimes(1);
      expect(hardRedirect).toHaveBeenCalledWith(`${ORIGIN}/`);
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('does NOT hard-redirect on a "none" outcome when NOT on the callback path', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/should-not-apply`,
      });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=none&state=s',
          pathname: '/explore',
          search: '?a=1',
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toBeNull();
      // Only the fragment strip ran — no navigation off the callback path.
      expect(history.calls).toHaveLength(1);
      expect(history.calls[0]?.[2]).toBe('/explore?a=1');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
      expect(hardRedirect).not.toHaveBeenCalled();
      expect(dispatchPopState).not.toHaveBeenCalled();
    });

    it('does NOT hard-redirect on an "ok" outcome when NOT on the callback path', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/should-not-apply`,
      });
      const history = makeHistory();
      const dispatchPopState = jest.fn();
      const hardRedirect = jest.fn();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: '/feed',
          search: '?tab=home',
        }),
        history,
        dispatchPopState,
        hardRedirect,
      });

      expect(result).toEqual(SESSION);
      // Only the fragment strip ran — no navigation off the callback path.
      expect(history.calls).toHaveLength(1);
      expect(history.calls[0]?.[2]).toBe('/feed?tab=home');
      expect(hardRedirect).not.toHaveBeenCalled();
      expect(dispatchPopState).not.toHaveBeenCalled();
    });
  });

  describe('default dispatchPopState (jsdom)', () => {
    it('fires a real popstate listener after an "ok" dest restore on the callback path', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: '/dashboard?tab=home',
      });
      const history = makeHistory();
      const onPopState = jest.fn();
      window.addEventListener('popstate', onPopState);

      try {
        const result = await consumeSsoReturn(oxy, {
          isWeb: () => true,
          storage,
          location: makeLocation({
            hash: '#oxy_sso=ok&code=c&state=s',
            pathname: SSO_CALLBACK_PATH,
          }),
          history,
          // No injected dispatchPopState — exercise the real default.
        });

        expect(result).toEqual(SESSION);
        const last = history.calls[history.calls.length - 1];
        expect(last?.[2]).toBe('/dashboard?tab=home');
        expect(onPopState).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener('popstate', onPopState);
      }
    });
  });

  describe('default hardRedirect (feature-detected, never throws)', () => {
    it('stays total (resolves null, sets loop-breaker flags) on a non-ok outcome with the real default seam', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: '/dashboard',
      });
      const history = makeHistory();

      // No injected `hardRedirect` — exercise the real default, which reads the
      // jsdom `window.location.replace`. jsdom routes the resulting navigation
      // to its virtual console (a "Not implemented" notice) and does NOT throw,
      // so the function must remain total: resolve null and set the loop-breaker
      // flags. (The injected-`hardRedirect` suite above asserts the precise
      // target argument deterministically.)
      await expect(
        consumeSsoReturn(oxy, {
          isWeb: () => true,
          storage,
          location: makeLocation({
            hash: '#oxy_sso=none&state=s',
            pathname: SSO_CALLBACK_PATH,
          }),
          history,
        }),
      ).resolves.toBeNull();

      expect(storage.map.get(ssoNoSessionKey(ORIGIN))).toBe('1');
      expect(storage.map.get(ssoAttemptedKey(ORIGIN))).toBe('1');
    });
  });
});
