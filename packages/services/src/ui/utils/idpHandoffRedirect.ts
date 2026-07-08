import type { OxyServices } from '@oxyhq/core';
import { CENTRAL_IDP_APEX, OXY_IDP_HANDOFF_ATTEMPTED_KEY, logger } from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { isIdpHubOrigin } from './idpHubOrigin';
import { tryInvisibleIdpHandoffPush } from './idpHandoffBridge';

export { isIdpHubOrigin } from './idpHubOrigin';

const IDP_HANDOFF_PATH = '/handoff';

function buildIdpHandoffUrl(handoffCode: string, returnUrl: string): string {
  const url = new URL(IDP_HANDOFF_PATH, `https://auth.${CENTRAL_IDP_APEX}`);
  url.searchParams.set('code', handoffCode);
  url.searchParams.set('return', returnUrl);
  return url.toString();
}

function cleanReturnUrl(href: string): string {
  try {
    const url = new URL(href);
    for (const key of ['code', 'state', 'error', 'error_description']) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * After a first-party sign-in on a non-IdP origin, plant credentials on the IdP
 * hub via a hidden iframe when possible (zero UI). Falls back to a one-shot
 * top-level redirect when iframe embedding is blocked.
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

    const pushed = await tryInvisibleIdpHandoffPush({
      oxyServices: opts.oxyServices,
      handoffCode,
    });
    if (pushed) {
      return true;
    }

    location.href = buildIdpHandoffUrl(handoffCode, cleanReturnUrl(location.href));
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
