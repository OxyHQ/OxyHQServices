import { CENTRAL_IDP_APEX } from '@oxyhq/core';
import { isWebBrowser } from './isWebBrowser';

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
