import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OxyServices,
  createWebAuthStateStore,
  parseHubSyncReturnUrl,
  redeemHubTicketOnHub,
} from '@oxyhq/core';
import { getApiBaseUrl } from '@/lib/oxy-api-client';

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
    if (attemptedRef.current || !ticket) return;
    attemptedRef.current = true;

    void (async () => {
      const oxyServices = new OxyServices({ baseURL: getApiBaseUrl() });
      const store = createWebAuthStateStore();
      await redeemHubTicketOnHub(oxyServices, store, ticket);
      window.location.replace(returnUrl ?? '/');
    })();
  }, [ticket, returnUrl]);

  return null;
}
