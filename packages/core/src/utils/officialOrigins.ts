/**
 * Official first-party web origin allowlist — shared by hub-ticket issuance,
 * OAuth redirect validation, and cross-origin session restore.
 */

import { CENTRAL_IDP_APEX } from './authWebUrl';
import { registrableApex } from './registrableApex';

/** Official first-party registrable apexes (mirrors API trusted origins). */
const OFFICIAL_APEXES = new Set([
  'oxy.so',
  'fairco.in',
  'mention.earth',
  'homiio.com',
  'alia.onl',
  'syra.fm',
  'allo.you',
  'tnp.network',
  'moovo.now',
  'mercaria.co',
]);

export function buildIdpHubOrigin(): string {
  return `https://auth.${CENTRAL_IDP_APEX}`;
}

/** Whether the current web origin is the central IdP hub (`auth.oxy.so`). */
export function isIdpHubOrigin(): boolean {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  const location = (globalThis as { location?: Location }).location;
  if (!location) {
    return false;
  }
  try {
    const { hostname } = new URL(location.href);
    return hostname === `auth.${CENTRAL_IDP_APEX}`;
  } catch {
    return false;
  }
}

/**
 * Whether an origin is a loopback / local-dev origin (`localhost`, `127.0.0.1`,
 * or `[::1]` on any port, http or https). Local dev must never be bounced to a
 * hosted IdP for cross-origin session restore.
 */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/** Whether an origin belongs to the official Oxy web ecosystem. */
export function isOfficialWebOrigin(origin: string): boolean {
  if (isLoopbackOrigin(origin)) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (host === CENTRAL_IDP_APEX || host.endsWith(`.${CENTRAL_IDP_APEX}`)) {
      return true;
    }
    const apex = registrableApex(host);
    return apex != null && OFFICIAL_APEXES.has(apex);
  } catch {
    return false;
  }
}

/** Normalize and validate a return URL against official origins. Returns origin only. */
export function normalizeOfficialReturnOrigin(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (!isOfficialWebOrigin(parsed.origin)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** Validate a hub-sync return URL; returns the full normalized URL string. */
export function parseHubSyncReturnUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (!isOfficialWebOrigin(parsed.origin)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Build auth.oxy.so/sync redirect URL with a one-time hub ticket. */
export function buildHubSyncUrl(ticket: string, returnUrl?: string): string {
  const url = new URL('/sync', buildIdpHubOrigin());
  url.searchParams.set('ticket', ticket);
  if (returnUrl) {
    url.searchParams.set('return', returnUrl);
  }
  return url.toString();
}

/** @deprecated Use {@link isOfficialWebOrigin}. */
export const isAllowedDeviceJoinOrigin = isOfficialWebOrigin;
