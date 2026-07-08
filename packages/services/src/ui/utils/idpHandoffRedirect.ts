import type { OxyServices } from '@oxyhq/core';
import { OXY_IDP_HANDOFF_ATTEMPTED_KEY, logger } from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { isIdpHubOrigin } from './idpHubOrigin';
import { tryInvisibleIdpHandoffPush } from './idpHandoffBridge';

export { isIdpHubOrigin } from './idpHubOrigin';

/**
 * After interactive sign-in, plant credentials on auth.oxy.so via a hidden iframe.
 * Best-effort and invisible — never navigates the user away from the app.
 */
export async function maybeRedirectIdpHandoff(opts: {
  oxyServices: OxyServices;
  /** Skip when already on the IdP hub or when handoff already succeeded this tab. */
  skip?: boolean;
}): Promise<boolean> {
  if (opts.skip || !isWebBrowser() || isIdpHubOrigin()) {
    return false;
  }

  const sessionStore = (globalThis as { sessionStorage?: Storage }).sessionStorage;
  if (sessionStore?.getItem(OXY_IDP_HANDOFF_ATTEMPTED_KEY)) {
    return false;
  }

  try {
    const { handoffCode } = await opts.oxyServices.createIdpHandoff();
    const pushed = await tryInvisibleIdpHandoffPush({
      oxyServices: opts.oxyServices,
      handoffCode,
    });
    if (pushed) {
      sessionStore?.setItem(OXY_IDP_HANDOFF_ATTEMPTED_KEY, '1');
      return true;
    }
    return false;
  } catch (error) {
    logger.warn('IdP handoff push skipped', { component: 'idpHandoffRedirect' }, error);
    return false;
  }
}

/** Clear the handoff guard (e.g. on sign-out). */
export function clearIdpHandoffAttemptFlag(): void {
  try {
    (globalThis as { sessionStorage?: Storage }).sessionStorage?.removeItem(
      OXY_IDP_HANDOFF_ATTEMPTED_KEY,
    );
  } catch {
    // Best-effort only.
  }
}
