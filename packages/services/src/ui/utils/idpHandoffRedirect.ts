import type { OxyServices } from '@oxyhq/core';
import { CENTRAL_IDP_APEX, OXY_IDP_HANDOFF_ATTEMPTED_KEY, logger } from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';

const IDP_HANDOFF_PATH = '/handoff';

/** Whether the current web origin is the central IdP hub (`auth.oxy.so`). */
export function isIdpHubOrigin(): boolean {
  if (!isWebBrowser()) return false;
  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;
  try {
    const { hostname } = new URL(location.href);
    return hostname === `auth.${CENTRAL_IDP_APEX}`;
  } catch {
    return false;
  }
}

function buildIdpHandoffUrl(handoffCode: string, returnUrl: string): string {
  const url = new URL(IDP_HANDOFF_PATH, `https://auth.${CENTRAL_IDP_APEX}`);
  url.searchParams.set('code', handoffCode);
  url.searchParams.set('return', returnUrl);
  return url.toString();
}

/**
 * After a first-party sign-in on a non-IdP origin, redirect once to auth.oxy.so
 * so the hub plants the same `{ deviceId, deviceSecret }` locally (zero cookies).
 * Returns `true` when a redirect was initiated (caller should stop further work).
 */
export async function maybeRedirectIdpHandoff(opts: {
  oxyServices: OxyServices;
  /** Skip when already on the IdP hub or when handoff was already attempted. */
  skip?: boolean;
}): Promise<boolean> {
  if (opts.skip || !isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }

  const sessionStore = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (sessionStore?.getItem(OXY_IDP_HANDOFF_ATTEMPTED_KEY)) {
    return false;
  }

  const location = (globalThis as { location?: Location }).location;
  if (!location) return false;

  try {
    const { handoffCode } = await opts.oxyServices.createIdpHandoff();
    sessionStore?.setItem(OXY_IDP_HANDOFF_ATTEMPTED_KEY, '1');
    location.href = buildIdpHandoffUrl(handoffCode, location.href);
    return true;
  } catch (error) {
    logger.warn('IdP handoff redirect skipped', { component: 'idpHandoffRedirect' }, error);
    return false;
  }
}

/** Clear the handoff loop guard (e.g. after returning from auth.oxy.so). */
export function clearIdpHandoffAttemptFlag(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_IDP_HANDOFF_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort only.
  }
}
