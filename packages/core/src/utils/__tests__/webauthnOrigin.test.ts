/**
 * `isOxyRpOrigin()` — client-side WebAuthn relying-party origin guard.
 *
 * Runs under the `node` test environment, where `globalThis.location` is
 * genuinely absent by default (mirroring native/SSR). Each case defines a fake
 * `location` with the host under test and restores the original afterwards.
 */
import { isOxyRpOrigin } from '../webauthnOrigin';

describe('isOxyRpOrigin', () => {
  const originalLocation = globalThis.location;

  const setHostname = (hostname: unknown): void => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: hostname === undefined ? undefined : { hostname },
    });
  };

  afterEach(() => {
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('returns true on the apex oxy.so', () => {
    setHostname('oxy.so');
    expect(isOxyRpOrigin()).toBe(true);
  });

  it('returns true on an oxy.so subdomain', () => {
    setHostname('accounts.oxy.so');
    expect(isOxyRpOrigin()).toBe(true);
  });

  it('returns true on a deep oxy.so subdomain', () => {
    setHostname('sub.accounts.oxy.so');
    expect(isOxyRpOrigin()).toBe(true);
  });

  it('returns true on loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
      setHostname(host);
      expect(isOxyRpOrigin()).toBe(true);
    }
  });

  it('is case-insensitive on the host', () => {
    setHostname('Accounts.OXY.So');
    expect(isOxyRpOrigin()).toBe(true);
  });

  it('returns false on an unrelated origin', () => {
    setHostname('evil.com');
    expect(isOxyRpOrigin()).toBe(false);
  });

  it('returns false on a look-alike suffix without the dot boundary', () => {
    setHostname('evil-oxy.so');
    expect(isOxyRpOrigin()).toBe(false);
  });

  it('returns false when oxy.so is only a subdomain label of an attacker apex', () => {
    setHostname('oxy.so.evil.com');
    expect(isOxyRpOrigin()).toBe(false);
  });

  it('returns false when there is no location (native / SSR)', () => {
    setHostname(undefined);
    expect(isOxyRpOrigin()).toBe(false);
  });

  it('returns false when the hostname is not a string', () => {
    setHostname(123);
    expect(isOxyRpOrigin()).toBe(false);
  });

  it('returns false when the hostname is empty', () => {
    setHostname('');
    expect(isOxyRpOrigin()).toBe(false);
  });
});
