/**
 * Authorized-apps mixin — the "Connected apps" management surface that survived
 * the FedCM removal.
 *
 * These two methods read/revoke the user's LEGACY FedCM authorization grants
 * (`GET`/`DELETE /fedcm/me/authorized-apps`). They are the last live consumers
 * of that endpoint (services' `ConnectedAppsScreen` via `useAccountQueries` /
 * `useAccountMutations`) and stay until the AppGrant migration retires the
 * FedCM grant store. All FedCM SIGN-IN machinery was deleted with
 * `OxyServices.fedcm.ts`; this is management-only, so it has no dependency on
 * the credential/nonce pipeline.
 */
import type { OxyServicesBase } from '../OxyServices.base';

/**
 * Public summary of an RP application the user has authorized — mirrors the
 * `AuthorizedAppSummary` shape returned by `GET /fedcm/me/authorized-apps`.
 */
export interface AuthorizedApp {
  /** Normalised RP origin. */
  origin: string;
  /** Friendly display name. */
  name: string;
  /** Optional human-readable description. */
  description?: string;
  /** ISO-8601 timestamp of when the user first authorized this RP. */
  firstGrantedAt: string;
  /** ISO-8601 timestamp of the most recent FedCM exchange for this user+RP. */
  lastUsedAt: string;
}

export function OxyServicesAuthorizedAppsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * List the authenticated user's authorized RP apps — the intersection of the
     * user's FedCM grants and the currently-approved RP catalog. Powers the
     * "Connected apps" management UI. Requires a real user session.
     */
    async listAuthorizedApps(): Promise<AuthorizedApp[]> {
      try {
        const response = await this.makeRequest<{ apps: AuthorizedApp[] }>(
          'GET',
          '/fedcm/me/authorized-apps',
          undefined,
          {
            cache: true,
            cacheTTL: 30 * 1000, // 30 second cache — short, this drives a manageable UI
          },
        );
        return response?.apps ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Revoke the authenticated user's authorization for a specific RP origin.
     * The corresponding cache entry is invalidated so a subsequent
     * `listAuthorizedApps()` sees fresh data.
     */
    async revokeAuthorizedApp(origin: string): Promise<void> {
      try {
        await this.makeRequest(
          'DELETE',
          `/fedcm/me/authorized-apps/${encodeURIComponent(origin)}`,
          undefined,
          { cache: false },
        );
        this.clearCacheEntry('GET:/fedcm/me/authorized-apps');
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
