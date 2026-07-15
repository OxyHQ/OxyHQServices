import { OxyServices } from '@oxyhq/core';
import { ShipClient } from './client';
import { requireString, stringFlag } from './args';

/**
 * Build an authenticated ShipClient from flags/env. Credentials come from
 * `--client-id`/`OXY_SHIP_CLIENT_ID` + `--secret`/`OXY_SHIP_SECRET`; the API
 * origin from `--api-url`/`OXY_API_URL` (default production). Token minting +
 * refresh is delegated to `@oxyhq/core`'s service-auth so the CLI never plumbs
 * `/auth/service-token` itself.
 */
export function createShipClient(flags: Record<string, string | boolean>): ShipClient {
  const baseURL = stringFlag(flags, 'api-url', 'OXY_API_URL', 'https://api.oxy.so') as string;
  const clientId = requireString(flags, 'client-id', 'OXY_SHIP_CLIENT_ID');
  const secret = requireString(flags, 'secret', 'OXY_SHIP_SECRET');

  const oxy = new OxyServices({ baseURL });
  oxy.configureServiceAuth(clientId, secret);

  return new ShipClient({ baseURL, getToken: () => oxy.getServiceToken() });
}
