/**
 * Single platform-detection helper for `@oxyhq/services`.
 *
 * Returns `true` in a real web browser (a DOM is present), `false` on React
 * Native. Native defines a global `window` but no `document`, so the DOM probe
 * is the reliable discriminator. Kept as one tiny module so every consumer
 * imports the same predicate (the former `useWebSSO` home of this helper was
 * deleted in the device-first cutover along with the FedCM/silent surface).
 */
export function isWebBrowser(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.documentElement !== 'undefined'
  );
}
