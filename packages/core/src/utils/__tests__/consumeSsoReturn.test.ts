/**
 * `consumeSsoReturn` — the commit-free, security-critical kernel of the
 * cross-domain SSO `sso-return` step.
 *
 * Every web seam is injected (storage / location / history / isWeb) so the
 * full CSRF / fragment-strip-order / exchange / dest-restore / loop-breaker
 * sequence is asserted deterministically without a DOM.
 */

import { consumeSsoReturn } from '../ssoReturn';
import {
  SSO_CALLBACK_PATH,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
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
    const storage = makeStorage();
    const history = makeHistory();
    const result = await consumeSsoReturn(oxy, {
      isWeb: () => true,
      storage,
      location: makeLocation({ hash: '#section=about' }),
      history,
    });

    expect(result).toBeNull();
    expect(oxy.exchangeSsoCode).not.toHaveBeenCalled();
    expect(storage.map.has(ssoNoSessionKey(ORIGIN))).toBe(false);
    // No fragment strip for an unrelated fragment.
    expect(history.calls).toHaveLength(0);
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
    expect(storage.map.has(ssoStateKey(ORIGIN))).toBe(false);
    expect(storage.map.has(ssoGuardKey(ORIGIN))).toBe(false);
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
  });

  describe('dest restore', () => {
    it('restores a same-origin destination when on the callback path and removes the dest key', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/profile?x=1#frag`,
      });
      const history = makeHistory();

      const result = await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: SSO_CALLBACK_PATH,
        }),
        history,
      });

      expect(result).toEqual(SESSION);
      // First replaceState = fragment strip; last = dest restore.
      const last = history.calls[history.calls.length - 1];
      expect(last?.[2]).toBe('/profile?x=1#frag');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('restores a relative same-origin destination (new URL(dest, origin))', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: '/settings?tab=privacy',
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
      expect(last?.[2]).toBe('/settings?tab=privacy');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('rejects a cross-origin (attacker-planted) destination but still removes the dest key', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: 'https://evil.example/phish',
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

      // Only the fragment-strip replaceState should have run — no dest restore.
      expect(history.calls).toHaveLength(1);
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('rejects a protocol-relative cross-origin destination', async () => {
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

      expect(history.calls).toHaveLength(1);
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });

    it('does not restore dest when NOT on the callback path, but still removes the dest key', async () => {
      const oxy = okExchange();
      const storage = makeStorage({
        [ssoStateKey(ORIGIN)]: 's',
        [ssoDestKey(ORIGIN)]: `${ORIGIN}/should-not-apply`,
      });
      const history = makeHistory();

      await consumeSsoReturn(oxy, {
        isWeb: () => true,
        storage,
        location: makeLocation({
          hash: '#oxy_sso=ok&code=c&state=s',
          pathname: '/already-here',
          search: '?a=1',
        }),
        history,
      });

      // Only the fragment strip ran.
      expect(history.calls).toHaveLength(1);
      expect(history.calls[0]?.[2]).toBe('/already-here?a=1');
      expect(storage.map.has(ssoDestKey(ORIGIN))).toBe(false);
    });
  });
});
