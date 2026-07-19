import { useCallback, useEffect, useState } from 'react';
import { useOxy } from '@oxyhq/services';
import { getCommonsApprovalBlockingReason, type CommonsApprovalInfo } from '@oxyhq/core';
import { authenticate } from '@/lib/biometricAuth';

/**
 * Lifecycle of a "Sign in with Oxy" approval on the Commons (approver) side.
 *
 *   loading   → resolving the request identity via the API
 *   ready     → server-resolved identity available; awaiting the user's choice
 *   approving → biometric passed; calling `approveCommonsSignIn`
 *   approved  → the RP can now claim its session
 *   denying   → calling `denyCommonsSignIn`
 *   denied    → the request was cancelled
 *   error     → invalid / used / expired code, or a network failure
 */
export type ApprovalState =
  | 'loading'
  | 'ready'
  | 'approving'
  | 'approved'
  | 'denying'
  | 'denied'
  | 'error';

export interface UseCommonsApproval {
  state: ApprovalState;
  /** Server-resolved (TRUSTED) requesting-app identity; null until `ready`. */
  info: CommonsApprovalInfo | null;
  /** Set when the device biometric/passcode gate was not satisfied. */
  biometricFailed: boolean;
  /** Optional server/network error message for the `error` state. */
  errorMessage: string | null;
  approve: () => Promise<void>;
  deny: () => Promise<void>;
  /** Re-fetch the request identity (used by the "try again" affordance). */
  reload: () => void;
}

/**
 * Drives the Commons approval screen.
 *
 * SECURITY: the requesting-app identity shown to the user comes ONLY from
 * `getCommonsApprovalInfo(code)` (resolved server-side from the authorize
 * code) — never from the scanned QR string. Approval is gated behind the
 * device biometric/passcode (`authenticate`) before the signed authorize call
 * is made, so a stolen unlocked-but-unattended phone still can't approve.
 *
 * The one-shot identity fetch uses a `useEffect` keyed on the code + SDK
 * readiness — a legitimate imperative data load tied to a route param (the
 * same pattern used by the vault's public-key load), not derived state.
 *
 * @param code - The public authorize code (from the QR / deep-link).
 * @param biometricReason - Localized prompt shown in the biometric dialog.
 */
export function useCommonsApproval(
  code: string | undefined,
  biometricReason: string,
): UseCommonsApproval {
  const { oxyServices } = useOxy();
  const [state, setState] = useState<ApprovalState>('loading');
  const [info, setInfo] = useState<CommonsApprovalInfo | null>(null);
  const [biometricFailed, setBiometricFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!code) {
      setState('error');
      setErrorMessage(null);
      return;
    }
    // Wait until the SDK client is available before fetching.
    if (!oxyServices) return;

    let cancelled = false;
    setState('loading');
    setErrorMessage(null);
    oxyServices
      .getCommonsApprovalInfo(code)
      .then((result) => {
        if (cancelled) return;
        const blockingReason = getCommonsApprovalBlockingReason(result);
        if (blockingReason) {
          setInfo(null);
          setErrorMessage(blockingReason);
          setState('error');
          return;
        }
        setInfo(result);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : null);
        setState('error');
      });

    return () => {
      cancelled = true;
    };
  }, [code, oxyServices, reloadKey]);

  const approve = useCallback(async () => {
    if (!code || !oxyServices) return;

    // Biometric/passcode gate — must pass BEFORE we sign the authorize request.
    setBiometricFailed(false);
    const auth = await authenticate(biometricReason);
    if (!auth.success) {
      setBiometricFailed(true);
      return;
    }

    setState('approving');
    try {
      await oxyServices.approveCommonsSignIn({ authorizeCode: code });
      setState('approved');
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : null);
      setState('error');
    }
  }, [code, oxyServices, biometricReason]);

  const deny = useCallback(async () => {
    if (!code || !oxyServices) return;

    setState('denying');
    try {
      await oxyServices.denyCommonsSignIn(code);
      setState('denied');
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : null);
      setState('error');
    }
  }, [code, oxyServices]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { state, info, biometricFailed, errorMessage, approve, deny, reload };
}
