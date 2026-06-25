import type { ApplicationType } from '../models/Application';

/**
 * Pure predicate: is this Application part of the platform-trusted set?
 *
 * "Trusted" means a first-party / internal / system / official application whose
 * trust fields are staff-controlled (`type`, `isOfficial`, `isInternal` are
 * never settable via the Console / member RBAC path — see `requireStaff`).
 * Ordinary self-service `third_party` applications are NOT trusted even while
 * `status: 'active'`, so `status: 'active'` alone is never a trust boundary.
 *
 * This is the single source of truth for trust-gated decisions that must agree:
 *  - FedCM/SSO approved-origin derivation (`fedcm.service.ts`).
 *  - Service-credential creation + service-token minting (`applications.ts`,
 *    `auth.ts`) — bearer credentials for Oxy-to-Oxy/internal routes.
 *  - Requiring an Origin proof before showing official branding on the device
 *    consent UI (`auth.ts` `POST /session/create`).
 *
 * Keep this aligned with `TRUSTED_APPLICATION_FEDCM_FILTER` in
 * `fedcm.service.ts` (the Mongo-query form of the same policy).
 */
export function isTrustedApplication(
  app: { isOfficial?: boolean; isInternal?: boolean; type?: ApplicationType }
): boolean {
  return Boolean(
    app.isOfficial ||
      app.isInternal ||
      app.type === 'first_party' ||
      app.type === 'internal' ||
      app.type === 'system'
  );
}
