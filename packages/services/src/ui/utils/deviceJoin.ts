import type { AuthStateStore, OxyServices, PersistedAuthState } from '@oxyhq/core';
import {
  OXY_DEVICE_JOIN_ATTEMPTED_KEY,
  buildDeviceJoinUrl,
  isAllowedDeviceJoinOrigin,
  isDeviceJoinV2Complete,
  markDeviceJoinV2Complete,
  parseDeviceJoinFragment,
  resolveHubDeviceCredentialForJoin,
  stripDeviceJoinFragmentFromUrl,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { isIdpHubOrigin } from './idpHubOrigin';

/** Persist device credentials from the join-return fragment. Returns true when applied. */
export async function applyDeviceJoinReturn(store: AuthStateStore): Promise<boolean> {
  if (!isWebBrowser()) return false;
  const location = (globalThis as { location?: Location }).location;
  if (!location?.hash) return false;

  const creds = parseDeviceJoinFragment(location.hash);
  if (!creds) return false;

  const existing = await store.load();
  const next: PersistedAuthState = {
    sessionId: existing?.sessionId ?? '',
    userId: existing?.userId ?? '',
    deviceId: creds.deviceId,
    deviceSecret: creds.deviceSecret,
    ...(existing?.accessToken ? { accessToken: existing.accessToken } : {}),
    ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}),
  };
  await store.save(next);
  stripDeviceJoinFragmentFromUrl();
  markDeviceJoinV2Complete();

  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_DEVICE_JOIN_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort.
  }
  return true;
}

function joinAlreadyAttempted(): boolean {
  try {
    return (
      (globalThis as { sessionStorage?: Storage }).sessionStorage?.getItem(
        OXY_DEVICE_JOIN_ATTEMPTED_KEY,
      ) === '1'
    );
  } catch {
    return false;
  }
}

function markJoinAttempted(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.setItem(
      OXY_DEVICE_JOIN_ATTEMPTED_KEY,
      '1',
    );
  } catch {
    // Best-effort.
  }
}

/**
 * Whether an official first-party web app should redirect to auth.oxy.so/device/join.
 * Redirect when there is no local credential, OR when this origin still holds a
 * pre-join-era device id that was never aligned through the hub (one-time migration).
 */
export async function shouldRedirectForDeviceJoin(store: AuthStateStore): Promise<boolean> {
  if (!isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }
  const location = (globalThis as { location?: Location }).location;
  if (!location || !isAllowedDeviceJoinOrigin(location.origin)) {
    return false;
  }
  if (isDeviceJoinV2Complete()) {
    return !(await hasPersistedDeviceCredential(store));
  }
  return true;
}

/**
 * When an official first-party web app needs device join, redirect ONCE to
 * auth.oxy.so/device/join. Returns true when navigation was initiated.
 */
export function maybeRedirectDeviceJoin(): boolean {
  if (!isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  if (!isAllowedDeviceJoinOrigin(location.origin)) {
    return false;
  }

  if (joinAlreadyAttempted()) {
    return false;
  }

  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    return false;
  }

  markJoinAttempted();
  const returnUrl = `${location.origin}${location.pathname}${location.search}`;
  window.location.replace(buildDeviceJoinUrl(returnUrl));
  return true;
}

/** Clear the join guard (e.g. on sign-out). */
export function clearDeviceJoinAttemptFlag(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_DEVICE_JOIN_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort.
  }
}

/** True when the persisted store holds a device credential (post-join). */
export async function hasPersistedDeviceCredential(store: AuthStateStore): Promise<boolean> {
  const persisted = await store.load();
  return Boolean(persisted?.deviceId && persisted?.deviceSecret);
}

export async function loadPersistedDeviceCredential(
  store: AuthStateStore,
): Promise<{ deviceId: string; deviceSecret: string } | null> {
  const persisted = await store.load();
  if (!persisted?.deviceId || !persisted?.deviceSecret) {
    return null;
  }
  return { deviceId: persisted.deviceId, deviceSecret: persisted.deviceSecret };
}

/** Hub-side: read or provision the canonical device credential. */
export async function resolveHubDeviceCredential(
  oxyServices: OxyServices,
  store: AuthStateStore,
): Promise<{ deviceId: string; deviceSecret: string }> {
  return resolveHubDeviceCredentialForJoin(oxyServices, store);
}
