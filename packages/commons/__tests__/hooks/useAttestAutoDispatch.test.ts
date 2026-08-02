import { renderHook } from '@testing-library/react';
import { useAttestAutoDispatch } from '@/hooks/civic/useAttestAutoDispatch';
import type { AttestSubmitParams } from '@/hooks/civic/attestStore';

const PARAMS: AttestSubmitParams = {
  subjectDid: 'did:web:oxy.so:u:subjectA',
  context: 'ctx-1',
  nonce: 'nonce-1',
  exp: Date.now() + 5 * 60 * 1000,
};

const OTHER: AttestSubmitParams = {
  subjectDid: 'did:web:oxy.so:u:subjectB',
  context: 'ctx-2',
  nonce: 'nonce-2',
  exp: PARAMS.exp,
};

/** Render `useAttestAutoDispatch` with a stable `submit` spy + a rerender helper. */
function renderDispatch(initial: { ready: boolean; params: AttestSubmitParams | null }) {
  const submit = jest.fn<void, [AttestSubmitParams]>();
  const view = renderHook(
    ({ ready, params }: { ready: boolean; params: AttestSubmitParams | null }) =>
      useAttestAutoDispatch(ready, params, submit),
    { initialProps: initial },
  );
  return { submit, ...view };
}

describe('useAttestAutoDispatch', () => {
  it('auto-dispatches exactly once when ready with params (no biometric involved)', () => {
    const { submit } = renderDispatch({ ready: true, params: PARAMS });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(PARAMS);
  });

  it('does NOT dispatch while not ready (canUsePrivateApi false), then fires once when it flips ready', () => {
    const { submit, rerender } = renderDispatch({ ready: false, params: PARAMS });
    // Gate closed — a cold launch must not race the session cold boot.
    expect(submit).not.toHaveBeenCalled();

    // A re-render that stays not-ready still does nothing.
    rerender({ ready: false, params: PARAMS });
    expect(submit).not.toHaveBeenCalled();

    // Readiness settles → fires exactly once.
    rerender({ ready: true, params: PARAMS });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(PARAMS);
  });

  it('does NOT re-fire on re-renders while the subject is stable', () => {
    const { submit, rerender } = renderDispatch({ ready: true, params: PARAMS });
    expect(submit).toHaveBeenCalledTimes(1);

    // Same subject, stable — no re-submit.
    rerender({ ready: true, params: PARAMS });
    // A fresh object with the SAME subject (e.g. a new render of the memo) must
    // still be a no-op — the one-shot is keyed on the subject DID, not identity.
    rerender({ ready: true, params: { ...PARAMS } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('re-arms and fires again when the subject changes', () => {
    const { submit, rerender } = renderDispatch({ ready: true, params: PARAMS });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenLastCalledWith(PARAMS);

    // A different subject re-arms the one-shot.
    rerender({ ready: true, params: OTHER });
    expect(submit).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenLastCalledWith(OTHER);
  });

  it('never dispatches when there are no params (unparseable tag)', () => {
    const { submit, rerender } = renderDispatch({ ready: true, params: null });
    expect(submit).not.toHaveBeenCalled();
    rerender({ ready: true, params: null });
    expect(submit).not.toHaveBeenCalled();
  });
});
