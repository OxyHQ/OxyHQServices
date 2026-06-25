/**
 * Auto-detect of `auth.<rp-apex>` from `window.location` for the Clerk-style
 * multi-domain FAPI setup. The IdP backend independently derives `iss` and
 * the FedCM manifest from the request host, so the only contract the SDK
 * needs to honour is: build URLs against the same host the page is on,
 * one subdomain over.
 *
 * Ported verbatim from packages/auth-sdk/__tests__/utils/fapiAutoDetect.test.ts
 * plus Public Suffix List regression cases that are unique to the core
 * implementation's registrable-apex guard.
 */

import { autoDetectAuthWebUrl, registrableApex } from '../fapiAutoDetect';

function loc(hostname: string, protocol = 'https:'): Pick<Location, 'hostname' | 'protocol'> {
  return { hostname, protocol };
}

describe('autoDetectAuthWebUrl', () => {
  describe('returns auth.<apex> for public hostnames', () => {
    it('derives from the apex itself', () => {
      expect(autoDetectAuthWebUrl(loc('mention.earth'))).toBe('https://auth.mention.earth');
    });

    it('strips one leading subdomain', () => {
      expect(autoDetectAuthWebUrl(loc('www.mention.earth'))).toBe('https://auth.mention.earth');
      expect(autoDetectAuthWebUrl(loc('app.alia.onl'))).toBe('https://auth.alia.onl');
    });

    it('strips multiple leading subdomains down to the last two labels', () => {
      // The heuristic is "last two labels" — fine for our use case because
      // the IdP itself validates the request host. Deeply-nested hostnames
      // resolve to the trailing two-label apex.
      expect(autoDetectAuthWebUrl(loc('deep.app.homiio.com'))).toBe('https://auth.homiio.com');
    });

    it('honours the request protocol so dev http stays http', () => {
      expect(autoDetectAuthWebUrl(loc('staging.example.test', 'http:'))).toBe(
        'http://auth.example.test'
      );
    });
  });

  describe('returns current origin when already on the IdP', () => {
    it('keeps everything same-origin instead of hopping to a sibling IdP', () => {
      expect(autoDetectAuthWebUrl(loc('auth.mention.earth'))).toBe('https://auth.mention.earth');
      expect(autoDetectAuthWebUrl(loc('auth.oxy.so'))).toBe('https://auth.oxy.so');
    });
  });

  describe('returns undefined where auto-detect would be wrong', () => {
    it('skips localhost and 127.0.0.1 (dev)', () => {
      expect(autoDetectAuthWebUrl(loc('localhost', 'http:'))).toBeUndefined();
      expect(autoDetectAuthWebUrl(loc('127.0.0.1', 'http:'))).toBeUndefined();
    });

    it('skips IPv4 literals', () => {
      expect(autoDetectAuthWebUrl(loc('192.168.1.10'))).toBeUndefined();
      expect(autoDetectAuthWebUrl(loc('10.0.0.1'))).toBeUndefined();
    });

    it('skips IPv6 literals (bracketed)', () => {
      expect(autoDetectAuthWebUrl(loc('[::1]'))).toBeUndefined();
    });

    it('skips single-label hostnames', () => {
      expect(autoDetectAuthWebUrl(loc('intranet'))).toBeUndefined();
    });

    it('skips unknown protocols', () => {
      expect(autoDetectAuthWebUrl({ hostname: 'mention.earth', protocol: 'file:' })).toBeUndefined();
      expect(autoDetectAuthWebUrl({ hostname: 'mention.earth', protocol: 'ftp:' })).toBeUndefined();
    });

    it('skips empty/missing hostnames', () => {
      expect(autoDetectAuthWebUrl(loc(''))).toBeUndefined();
    });

    it('returns undefined when no location is available (SSR / non-browser)', () => {
      expect(autoDetectAuthWebUrl(undefined)).toBeUndefined();
    });
  });

  describe('uses the Public Suffix List for registrable apex detection', () => {
    it('derives from the registrable domain under multi-part public suffixes', () => {
      expect(autoDetectAuthWebUrl(loc('foo.co.uk'))).toBe('https://auth.foo.co.uk');
      expect(autoDetectAuthWebUrl(loc('shop.com.au'))).toBe('https://auth.shop.com.au');
      expect(autoDetectAuthWebUrl(loc('shop.victim.com.tr'))).toBe('https://auth.victim.com.tr');
    });

    it('derives from the registrable domain under private hosted suffixes', () => {
      expect(autoDetectAuthWebUrl(loc('honest.github.io'))).toBe('https://auth.honest.github.io');
      expect(autoDetectAuthWebUrl(loc('app.victim.pages.dev'))).toBe(
        'https://auth.victim.pages.dev'
      );
      expect(autoDetectAuthWebUrl(loc('site.victim.netlify.app'))).toBe(
        'https://auth.victim.netlify.app'
      );
    });

    it('returns undefined for bare public and private suffixes', () => {
      expect(autoDetectAuthWebUrl(loc('co.uk'))).toBeUndefined();
      expect(autoDetectAuthWebUrl(loc('github.io'))).toBeUndefined();
      expect(autoDetectAuthWebUrl(loc('pages.dev'))).toBeUndefined();
      expect(autoDetectAuthWebUrl(loc('netlify.app'))).toBeUndefined();
    });
  });

  // Regression guard: the refactor to delegate host handling to `registrableApex`
  // must not change any of the pre-existing return values.
  describe('regression — unchanged values after registrableApex extraction', () => {
    const cases: Array<[string, string | undefined]> = [
      ['mention.earth', 'https://auth.mention.earth'],
      ['www.mention.earth', 'https://auth.mention.earth'],
      ['deep.app.homiio.com', 'https://auth.homiio.com'],
      ['auth.oxy.so', 'https://auth.oxy.so'],
      ['auth.mention.earth', 'https://auth.mention.earth'],
      ['localhost', undefined],
      ['192.168.1.10', undefined],
      ['[::1]', undefined],
      ['intranet', undefined],
      ['', undefined],
      ['foo.co.uk', 'https://auth.foo.co.uk'],
    ];
    it.each(cases)('autoDetectAuthWebUrl(%s) === %s', (hostname, expected) => {
      const protocol = hostname === 'localhost' || hostname === '[::1]' ? 'http:' : 'https:';
      expect(autoDetectAuthWebUrl(loc(hostname, protocol))).toBe(expected);
    });
  });
});

describe('registrableApex', () => {
  it('returns the eTLD+1 for a normal two-label host', () => {
    expect(registrableApex('mention.earth')).toBe('mention.earth');
  });

  it('strips subdomains down to the trailing two labels', () => {
    expect(registrableApex('www.mention.earth')).toBe('mention.earth');
    expect(registrableApex('deep.app.homiio.com')).toBe('homiio.com');
  });

  it('lower-cases the input', () => {
    expect(registrableApex('WWW.Mention.EARTH')).toBe('mention.earth');
  });

  it('returns the eTLD+1 for hosts under multi-part public suffixes', () => {
    expect(registrableApex('foo.co.uk')).toBe('foo.co.uk');
    expect(registrableApex('www.foo.co.uk')).toBe('foo.co.uk');
    expect(registrableApex('shop.victim.com.tr')).toBe('victim.com.tr');
  });

  it('returns the eTLD+1 for hosts under private hosted suffixes', () => {
    expect(registrableApex('honest.github.io')).toBe('honest.github.io');
    expect(registrableApex('app.victim.pages.dev')).toBe('victim.pages.dev');
    expect(registrableApex('site.victim.netlify.app')).toBe('victim.netlify.app');
  });

  it('returns null for bare public and private suffixes', () => {
    expect(registrableApex('co.uk')).toBeNull();
    expect(registrableApex('github.io')).toBeNull();
    expect(registrableApex('pages.dev')).toBeNull();
    expect(registrableApex('netlify.app')).toBeNull();
  });

  it('returns null for IPv4 literals', () => {
    expect(registrableApex('192.168.1.10')).toBeNull();
    expect(registrableApex('10.0.0.1')).toBeNull();
  });

  it('returns null for IPv6 literals and hosts carrying a port', () => {
    expect(registrableApex('[::1]')).toBeNull();
    expect(registrableApex('mention.earth:3000')).toBeNull();
  });

  it('returns null for single-label hosts', () => {
    expect(registrableApex('intranet')).toBeNull();
    expect(registrableApex('localhost')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(registrableApex('')).toBeNull();
  });
});
