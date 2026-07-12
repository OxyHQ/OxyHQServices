import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { CivicCardResult } from '@oxyhq/core';
import type { RealLifeAttestationResult } from '@oxyhq/contracts';
import { userIdFromDid } from '@/lib/civic/did';
import { attestErrorCode, type AttestErrorCode } from '@/lib/civic/civic-errors';
import { authenticate } from '@/lib/biometricAuth';
import { useCivicCard } from './useCivicCard';

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

/** The biometric-gated submit resolves to one of these — a cancelled gate is a
 *  normal outcome (retryable), NOT a thrown error (which is reserved for a real
 *  server rejection so it lands on `mutation.error`). */
type AttestOutcome =
  | { kind: 'done'; result: RealLifeAttestationResult }
  | { kind: 'biometric_failed' };

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
  confirm: () => void;
  /** Re-resolve the subject card (used by a "try again" affordance). */
  reload: () => void;
}

/**
 * Drives the real-life confirmation screen on the SCANNER's (B's) side.
 *
 * Resolves A's identity server-side from the DID carried in the QR (never
 * trusting the QR for display) via React Query (`useCivicCard`), gates the
 * signed attestation behind the device biometric (`authenticate`), then submits
 * a self-signed `real_life_attestation` via the SDK. The server enforces nonce
 * single-use, freshness, graph-exclusion and the per-pair cooldown; those
 * rejections surface as a classified `errorCode` for friendly copy.
 *
 * No `useEffect`: the card is a `useQuery`, the confirmation is a `useMutation`
 * fired by an explicit `confirm()` (the confirm button's press), and every
 * piece of returned state is DERIVED from those two — so nothing runs off a
 * mount side-effect, and the submit never races an unready bearer.
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
  const subjectUserId = params ? userIdFromDid(params.subjectDid) : null;
  const card = useCivicCard(subjectUserId);

  const mutation = useMutation<AttestOutcome, Error>({
    mutationKey: ['civic', 'attest', params?.nonce ?? null],
    mutationFn: async (): Promise<AttestOutcome> => {
      if (!oxyServices || !params) {
        throw new Error('No authenticated SDK or attest params.');
      }
      // Biometric/passcode gate — must pass BEFORE we sign the attestation. A
      // cancelled gate is a normal, retryable outcome (not a server rejection).
      const auth = await authenticate(biometricReason);
      if (!auth.success) {
        return { kind: 'biometric_failed' };
      }
      const result = await oxyServices.submitRealLifeAttestation({
        subjectDid: params.subjectDid,
        context: params.context,
        nonce: params.nonce,
        exp: params.exp,
        biometricOk: true,
      });
      return { kind: 'done', result };
    },
  });

  const confirm = useCallback(() => {
    if (!params) return;
    mutation.mutate();
  }, [params, mutation]);

  const reload = useCallback(() => {
    mutation.reset();
    void card.refetch();
  }, [mutation, card]);

  const done = mutation.data?.kind === 'done';
  const biometricFailed = mutation.data?.kind === 'biometric_failed';

  // Everything below is derived — no effects, no mirrored state.
  const state: RealLifeAttestState = !params
    ? 'error'
    : card.isError
      ? 'error'
      : done
        ? 'done'
        : mutation.isPending
          ? 'confirming'
          : mutation.isError
            ? 'error'
            : card.isPending
              ? 'loading'
              : 'ready';

  const errorCode: AttestErrorCode | null =
    state !== 'error' ? null : !params || card.isError ? 'generic' : attestErrorCode(mutation.error);

  const result = mutation.data?.kind === 'done' ? mutation.data.result : null;

  return {
    state,
    subject: card.data ?? null,
    biometricFailed,
    errorCode,
    result,
    confirm,
    reload,
  };
}
