/**
 * `registrableApex` — the eTLD+1 host kernel (Public Suffix List aware).
 *
 * The client `autoDetectAuthWebUrl` helper was removed in the device-first
 * cutover; only the registrable-apex kernel survives (used by the api SSO
 * surface + the IdP). These cases lock its Public-Suffix-List behaviour.
 */

import { registrableApex } from '../registrableApex';

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
