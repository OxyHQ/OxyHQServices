import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { OXY_IDP_HANDOFF_ATTEMPTED_KEY } from "@oxyhq/core";
import { useOxy } from "@oxyhq/services";
import {
  AuthFormLayout,
  AuthFormHeader,
  LoadingSpinner,
} from "@/components/auth-form-layout";
import { useTranslation } from "@/lib/i18n/use-translation";

function clearIdpHandoffAttemptFlag(): void {
  try {
    sessionStorage.removeItem(OXY_IDP_HANDOFF_ATTEMPTED_KEY);
  } catch {
    // Best-effort only.
  }
}

function safeReturnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * One-shot IdP hub page: exchange a handoff code from another Oxy app and plant
 * the shared DeviceSession locally, then redirect back to the caller.
 */
export function HandoffPage() {
  const [searchParams] = useSearchParams();
  const { oxyServices, handleWebSession } = useOxy();
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const handoffCode = searchParams.get("code");
  const returnUrl = safeReturnUrl(searchParams.get("return"));

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (!handoffCode) {
        if (!cancelled) setError("Missing handoff code.");
        return;
      }

      try {
        const session = await oxyServices.exchangeIdpHandoff(handoffCode);
        await handleWebSession({
          sessionId: session.sessionId,
          accessToken: session.accessToken ?? "",
          deviceId: session.deviceId,
          deviceSecret: session.deviceSecret,
          expiresAt: session.expiresAt,
          user: session.user,
        });
        clearIdpHandoffAttemptFlag();
        if (returnUrl) {
          window.location.replace(returnUrl);
          return;
        }
        if (!cancelled) setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Handoff exchange failed.",
          );
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [handoffCode, returnUrl, oxyServices, handleWebSession]);

  if (error) {
    return (
      <AuthFormLayout>
        <AuthFormHeader
          title={t("authorize.requestTitle")}
          description={error}
        />
      </AuthFormLayout>
    );
  }

  return (
    <AuthFormLayout>
      <AuthFormHeader title={t("authorize.signingIn")} />
      <LoadingSpinner />
    </AuthFormLayout>
  );
}
