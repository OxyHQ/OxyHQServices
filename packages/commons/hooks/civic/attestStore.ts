import { create } from 'zustand';
import type { OxyServices } from '@oxyhq/core';
import type { RealLifeAttestationResult } from '@oxyhq/contracts';
import { userIdFromDid } from '@/lib/civic/did';
import { attestErrorCode, type AttestErrorCode } from '@/lib/civic/civic-errors';

/**
 * Zustand store for the real-life attestation FLOW on the SCANNER's (B's) side.
 *
 * The flow is fully automatic: the moment a scan / NFC-read EVENT yields an
 * attest payload, {@link AttestFlowStore.submit} signs and submits it — no
 * biometric gate, no confirm button. The server upserts idempotently, so
 * re-confirming the same person is fine and there is deliberately NO
 * client-side cooldown or dedupe here.
 *
 * This store owns ONLY the flow state (what B just did); the subject's card
 * (name/avatar) is server state and stays in TanStack Query (`useCivicCard`,
 * keyed off `subjectUserId`). `result` is the response of this flow's own
 * one-shot submit — the analogue of a mutation result, not mirrored reads.
 */

/**
 *   idle       → no attestation in flight (nothing scanned yet / after reset)
 *   submitting → payload received; signing + submitting automatically
 *   done       → accepted (points awarded to A)
 *   error      → rejected / failed (see `errorCode`)
 */
export type AttestFlowStatus = 'idle' | 'submitting' | 'done' | 'error';

/** The fields the scanner (B) carries over from a parsed attest payload. */
export interface AttestSubmitParams {
  subjectDid: string;
  context: string;
  nonce: string;
  exp: number;
}

/** The single SDK capability the submit needs (narrow keeps tests honest). */
type AttestSubmitServices = Pick<OxyServices, 'submitRealLifeAttestation'>;

export interface AttestFlowState {
  status: AttestFlowStatus;
  /** A's DID as carried by the payload of the CURRENT attestation. */
  subjectDid: string | null;
  /** A's account id (derived from the DID) — the `useCivicCard` key. */
  subjectUserId: string | null;
  /** The accepted result (points awarded) for the `done` status. */
  result: RealLifeAttestationResult | null;
  /** Classified rejection code for the `error` status (drives friendly copy). */
  errorCode: AttestErrorCode | null;
}

export interface AttestFlowStore extends AttestFlowState {
  /**
   * Sign + submit the attestation for a freshly parsed payload. One shot: the
   * payload carries a signed single-use nonce, so a failed submit is NEVER
   * auto-retried (re-driving the request could only burn the nonce) — the user
   * scans a fresh payload instead. Enters `submitting` synchronously.
   */
  submit: (params: AttestSubmitParams, oxyServices: AttestSubmitServices) => Promise<void>;
  /** Return to `idle` and abandon any in-flight submission's outcome. */
  reset: () => void;
}

const defaultState: AttestFlowState = {
  status: 'idle',
  subjectDid: null,
  subjectUserId: null,
  result: null,
  errorCode: null,
};

export const useAttestStore = create<AttestFlowStore>((set) => {
  // Monotonic id of the CURRENT submission. A completion (success or failure)
  // applies only while it is still current, so a newer payload or a reset is
  // never clobbered by a stale in-flight response — each payload's flow is
  // independent.
  let submission = 0;

  return {
    ...defaultState,

    submit: async (params, oxyServices) => {
      const current = ++submission;

      const subjectUserId = userIdFromDid(params.subjectDid);
      if (!subjectUserId) {
        // The DID in the payload cannot resolve to an account — surface the
        // same friendly copy an unknown subject gets, without burning a request.
        set({
          status: 'error',
          subjectDid: params.subjectDid,
          subjectUserId: null,
          result: null,
          errorCode: 'subject_not_found',
        });
        return;
      }

      set({
        status: 'submitting',
        subjectDid: params.subjectDid,
        subjectUserId,
        result: null,
        errorCode: null,
      });

      try {
        const result = await oxyServices.submitRealLifeAttestation({
          subjectDid: params.subjectDid,
          context: params.context,
          nonce: params.nonce,
          exp: params.exp,
          biometricOk: false,
        });
        if (current !== submission) return;
        set({ status: 'done', result, errorCode: null });
      } catch (error) {
        if (current !== submission) return;
        set({ status: 'error', result: null, errorCode: attestErrorCode(error) });
      }
    },

    reset: () => {
      submission++;
      set(defaultState);
    },
  };
});
