import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  OxyServices,
  buildDeviceJoinReturnUrl,
  createWebAuthStateStore,
  parseDeviceJoinReturnUrl,
  resolveHubDeviceCredentialForJoin,
} from "@oxyhq/core";
import { getApiBaseUrl } from "@/lib/oxy-api-client";

/**
 * Zero-UI device join hub: sync the canonical device credential on auth.oxy.so
 * (mint or re-issue when stale) and redirect back with `#oxy_device=…`.
 */
export function DeviceJoinPage() {
  const [searchParams] = useSearchParams();
  const attemptedRef = useRef(false);
  const returnUrl = parseDeviceJoinReturnUrl(searchParams.get("return"));

  useEffect(() => {
    if (attemptedRef.current || !returnUrl) return;
    attemptedRef.current = true;

    void (async () => {
      const oxyServices = new OxyServices({ baseURL: getApiBaseUrl() });
      const store = createWebAuthStateStore();
      const creds = await resolveHubDeviceCredentialForJoin(oxyServices, store);
      window.location.replace(buildDeviceJoinReturnUrl(returnUrl, creds));
    })();
  }, [returnUrl]);

  return null;
}
