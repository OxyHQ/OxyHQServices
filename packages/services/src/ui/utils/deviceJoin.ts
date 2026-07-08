import type { AuthStateStore, PersistedAuthState } from '@oxyhq/core';
import {
  OXY_DEVICE_JOIN_ATTEMPTED_KEY,
  buildDeviceJoinUrl,
  isAllowedDeviceJoinOrigin,
  isIdpHubOrigin,
  parseDeviceJoinFragment,
  readPendingDeviceJoinCredential,
  stripDeviceJoinFragmentFromUrl,
} from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';

/** Persist device credentials from the join-return fragment. Returns true when applied. */
export async function applyDeviceJoinReturn(store: AuthStateStore): Promise<boolean> {
  if (!isWebBrowser()) return false;

  let creds = readPendingDeviceJoinCredential();
  if (!creds) {
    const location = (globalThis as { location?: Location }).location;
    if (!location?.hash) return false;
    creds = parseDeviceJoinFragment(location.hash);
    if (!creds) return false;
    stripDeviceJoinFragmentFromUrl();
  }

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

/** Clear the join redirect guard so a failed/cancelled join can retry on next boot. */
export function clearDeviceJoinAttemptFlag(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_DEVICE_JOIN_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort.
  }
}

/**
 * Redirect an official first-party web app to auth.oxy.so/device/join when this
 * origin has no persisted device credential yet. Returns true when navigation
 * was initiated.
 */
export async function maybeRedirectForDeviceJoin(store: AuthStateStore): Promise<boolean> {
  if (!isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location || !isAllowedDeviceJoinOrigin(location.origin)) {
    return false;
  }

  if (await hasPersistedDeviceCredential(store)) {
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
