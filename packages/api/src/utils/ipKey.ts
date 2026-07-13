import crypto from 'crypto';
import net from 'net';
import type { Request } from 'express';

/**
 * IPv6 hosts are typically handed an entire /64 (often a /56), so a single host
 * can rotate through an enormous address space and evade a per-address rate
 * limit. We therefore bucket IPv6 to its /56 prefix BEFORE hashing. IPv4 (and
 * IPv4-mapped IPv6) addresses are used as-is — each is a single host.
 *
 * NOTE: express-rate-limit only exposes an `ipKeyGenerator` helper for this from
 * v8 onwards; this package is pinned to v7, so the /56 masking is implemented
 * here rather than pulling a major-version bump of a security-critical dependency
 * (and its rate-limit-redis compatibility) into an unrelated privacy change.
 */
const IPV6_SUBNET_BITS = 56;

/** Expand an IPv6 literal (handling `::` and embedded IPv4) to 8 numeric hextets, or null if unparseable. */
function ipv6Hextets(ip: string): number[] | null {
  let addr = ip;
  const zone = addr.indexOf('%');
  if (zone !== -1) {
    addr = addr.slice(0, zone);
  }

  // Embedded IPv4 tail (e.g. `::ffff:203.0.113.7`) → fold the dotted quad into two hextets.
  const lastColon = addr.lastIndexOf(':');
  if (lastColon !== -1 && addr.slice(lastColon + 1).includes('.')) {
    const v4 = addr.slice(lastColon + 1);
    if (!net.isIPv4(v4)) {
      return null;
    }
    const octets = v4.split('.').map((part) => Number.parseInt(part, 10));
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = addr.split('::');
  if (halves.length > 2) {
    return null;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const missing = 8 - (head.length + tail.length);
    if (missing < 0) {
      return null;
    }
    groups = [...head, ...new Array(missing).fill('0'), ...tail];
  }
  if (groups.length !== 8) {
    return null;
  }
  const hextets = groups.map((group) => Number.parseInt(group || '0', 16));
  if (hextets.some((value) => Number.isNaN(value) || value < 0 || value > 0xffff)) {
    return null;
  }
  return hextets;
}

/** Mask an IPv6 address to its /{bits} prefix, returned as a canonical hex string. */
function maskIPv6(ip: string, bits: number): string {
  const hextets = ipv6Hextets(ip);
  if (!hextets) {
    return ip;
  }
  const masked = hextets.map((hextet, index) => {
    const groupStart = index * 16;
    if (groupStart >= bits) {
      return 0;
    }
    const keepBits = Math.min(16, bits - groupStart);
    const mask = keepBits >= 16 ? 0xffff : (0xffff << (16 - keepBits)) & 0xffff;
    return hextet & mask;
  });
  return `${masked.map((hextet) => hextet.toString(16)).join(':')}/${bits}`;
}

/**
 * Privacy-preserving rate-limit key: the raw client IP must never reach a store
 * at rest (Redis included). IPv6 is bucketed to its /56 prefix BEFORE hashing so
 * a single v6 host can't rotate through its allocation to mint fresh keys; the
 * result is then HMAC'd with the server-side DEVICE_ID_SALT (namespaced with
 * 'rl|' so rate-limit keys can never be correlated with deviceId derivations
 * that use the same salt). Returns 'unknown' when no IP is resolvable.
 */
export function hashedIpKey(req: Request): string {
  const ip = req.ip;
  if (!ip) {
    return 'unknown';
  }
  const normalized =
    net.isIPv6(ip) && !ip.startsWith('::ffff:') ? maskIPv6(ip, IPV6_SUBNET_BITS) : ip;
  const salt = process.env.DEVICE_ID_SALT ?? '';
  return crypto.createHmac('sha256', salt).update(`rl|${normalized}`).digest('hex').slice(0, 24);
}
