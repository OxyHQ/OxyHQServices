import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  OxyServices,
  buildDeviceJoinReturnUrl,
  createWebAuthStateStore,
  isAllowedDeviceJoinOrigin,
  resolveHubDeviceCredentialForJoin,
} from "@oxyhq/core";
import { getApiBaseUrl } from "@/lib/oxy-api-client";

function safeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    if (!isAllowedDeviceJoinOrigin(parsed.origin)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Zero-UI device join hub: sync the canonical device credential on auth.oxy.so
 * (mint or re-issue when stale) and redirect back with `#oxy_device=…`.
 */
export function DeviceJoinPage() {
  const [searchParams] = useSearchParams();
  const attemptedRef = useRef(false);
  const returnUrl = safeReturnUrl(searchParams.get("return"));

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
