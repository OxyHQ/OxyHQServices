import { useEffect, useRef } from 'react';
import type { AttestSubmitParams } from './attestStore';

/**
 * One-shot, readiness-gated auto-dispatch for a real-life attestation that
 * arrives via an OS/system entry point — the Android NFC deep link (foreground
 * dispatch while `app/(scan)/attest.tsx` is open, OR a cold launch straight into
 * it). Unlike the in-app scanner, that entry point delivers NO in-app event to
 * hang the submit off, so this hook fires it imperatively the instant the flow
 * is ready.
 *
 * `ready` MUST fold in `canUsePrivateApi` from `useOxy()` (plus the subject
 * card having resolved): gating on private-API readiness is what stops a COLD
 * launch from racing the SDK's device-first session cold boot — structurally
 * preventing the 401 → SDK-sign-out that an un-gated submit would trigger.
 *
 * The submit is a one-shot per subject: once dispatched for a given
 * `subjectDid` it never re-fires for that same subject (a stable re-render or a
 * repeat of the same tag must not re-submit), but a DIFFERENT subject re-arms
 * it. Re-attesting is an idempotent server upsert, so even a repeat is safe —
 * this guard just avoids a redundant call. No biometric (the store submits with
 * `biometricOk: false`).
 *
 * The `useEffect` below is the SINGLE sanctioned effect in the entire attest
 * flow: an imperative one-shot bound to an EXTERNAL/OS entry point with no
 * in-app event — the same native-lifecycle/OS-deep-link category the project's
 * AGENTS.md allows (cf. `useNfcAttestEmitter`). It is NOT derived state and NOT
 * a control-flow crutch. Every other part of the attest flow stays effect-free.
 *
 * @param ready - `canUsePrivateApi && subjectCardResolved`. Never dispatch until true.
 * @param params - The parsed attest payload, or `null` when the tag was unparseable.
 * @param submit - Binds to the attest store's `submit` (already SDK-bound).
 */
export function useAttestAutoDispatch(
  ready: boolean,
  params: AttestSubmitParams | null,
  submit: (params: AttestSubmitParams) => void,
): void {
  // The subject we have already auto-dispatched for. `null` = not yet armed for
  // any subject; changing subject re-arms (`current !== params.subjectDid`).
  const dispatchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!ready || !params) {
      return;
    }
    if (dispatchedFor.current === params.subjectDid) {
      return;
    }
    dispatchedFor.current = params.subjectDid;
    submit(params);
  }, [ready, params, submit]);
}
