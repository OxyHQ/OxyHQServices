/**
 * `oxy_device` cookie spec — ONE authoritative definition.
 *
 * The device cookie carries a random 256-bit secret (base64url) that maps to a
 * `DeviceSession` via its SHA-256 (`DeviceSession.cookieKeyHash`). It is the
 * first-party anchor for device-first session bootstrap:
 *  - `Domain=.oxy.so` so every `*.oxy.so` first-party surface (api, auth, apps)
 *    shares one device identity, and the auth.oxy.so IdP chooser can read it
 *    first-party.
 *  - `SameSite=Lax` so it rides top-level navigations (the cross-apex bootstrap
 *    hop) and same-site fetches (the `*.oxy.so` web-session fast path), but not
 *    cross-site sub-requests.
 *  - `HttpOnly` + `Secure` so it is never readable from JS (XSS-proof) and only
 *    travels over HTTPS.
 *  - 400-day sliding `Max-Age`, re-set on every bootstrap hop.
 *
 * The secret is NEVER the deviceId — possessing the cookie reveals nothing about
 * the device set, and only its hash is stored server-side.
 *
 * Localhost dev: `Domain` and `Secure` are omitted (http host-only) so a local
 * dev server can exercise the flow without TLS and without a `.oxy.so` domain.
 */

import type { Request, Response } from 'express';
import { isProduction } from '../config/env';

/** Cookie name. */
export const DEVICE_COOKIE_NAME = 'oxy_device';

/** Default parent domain — every `*.oxy.so` surface shares one device identity. */
export const DEFAULT_DEVICE_COOKIE_DOMAIN = '.oxy.so';

/** 400-day sliding lifetime in seconds (matches the Max-Age header value). */
export const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** Same lifetime in milliseconds (express `res.cookie` takes `maxAge` in ms). */
export const DEVICE_COOKIE_MAX_AGE_MS = DEVICE_COOKIE_MAX_AGE_SECONDS * 1000;

export interface DeviceCookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  domain?: string;
  path: string;
  maxAge: number;
}

/**
 * Build the `oxy_device` cookie attributes. Production: `Secure` + parent-domain
 * `Domain` (env `DEVICE_COOKIE_DOMAIN` override, default `.oxy.so`). Dev/local:
 * host-only, no `Secure`, so http loopback works.
 */
export function buildDeviceCookieOptions(): DeviceCookieOptions {
  const prod = isProduction();
  const domain = process.env.DEVICE_COOKIE_DOMAIN || DEFAULT_DEVICE_COOKIE_DOMAIN;
  return {
    httpOnly: true,
    secure: prod,
    sameSite: 'lax',
    ...(prod ? { domain } : {}),
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  };
}

/**
 * (Re-)set the device cookie on the response with the fresh sliding expiry.
 *
 * SECURITY NOTE (re: CodeQL "clear text storage of sensitive information"):
 * `secret` is a random 256-bit, opaque, bearer-equivalent token — NOT user PII.
 * The cookie IS its transport, hardened via `buildDeviceCookieOptions()`
 * (HttpOnly so JS can never read it, Secure so it only rides HTTPS, SameSite=Lax).
 * Server-side it is persisted ONLY as its SHA-256 (`DeviceSession.cookieKeyHash`)
 * — the raw value is never written to any document, cache, or log, and possessing
 * the cookie reveals nothing about the deviceId. Same posture as the rotating
 * refresh token (hash-only storage). There is no cleartext-at-rest to encrypt:
 * the value is already the credential.
 */
export function setDeviceCookie(res: Response, secret: string): void {
  res.cookie(DEVICE_COOKIE_NAME, secret, buildDeviceCookieOptions());
}

/**
 * Read the raw `oxy_device` cookie secret from a request. Prefers `req.cookies`
 * (cookie-parser) and falls back to parsing the raw `Cookie` header so the
 * helper works in unit tests that mount a bare router. Returns `undefined` when
 * absent/empty.
 */
export function readDeviceCookie(req: Request): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, unknown> }).cookies;
  const fromParser = parsed?.[DEVICE_COOKIE_NAME];
  if (typeof fromParser === 'string' && fromParser.length > 0) {
    return fromParser;
  }

  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length === 0) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== DEVICE_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    return value.length > 0 ? value : undefined;
  }
  return undefined;
}
