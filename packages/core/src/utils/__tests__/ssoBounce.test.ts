/**
 * Central SSO bounce helpers — per-origin key builders, the bounce URL builder,
 * the central-IdP predicate, and the self-healing guard.
 *
 * These are a wire/storage contract shared with the IdP and every consumer, so
 * the exact key strings, the 30s TTL, and the same-origin / parse-failure
 * behaviour are all asserted explicitly.
 */

import {
  SSO_CALLBACK_PATH,
  SSO_GUARD_TTL_MS,
  ssoStateKey,
  ssoGuardKey,
  ssoDestKey,
  ssoNoSessionKey,
  buildSsoBounceUrl,
  isCentralIdPOrigin,
  guardActive,
} from '../ssoBounce';
import { CENTRAL_AUTH_URL } from '../authWebUrl';

describe('SSO bounce constants', () => {
  it('pins the callback path and guard TTL (wire/storage contract)', () => {
    expect(SSO_CALLBACK_PATH).toBe('/__oxy/sso-callback');
    expect(SSO_GUARD_TTL_MS).toBe(30_000);
  });
});

describe('per-origin key builders', () => {
  const origin = 'https://mention.earth';

  it('builds the exact contracted key strings', () => {
    expect(ssoStateKey(origin)).toBe('oxy_sso_state:https://mention.earth');
    expect(ssoGuardKey(origin)).toBe('oxy_sso_guard:https://mention.earth');
    expect(ssoDestKey(origin)).toBe('oxy_sso_dest:https://mention.earth');
    expect(ssoNoSessionKey(origin)).toBe('oxy_sso_no_session:https://mention.earth');
  });

  it('namespaces keys per origin so two RPs never collide', () => {
    expect(ssoStateKey('https://a.test')).not.toBe(ssoStateKey('https://b.test'));
  });
});

describe('buildSsoBounceUrl', () => {
  const origin = 'https://mention.earth';

  it('targets the central IdP /sso with all required params (default base)', () => {
    const url = new URL(buildSsoBounceUrl(origin, 'state-123'));

    expect(url.origin).toBe('https://auth.oxy.so');
    expect(url.pathname).toBe('/sso');
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('client_id')).toBe(origin);
    expect(url.searchParams.get('return_to')).toBe(origin + SSO_CALLBACK_PATH);
    expect(url.searchParams.get('state')).toBe('state-123');
  });

  it('honours an explicit authWebUrl override (staging IdP)', () => {
    const url = new URL(
      buildSsoBounceUrl(origin, 'state-xyz', 'https://auth.mention.earth'),
    );

    expect(url.origin).toBe('https://auth.mention.earth');
    expect(url.pathname).toBe('/sso');
    expect(url.searchParams.get('client_id')).toBe(origin);
    expect(url.searchParams.get('state')).toBe('state-xyz');
  });

  it('falls back to the central default for an empty override', () => {
    const url = new URL(buildSsoBounceUrl(origin, 's', undefined));
    expect(url.origin).toBe('https://auth.oxy.so');
  });
});

describe('isCentralIdPOrigin', () => {
  it('matches the central IdP origin', () => {
    expect(isCentralIdPOrigin('https://auth.oxy.so')).toBe(true);
    expect(isCentralIdPOrigin(CENTRAL_AUTH_URL)).toBe(true);
  });

  it('normalises a trailing-slash / path candidate via URL origin', () => {
    expect(isCentralIdPOrigin('https://auth.oxy.so/')).toBe(true);
    expect(isCentralIdPOrigin('https://auth.oxy.so/sso')).toBe(true);
  });

  it('rejects a non-central origin', () => {
    expect(isCentralIdPOrigin('https://mention.earth')).toBe(false);
    expect(isCentralIdPOrigin('https://auth.mention.earth')).toBe(false);
  });

  it('returns false for an unparseable candidate', () => {
    expect(isCentralIdPOrigin('not a url')).toBe(false);
    expect(isCentralIdPOrigin('')).toBe(false);
  });
});

describe('guardActive', () => {
  const origin = 'https://mention.earth';

  function storageWith(value: string | null): Pick<Storage, 'getItem'> {
    return { getItem: (key: string) => (key === ssoGuardKey(origin) ? value : null) };
  }

  it('is active for a present, fresh guard', () => {
    const now = 1_000_000;
    const storage = storageWith(String(now - 1_000)); // 1s old, well under TTL
    expect(guardActive(storage, origin, now)).toBe(true);
  });

  it('is inactive for a present but stale guard (older than TTL)', () => {
    const now = 1_000_000;
    const storage = storageWith(String(now - SSO_GUARD_TTL_MS - 1));
    expect(guardActive(storage, origin, now)).toBe(false);
  });

  it('is inactive for a guard exactly at the TTL boundary (strict <)', () => {
    const now = 1_000_000;
    const storage = storageWith(String(now - SSO_GUARD_TTL_MS));
    expect(guardActive(storage, origin, now)).toBe(false);
  });

  it('is inactive when the guard is missing', () => {
    expect(guardActive(storageWith(null), origin, 1_000_000)).toBe(false);
  });

  it('is inactive for an empty-string guard value', () => {
    expect(guardActive(storageWith(''), origin, 1_000_000)).toBe(false);
  });

  it('is inactive for a malformed (non-numeric) guard value', () => {
    expect(guardActive(storageWith('not-a-number'), origin, 1_000_000)).toBe(false);
  });

  it('is inactive (never throws) when getItem itself throws', () => {
    const throwing: Pick<Storage, 'getItem'> = {
      getItem: () => {
        throw new Error('storage locked');
      },
    };
    expect(guardActive(throwing, origin, 1_000_000)).toBe(false);
  });

  it('defaults now to Date.now() when omitted', () => {
    const storage = storageWith(String(Date.now() - 500));
    expect(guardActive(storage, origin)).toBe(true);
  });
});
