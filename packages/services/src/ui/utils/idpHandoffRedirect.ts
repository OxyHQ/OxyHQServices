import type { OxyServices } from '@oxyhq/core';
import { OXY_IDP_HANDOFF_ATTEMPTED_KEY, logger } from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';
import { isIdpHubOrigin } from './idpHubOrigin';

export { isIdpHubOrigin } from './idpHubOrigin';

/** @deprecated IdP handoff via iframe was removed — device join is the canonical path. */
export async function maybeRedirectIdpHandoff(_opts: {
  oxyServices: OxyServices;
  skip?: boolean;
}): Promise<boolean> {
  return false;
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
