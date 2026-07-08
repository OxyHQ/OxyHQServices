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

/** One join redirect attempt per tab navigation (sessionStorage). */
export const OXY_DEVICE_JOIN_ATTEMPTED_KEY = 'oxy.device_join_attempted';

/** Per-origin marker: this app aligned its device credential via auth.oxy.so/device/join. */
export const OXY_DEVICE_JOIN_V2_KEY = 'oxy.device_join_v2';

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

/** True when this origin completed the v2 device-join migration (localStorage). */
export function isDeviceJoinV2Complete(): boolean {
  try {
    return (
      (globalThis as { localStorage?: Storage }).localStorage?.getItem(
        OXY_DEVICE_JOIN_V2_KEY,
      ) === '1'
    );
  } catch {
    return false;
  }
}

/** Mark this origin as device-join v2 aligned (after a successful join return). */
export function markDeviceJoinV2Complete(): void {
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem(
      OXY_DEVICE_JOIN_V2_KEY,
      '1',
    );
  } catch {
    // Best-effort.
  }
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
  if (history?.replaceState) {
    const url = new URL(location.href);
    url.hash = '';
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  }
  return true;
}
