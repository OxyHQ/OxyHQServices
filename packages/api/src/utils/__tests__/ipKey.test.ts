import type { Request } from 'express';
import { hashedIpKey } from '../ipKey';

function reqWithIp(ip: string | undefined): Request {
  return { ip } as Request;
}

describe('hashedIpKey', () => {
  const OLD_SALT = process.env.DEVICE_ID_SALT;
  beforeEach(() => {
    process.env.DEVICE_ID_SALT = 'test-salt-0123456789abcdef';
  });
  afterAll(() => {
    process.env.DEVICE_ID_SALT = OLD_SALT;
  });

  it('is deterministic for the same IP', () => {
    expect(hashedIpKey(reqWithIp('203.0.113.7'))).toBe(hashedIpKey(reqWithIp('203.0.113.7')));
  });

  it('differs across IPs', () => {
    expect(hashedIpKey(reqWithIp('203.0.113.7'))).not.toBe(hashedIpKey(reqWithIp('203.0.113.8')));
  });

  it('never contains the raw IP and is fixed-length hex', () => {
    const key = hashedIpKey(reqWithIp('203.0.113.7'));
    expect(key).not.toContain('203.0.113.7');
    expect(key).toMatch(/^[a-f0-9]{24}$/);
  });

  it('changes with the salt', () => {
    const a = hashedIpKey(reqWithIp('203.0.113.7'));
    process.env.DEVICE_ID_SALT = 'other-salt-0123456789abcdef';
    expect(hashedIpKey(reqWithIp('203.0.113.7'))).not.toBe(a);
  });

  it('buckets IPv6 addresses (same /56 → same key)', () => {
    const a = hashedIpKey(reqWithIp('2001:db8:0:1::1'));
    const b = hashedIpKey(reqWithIp('2001:db8:0:1::2'));
    expect(a).toBe(b);
  });

  it('returns "unknown" when no IP is resolvable', () => {
    expect(hashedIpKey(reqWithIp(undefined))).toBe('unknown');
  });
});
