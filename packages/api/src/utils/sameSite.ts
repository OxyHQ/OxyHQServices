/**
 * Shared "same-site trusted request" predicate.
 *
 * True when the request carries an `Origin` that is (a) on the trusted CREDENTIALED
 * lane (first-party / internal / system / official app, or an http loopback dev
 * origin) AND (b) same-site with the API host — i.e. it shares the API host's
 * registrable apex (a `*.oxy.so` sibling), or, for IP-literal / single-label
 * hosts that have no registrable apex, it is the exact same host.
 *
 * Used by the device-first surface for two same-site fast paths that ride the
 * ambient `oxy_device` cookie: `POST /auth/device/web-session` and the login
 * flows that MINT the device cookie for a first-ever same-site sign-in. A
 * third-party-lane or cross-apex origin is never same-site-trusted.
 *
 * Uses Express `req.hostname` (strips the port, handles IPv6 literals like
 * `[::1]:3000`) rather than a manual `Host` split.
 */

import type { Request } from 'express';
import { registrableApex } from '@oxyhq/core/server';
import { normaliseOrigin, isLoopbackOrigin } from './origin';
import { isTrustedOrigin } from '../config/dynamicOriginRegistry';

export function isSameSiteTrustedRequest(req: Request): boolean {
  const originRaw = req.headers.origin;
  if (typeof originRaw !== 'string' || originRaw.length === 0) return false;
  const origin = normaliseOrigin(originRaw);
  if (!origin) return false;

  // Trusted lane = credentialed first-party/internal/official app origins, plus
  // http loopback dev origins (which `isTrustedOrigin` deliberately excludes).
  if (!(isTrustedOrigin(origin) || isLoopbackOrigin(origin))) return false;

  // Loopback dev origins are same-site by fiat (no meaningful apex to compare).
  if (isLoopbackOrigin(origin)) return true;

  const apiHost = req.hostname;
  if (typeof apiHost !== 'string' || apiHost.length === 0) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }

  const apiApex = registrableApex(apiHost);
  const originApex = registrableApex(originHost);
  if (apiApex && originApex) {
    return apiApex === originApex;
  }
  // No registrable apex (IP literal / single-label host): same-site ONLY on an
  // exact host match.
  return originHost.toLowerCase() === apiHost.toLowerCase();
}
