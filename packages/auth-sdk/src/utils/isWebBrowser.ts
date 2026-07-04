/**
 * Web-browser environment detection for the web auth SDK.
 *
 * The only surviving helper from the retired FedCM `useWebSSO` hook — kept as a
 * standalone util so existing consumer imports (`import { isWebBrowser } from
 * '@oxyhq/auth'`) stay valid.
 */
export function isWebBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.documentElement !== 'undefined'
  );
}
