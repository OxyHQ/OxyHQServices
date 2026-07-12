import { useCallback, useEffect, useRef, useState } from 'react';
import { useOxy } from '@oxyhq/services';
import type { CivicCardResult } from '@oxyhq/core';
import type { RealLifeAttestationResult } from '@oxyhq/contracts';
import { userIdFromDid } from '@/lib/civic/did';
import { attestErrorCode, type AttestErrorCode } from '@/lib/civic/civic-errors';
import { authenticate } from '@/lib/biometricAuth';

/**
 *   loading    → resolving the subject's (A's) public card
 *   ready      → subject resolved; awaiting B's confirmation
 *   confirming → biometric passed; signing + submitting the attestation
 *   done       → accepted (points awarded to A)
 *   error      → could not resolve / submit (see `errorCode`)
 */
export type RealLifeAttestState = 'loading' | 'ready' | 'confirming' | 'done' | 'error';

/** The QR fields the scanner (B) carries over from a parsed attest payload. */
export interface RealLifeAttestParams {
  subjectDid: string;
  context: string;
  nonce: string;
  exp: number;
}

export interface UseRealLifeAttest {
  state: RealLifeAttestState;
  /** The subject's (A's) signed public card — for showing their name/avatar. */
  subject: CivicCardResult | null;
  /** Set when the device biometric/passcode gate was not satisfied. */
  biometricFailed: boolean;
  /** Classified rejection code for the `error` state (drives friendly copy). */
  errorCode: AttestErrorCode | null;
  /** The accepted result (points awarded) for the `done` state. */
  result: RealLifeAttestationResult | null;
  /** Run the biometric gate, then sign + submit the attestation. */
  confirm: () => Promise<void>;
  /** Re-resolve the subject card (used by a "try again" affordance). */
  reload: () => void;
}

/**
 * Drives the real-life confirmation screen on the SCANNER's (B's) side.
 *
 * Resolves A's identity server-side from the DID carried in the QR (never
 * trusting the QR for display), gates the signed attestation behind the device
 * biometric (`authenticate`), then submits a self-signed `real_life_attestation`
 * via the SDK. The server enforces nonce single-use, freshness, graph-exclusion
 * and the per-pair cooldown; those rejections surface as a classified
 * `errorCode` for friendly copy.
 *
 * NATIVE-ONLY (the submit signs with the on-device key).
 *
 * @param params - The parsed attest QR fields, or `null` when the payload was
 *   unparseable (→ immediate `error`).
 * @param biometricReason - Localized prompt shown in the biometric dialog.
 */
export function useRealLifeAttest(
  params: RealLifeAttestParams | null,
  biometricReason: string,
): UseRealLifeAttest {
  const { oxyServices } = useOxy();
  const [state, setState] = useState<RealLifeAttestState>('loading');
  const [subject, setSubject] = useState<CivicCardResult | null>(null);
  const [biometricFailed, setBiometricFailed] = useState(false);
  const [errorCode, setErrorCode] = useState<AttestErrorCode | null>(null);
  const [result, setResult] = useState<RealLifeAttestationResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Guards the one automatic biometric+submit run per resolved subject (the tap
  // itself is the intent — there is no separate confirm button). Reset whenever
  // we re-resolve so a "try again" starts a fresh attempt.
  const autoRanRef = useRef(false);

  const subjectDid = params?.subjectDid ?? null;
  const context = params?.context ?? '';
  const nonce = params?.nonce ?? null;
  const exp = params?.exp ?? null;
  const subjectUserId = subjectDid ? userIdFromDid(subjectDid) : null;

  useEffect(() => {
    if (!params) {
      setState('error');
      setErrorCode('generic');
      return;
    }
    if (!oxyServices) return;
    if (!subjectUserId) {
      setState('error');
      setErrorCode('generic');
      return;
    }

    let cancelled = false;
    autoRanRef.current = false;
    setState('loading');
    setErrorCode(null);
    oxyServices
      .getPublicCard(subjectUserId)
      .then((card) => {
        if (cancelled) return;
        setSubject(card);
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('[useRealLifeAttest] Failed to resolve subject card', error);
        setErrorCode('generic');
        setState('error');
      });
    return () => {
      cancelled = true;
    };
    // `params` is intentionally excluded — its primitive fields (via
    // `subjectUserId`) are the real inputs; the object identity changes per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oxyServices, subjectUserId, reloadKey]);

  const confirm = useCallback(async () => {
    if (!oxyServices || !subjectDid || nonce === null || exp === null) return;

    // Biometric/passcode gate — must pass BEFORE we sign the attestation.
    setBiometricFailed(false);
    const auth = await authenticate(biometricReason);
    if (!auth.success) {
      setBiometricFailed(true);
      return;
    }

    setState('confirming');
    try {
      const res = await oxyServices.submitRealLifeAttestation({
        subjectDid,
        context,
        nonce,
        exp,
        biometricOk: true,
      });
      setResult(res);
      setState('done');
    } catch (error: unknown) {
      setErrorCode(attestErrorCode(error));
      setState('error');
    }
  }, [oxyServices, subjectDid, context, nonce, exp, biometricReason]);

  // The tap IS the confirmation intent: once the subject resolves, run the
  // biometric gate + signed submit automatically, exactly once. A biometric
  // failure leaves `autoRanRef` set so it does not re-prompt in a loop — the
  // screen exposes a manual "try again" that calls `confirm` directly.
  useEffect(() => {
    if (state === 'ready' && !autoRanRef.current && !biometricFailed) {
      autoRanRef.current = true;
      void confirm();
    }
  }, [state, biometricFailed, confirm]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { state, subject, biometricFailed, errorCode, result, confirm, reload };
}
