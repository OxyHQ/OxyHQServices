import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  OxyServices,
  buildDeviceJoinReturnUrl,
  createWebAuthStateStore,
  isAllowedDeviceJoinOrigin,
  type AuthStateStore,
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

async function resolveHubDeviceCredential(
  oxyServices: OxyServices,
  store: AuthStateStore,
): Promise<{ deviceId: string; deviceSecret: string }> {
  const existing = await store.load();
  if (existing?.deviceId && existing?.deviceSecret) {
    return { deviceId: existing.deviceId, deviceSecret: existing.deviceSecret };
  }
  const provisioned = await oxyServices.provisionDevice();
  await store.save({
    sessionId: existing?.sessionId ?? "",
    userId: existing?.userId ?? "",
    deviceId: provisioned.deviceId,
    deviceSecret: provisioned.deviceSecret,
    ...(existing?.accessToken ? { accessToken: existing.accessToken } : {}),
    ...(existing?.expiresAt ? { expiresAt: existing.expiresAt } : {}),
  });
  return provisioned;
}

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
 * Zero-UI device join hub: read or provision the canonical device credential on
 * auth.oxy.so and redirect back to the caller with `#oxy_device=…` in the fragment.
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
      const creds = await resolveHubDeviceCredential(oxyServices, store);
      window.location.replace(buildDeviceJoinReturnUrl(returnUrl, creds));
    })();
  }, [returnUrl]);

  return null;
}
