/**
 * Platform detection helper for the web auth/session-sync surfaces.
 *
 * This module previously hosted a FedCM-based `useWebSSO` hook (Federated
 * Credential Management — Chrome-only). It was removed: FedCM is no longer
 * used anywhere in the client sign-in/cold-boot path (see `CrossDomainAuth`'s
 * doc comment in `@oxyhq/core` for the production sign-in loop that motivated
 * the removal). Cross-domain silent SSO is owned entirely by the
 * `silent-iframe` cold-boot step (per-apex `/auth/silent`) plus the terminal
 * `/sso` bounce in `WebOxyProvider`.
 *
 * `isWebBrowser` is kept here (rather than moved) so every existing consumer
 * import path stays valid.
 */

/**
 * Check if we're running in a web browser environment (not React Native)
 */
export function isWebBrowser(): boolean {
  return typeof window !== 'undefined' &&
         typeof document !== 'undefined' &&
         typeof document.documentElement !== 'undefined';
}
