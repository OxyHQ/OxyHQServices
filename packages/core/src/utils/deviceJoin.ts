/**
 * Cross-origin device join — ONE top-level redirect to auth.oxy.so.
 *
 * Official first-party web apps with no local `deviceId` redirect to
 * `/device/join` on the IdP hub. The hub returns the canonical device id
 * (and secret, in the URL fragment) so every origin shares the same
 * `device:<deviceId>` socket room. No iframes, no silent OAuth, no handoff codes.
 */

import { CENTRAL_IDP_APEX } from './authWebUrl';
import { registrableApex } from './registrableApex';
import { extractErrorStatus } from './errorUtils';
import type { AuthStateStore, PersistedAuthState } from '../session/authStateStore';

/** One join redirect attempt per tab navigation (sessionStorage). */
export const OXY_DEVICE_JOIN_ATTEMPTED_KEY = 'oxy.device_join_attempted';

/** sessionStorage bridge between sync URL capture and async auth store persist. */
export const OXY_DEVICE_JOIN_PENDING_KEY = 'oxy.device_join_pending';

/** Fragment keys returned by auth.oxy.so/device/join. */
export const DEVICE_JOIN_FRAGMENT_DEVICE_ID = 'oxy_device';
export const DEVICE_JOIN_FRAGMENT_DEVICE_SECRET = 'device_secret';

/** Official first-party registrable apexes (mirrors API trusted origins). */
const JOIN_OFFICIAL_APEXES = new Set([
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

export interface DeviceJoinFragment {
  deviceId: string;
  deviceSecret: string;
}

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

/** Validate a device-join return URL against allowed first-party origins. */
export function parseDeviceJoinReturnUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
    if (!isAllowedDeviceJoinOrigin(parsed.origin)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function buildDeviceJoinUrl(returnUrl: string): string {
  const url = new URL('/device/join', buildIdpHubOrigin());
  url.searchParams.set('return', returnUrl);
  return url.toString();
}

function isLoopbackOrigin(origin: string): boolean {
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

/** Whether an origin may receive a device join redirect back from auth.oxy.so. */
export function isAllowedDeviceJoinOrigin(origin: string): boolean {
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
    return apex != null && JOIN_OFFICIAL_APEXES.has(apex);
  } catch {
    return false;
  }
}

/** Parse device credentials from the join-return URL fragment. */
export function parseDeviceJoinFragment(hash: string): DeviceJoinFragment | null {
  if (!hash || hash === '#') {
    return null;
  }
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const deviceId = params.get(DEVICE_JOIN_FRAGMENT_DEVICE_ID);
  const deviceSecret = params.get(DEVICE_JOIN_FRAGMENT_DEVICE_SECRET);
  if (!deviceId || !deviceSecret || deviceId.length === 0 || deviceSecret.length === 0) {
    return null;
  }
  return { deviceId, deviceSecret };
}

/** Build the redirect-back URL with device credentials in the fragment. */
export function buildDeviceJoinReturnUrl(returnUrl: string, creds: DeviceJoinFragment): string {
  const url = new URL(returnUrl);
  url.hash = '';
  const params = new URLSearchParams();
  params.set(DEVICE_JOIN_FRAGMENT_DEVICE_ID, creds.deviceId);
  params.set(DEVICE_JOIN_FRAGMENT_DEVICE_SECRET, creds.deviceSecret);
  url.hash = params.toString();
  return url.toString();
}

/** Strip join fragment params from the current URL (history.replaceState-safe). */
export function stripDeviceJoinFragmentFromUrl(): boolean {
  if (typeof globalThis === 'undefined') {
    return false;
  }
  const location = (globalThis as { location?: Location }).location;
  const history = (globalThis as { history?: History }).history;
  if (!location?.hash) {
    return false;
  }
  const parsed = parseDeviceJoinFragment(location.hash);
  if (!parsed) {
    return false;
  }
  const cleanPath = `${location.pathname}${location.search}`;
  if (history?.replaceState) {
    history.replaceState(history.state, '', cleanPath);
  }
  return true;
}

/** Read + clear credentials staged by `device-join-strip.js` in the HTML `<head>`. */
export function readPendingDeviceJoinCredential(): DeviceJoinFragment | null {
  try {
    const raw = (globalThis as { sessionStorage?: Storage }).sessionStorage?.getItem(
      OXY_DEVICE_JOIN_PENDING_KEY,
    );
    if (!raw) {
      return null;
    }
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_DEVICE_JOIN_PENDING_KEY,
    );
    const parsed = JSON.parse(raw) as DeviceJoinFragment;
    if (
      typeof parsed?.deviceId === 'string' &&
      parsed.deviceId.length > 0 &&
      typeof parsed?.deviceSecret === 'string' &&
      parsed.deviceSecret.length > 0
    ) {
      return parsed;
    }
  } catch {
    // Best-effort.
  }
  return null;
}

/** Minimal client surface for hub-side join credential resolution. */
export interface DeviceJoinHubClient {
  mintFromDeviceSecret(
    deviceId: string,
    deviceSecret: string,
  ): Promise<{
    accessToken: string;
    expiresAt: string;
    nextDeviceSecret: string;
    state: {
      deviceId: string;
      activeAccountId?: string | null;
      accounts: Array<{ accountId: string; sessionId: string }>;
    };
  }>;
  provisionDevice(deviceId?: string): Promise<{ deviceId: string; deviceSecret: string }>;
}

function isMintNoActiveSession(error: unknown): boolean {
  if (extractErrorStatus(error) !== 401) return false;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.includes('no_active_session');
}

function isMintInvalidDeviceSecret(error: unknown): boolean {
  if (extractErrorStatus(error) !== 401) return false;
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.includes('invalid_device_secret');
}

async function persistHubCredential(
  store: AuthStateStore,
  prior: PersistedAuthState | null,
  creds: DeviceJoinFragment,
  extras?: Partial<Pick<PersistedAuthState, 'accessToken' | 'expiresAt' | 'sessionId' | 'userId'>>,
): Promise<void> {
  await store.save({
    sessionId: extras?.sessionId ?? prior?.sessionId ?? '',
    userId: extras?.userId ?? prior?.userId ?? '',
    deviceId: creds.deviceId,
    deviceSecret: creds.deviceSecret,
    ...(extras?.accessToken ? { accessToken: extras.accessToken } : {}),
    ...(extras?.expiresAt ? { expiresAt: extras.expiresAt } : {}),
  });
}

/**
 * Resolve the canonical device credential on auth.oxy.so before redirecting back.
 *
 * The hub MUST NOT return a cached secret blindly: another origin (e.g.
 * accounts.oxy.so) may have rotated it via `POST /session/device/token`.
 * Attempt a mint first to sync rotation; when the cache is stale, re-issue via
 * provision on the same deviceId (rotation-in-use grace keeps other tabs alive).
 */
export async function resolveHubDeviceCredentialForJoin(
  oxy: DeviceJoinHubClient,
  store: AuthStateStore,
): Promise<DeviceJoinFragment> {
  const existing = await store.load();

  if (!existing?.deviceId || !existing?.deviceSecret) {
    const provisioned = await oxy.provisionDevice();
    await persistHubCredential(store, existing, provisioned);
    return provisioned;
  }

  try {
    const mint = await oxy.mintFromDeviceSecret(existing.deviceId, existing.deviceSecret);
    const creds = { deviceId: existing.deviceId, deviceSecret: mint.nextDeviceSecret };
    const active = mint.state.accounts.find((a) => a.accountId === mint.state.activeAccountId);
    await persistHubCredential(store, existing, creds, {
      accessToken: mint.accessToken,
      expiresAt: mint.expiresAt,
      ...(active ? { sessionId: active.sessionId, userId: active.accountId } : {}),
    });
    return creds;
  } catch (error) {
    if (isMintNoActiveSession(error)) {
      return { deviceId: existing.deviceId, deviceSecret: existing.deviceSecret };
    }
    if (isMintInvalidDeviceSecret(error)) {
      const refreshed = await oxy.provisionDevice(existing.deviceId);
      await persistHubCredential(store, existing, refreshed);
      return refreshed;
    }
    throw error;
  }
}
