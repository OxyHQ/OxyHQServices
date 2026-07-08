import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  IDP_HANDOFF_DONE_MESSAGE,
  isAllowedBridgeParentOrigin,
} from "@oxyhq/core";
import { useOxy } from "@oxyhq/services";
import {
  AuthFormLayout,
  AuthFormHeader,
  LoadingSpinner,
} from "@/components/auth-form-layout";
import { useTranslation } from "@/lib/i18n/use-translation";

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
  const embed = searchParams.get("embed") === "1";
  const parentOrigin = embed ? searchParams.get("origin") : null;

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

        if (
          embed &&
          parentOrigin &&
          isAllowedBridgeParentOrigin(parentOrigin) &&
          window.parent !== window
        ) {
          window.parent.postMessage(
            { type: IDP_HANDOFF_DONE_MESSAGE, status: "ok" },
            parentOrigin,
          );
          return;
        }

        if (returnUrl) {
          window.location.replace(returnUrl);
          return;
        }
        if (!cancelled) setError(null);
      } catch (err) {
        if (
          embed &&
          parentOrigin &&
          isAllowedBridgeParentOrigin(parentOrigin) &&
          window.parent !== window
        ) {
          window.parent.postMessage(
            { type: IDP_HANDOFF_DONE_MESSAGE, status: "error" },
            parentOrigin,
          );
          return;
        }
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
  }, [handoffCode, returnUrl, embed, parentOrigin, oxyServices, handleWebSession]);

  if (embed) {
    return null;
  }

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
