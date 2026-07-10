import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OxyServices,
  createWebAuthStateStore,
  parseHubSyncReturnUrl,
  redeemHubTicketOnHub,
} from '@oxyhq/core';
import { getApiBaseUrl } from '@/lib/oxy-api-client';

function redirectAfterHubSync(returnUrl: string | null, failed = false): void {
  const destination = new URL(returnUrl ?? '/', window.location.origin);
  if (failed) {
    destination.searchParams.set('hub_sync', 'failed');
  }
  window.location.replace(destination.toString());
}

/**
 * Zero-UI hub sync page: redeem a one-time ticket and plant device credentials
 * on auth.oxy.so, then redirect back to the originating app.
 */
export function HubSyncPage() {
  const [searchParams] = useSearchParams();
  const attemptedRef = useRef(false);
  const ticket = searchParams.get('ticket');
  const returnUrl = parseHubSyncReturnUrl(searchParams.get('return'));

  useEffect(() => {
    if (attemptedRef.current) return;
    attemptedRef.current = true;

    if (!ticket) {
      redirectAfterHubSync(returnUrl, true);
      return;
    }

    void (async () => {
      try {
        const oxyServices = new OxyServices({ baseURL: getApiBaseUrl() });
        const store = createWebAuthStateStore();
        await redeemHubTicketOnHub(oxyServices, store, ticket);
        redirectAfterHubSync(returnUrl);
      } catch {
        redirectAfterHubSync(returnUrl, true);
      }
    })();
  }, [ticket, returnUrl]);

  return null;
}
