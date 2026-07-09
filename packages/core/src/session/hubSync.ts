/**
 * Post-sign-in hub sync — plant device credentials on auth.oxy.so via a
 * one-time server ticket (no secrets in URL fragments).
 */

import type { OxyServices } from '../OxyServices';
import type { AuthStateStore } from './authStateStore';
import {
  buildHubSyncUrl,
  buildIdpHubOrigin,
  isIdpHubOrigin,
  isOfficialWebOrigin,
} from '../utils/officialOrigins';

export interface SyncHubAfterSignInOptions {
  /** Skip sync when false (OxyProvider hubSync prop). @default true */
  enabled?: boolean;
}

/**
 * After a successful sign-in on an official web app, mint a hub ticket and
 * redirect to auth.oxy.so/sync so the IdP hub can redeem it and persist the
 * shared device credential for silent OAuth restore on other origins.
 *
 * No-op on native, non-official origins, and when already on the IdP hub.
 */
export async function syncHubAfterSignIn(
  oxy: Pick<OxyServices, 'issueHubTicket'>,
  opts?: SyncHubAfterSignInOptions,
): Promise<boolean> {
  if (opts?.enabled === false) {
    return false;
  }

  if (typeof globalThis === 'undefined') {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) {
    return false;
  }

  if (isIdpHubOrigin()) {
    return false;
  }

  if (!isOfficialWebOrigin(location.origin)) {
    return false;
  }

  const hubOrigin = buildIdpHubOrigin();
  const issued = await oxy.issueHubTicket(hubOrigin);
  const returnUrl = `${location.origin}${location.pathname}${location.search}`;
  const syncUrl = buildHubSyncUrl(issued.ticket, returnUrl);

  window.location.assign(syncUrl);
  return true;
}

/** Redeem a hub ticket on auth.oxy.so and persist credentials locally. */
export async function redeemHubTicketOnHub(
  oxy: Pick<OxyServices, 'redeemHubTicket'>,
  store: AuthStateStore,
  ticket: string,
): Promise<boolean> {
  const hubOrigin = buildIdpHubOrigin();
  const creds = await oxy.redeemHubTicket(ticket, hubOrigin);
  const prior = await store.load();
  await store.save({
    sessionId: prior?.sessionId ?? '',
    userId: prior?.userId ?? '',
    deviceId: creds.deviceId,
    deviceSecret: creds.deviceSecret,
    ...(prior?.accessToken ? { accessToken: prior.accessToken } : {}),
    ...(prior?.expiresAt ? { expiresAt: prior.expiresAt } : {}),
  });
  return true;
}
