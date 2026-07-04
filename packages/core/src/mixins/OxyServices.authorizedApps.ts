/**
 * Authorized-apps mixin — the "Connected apps" management surface.
 *
 * Reads/revokes the user's OAuth application grants on the AppGrant endpoints
 * (`GET /apps/authorized`, `DELETE /apps/authorized/:clientId`) — the successor
 * to the retired FedCM `/fedcm/me/authorized-apps` surface. The method NAMES
 * (`listAuthorizedApps` / `revokeAuthorizedApp`) are unchanged so services'
 * `ConnectedAppsScreen` (via `useAccountQueries` / `useAccountMutations`) keeps
 * its call sites; only the wire shape + endpoints moved. Management-only — no
 * dependency on any sign-in/credential pipeline.
 */
import type { OxyServicesBase } from '../OxyServices.base';

/**
 * One OAuth application the user has authorized — the `GET /apps/authorized`
 * entry shape (`AppGrant` projection). `clientId` is the app's OAuth client id
 * and the revoke key; `appIconUrl` / `scopes` are optional.
 */
export interface AuthorizedApp {
  /** The authorized application's OAuth client id — the revoke key. */
  clientId: string;
  /** Friendly display name. */
  appName: string;
  /** Optional app icon URL. */
  appIconUrl?: string;
  /** ISO-8601 timestamp of when the user granted this app. */
  grantedAt: string;
  /** Optional scopes the grant covers. */
  scopes?: string[];
}

/** Cache-key prefix of the authorized-apps read (`GET /apps/authorized`). */
const AUTHORIZED_APPS_CACHE_KEY = 'GET:/apps/authorized';

export function OxyServicesAuthorizedAppsMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    /**
     * List the authenticated user's authorized OAuth applications
     * (`GET /apps/authorized`). Powers the "Connected apps" management UI.
     * Requires a real user session.
     */
    async listAuthorizedApps(): Promise<AuthorizedApp[]> {
      try {
        const response = await this.makeRequest<{ apps: AuthorizedApp[] }>(
          'GET',
          '/apps/authorized',
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
     * Revoke the authenticated user's grant for a specific application
     * (`DELETE /apps/authorized/:clientId`, 204). The corresponding cache entry
     * is invalidated so a subsequent `listAuthorizedApps()` sees fresh data.
     */
    async revokeAuthorizedApp(clientId: string): Promise<void> {
      try {
        await this.makeRequest(
          'DELETE',
          `/apps/authorized/${encodeURIComponent(clientId)}`,
          undefined,
          { cache: false },
        );
        this.clearCacheEntry(AUTHORIZED_APPS_CACHE_KEY);
      } catch (error) {
        throw this.handleError(error);
      }
    }
  };
}
