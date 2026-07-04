/**
 * Internal shared-secret gate for server-to-server endpoints.
 *
 * Extracted from `sso.controller.ts` (pure move, no behaviour change) so BOTH
 * the central SSO `POST /sso/code` endpoint AND the new device-first
 * `POST /auth/device/resolve` endpoint reuse ONE authoritative gate. Both are
 * called only by first-party internal callers (the auth.oxy.so worker / IdP
 * chooser) and must never be reachable by the public.
 *
 * Fails closed: when `SSO_INTERNAL_SECRET` is unset the route is effectively
 * disabled (an empty/absent configured secret is never accepted), and the
 * `X-Oxy-Internal` header must match it in constant time.
 */

import * as crypto from 'crypto';
import type { Request } from 'express';
import { logger } from './logger';

/** Constant-time string equality (length-tolerant; no early-exit leak). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // Compare against self to keep the comparison cost data-independent, then
    // return false. Length is not itself a secret here.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Validate the internal shared-secret header. Returns true only when
 * `SSO_INTERNAL_SECRET` is configured AND the `X-Oxy-Internal` header matches it
 * in constant time. When the env var is unset we fail closed (the route is
 * effectively disabled) — we never accept an empty/absent secret.
 */
export function hasValidInternalSecret(req: Request): boolean {
  const expected = process.env.SSO_INTERNAL_SECRET;
  if (typeof expected !== 'string' || expected.length === 0) {
    logger.error('Internal-secret-gated route called but SSO_INTERNAL_SECRET is not configured');
    return false;
  }
  const provided = req.headers['x-oxy-internal'];
  if (typeof provided !== 'string' || provided.length === 0) {
    return false;
  }
  return timingSafeStringEqual(provided, expected);
}
