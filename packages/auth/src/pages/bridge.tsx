import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  buildIdpHubOrigin,
  IDP_HANDOFF_BRIDGE_MESSAGE,
  isAllowedBridgeParentOrigin,
  type IdpHandoffBridgeOutboundMessage,
} from "@oxyhq/core";
import { useOxy } from "@oxyhq/services";

function postToParent(
  parentOrigin: string,
  message: IdpHandoffBridgeOutboundMessage,
): void {
  if (window.parent === window) return;
  window.parent.postMessage(message, parentOrigin);
}

/**
 * Zero-UI iframe bridge: mint a one-shot handoff code on auth.oxy.so and
 * postMessage it to the embedding first-party app. The parent exchanges via
 * API — no full-page authorize redirect.
 */
export function BridgePage() {
  const [searchParams] = useSearchParams();
  const {
    oxyServices,
    isAuthResolved,
    canUsePrivateApi,
    isPrivateApiPending,
  } = useOxy();
  const attemptedRef = useRef(false);

  const parentOrigin = searchParams.get("origin");

  useEffect(() => {
    if (attemptedRef.current) return;
    if (!parentOrigin || !isAllowedBridgeParentOrigin(parentOrigin)) return;
    if (!isAuthResolved || isPrivateApiPending) return;

    attemptedRef.current = true;

    if (!canUsePrivateApi || !oxyServices.getAccessToken()) {
      postToParent(parentOrigin, {
        type: IDP_HANDOFF_BRIDGE_MESSAGE,
        status: "no_session",
      });
      return;
    }

    void (async () => {
      try {
        const { handoffCode } = await oxyServices.createIdpHandoff();
        postToParent(parentOrigin, {
          type: IDP_HANDOFF_BRIDGE_MESSAGE,
          status: "ok",
          code: handoffCode,
        });
      } catch {
        postToParent(parentOrigin, {
          type: IDP_HANDOFF_BRIDGE_MESSAGE,
          status: "error",
        });
      }
    })();
  }, [
    parentOrigin,
    isAuthResolved,
    canUsePrivateApi,
    isPrivateApiPending,
    oxyServices,
  ]);

  // Intentionally blank — this route only runs inside a hidden iframe.
  if (import.meta.env.DEV && parentOrigin) {
    return (
      <p style={{ font: "12px system-ui", color: "#666", margin: 8 }}>
        Oxy IdP bridge ({buildIdpHubOrigin()})
      </p>
    );
  }

  return null;
}
