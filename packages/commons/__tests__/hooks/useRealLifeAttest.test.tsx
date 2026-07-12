import { act, renderHook, waitFor } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';

const authenticateMock = jest.fn<Promise<{ success: boolean; error?: string }>, [string?]>();
jest.mock('@/lib/biometricAuth', () => ({
  authenticate: (...args: [string?]) => authenticateMock(...args),
}));

// eslint-disable-next-line import/first
import { useRealLifeAttest, type RealLifeAttestParams } from '@/hooks/useRealLifeAttest';

const SUBJECT_DID = 'did:web:oxy.so:u:subjectUser';
const PARAMS: RealLifeAttestParams = {
  subjectDid: SUBJECT_DID,
  context: 'ctx-1',
  nonce: 'nonce-1',
  exp: Date.now() + 5 * 60 * 1000,
};

const CARD = {
  card: {
    did: SUBJECT_DID,
    userId: 'subjectUser',
    name: 'Alex Subject',
    username: 'alex',
    trustTier: 'trusted' as const,
    personhoodStatus: 'unverified' as const,
    verifiedDomains: [],
    credentialBadges: [],
    issuedAt: 1,
  },
  attestation: null,
  verified: true,
};

function install(overrides: Record<string, jest.Mock> = {}) {
  const services = {
    getPublicCard: jest.fn(async () => CARD),
    submitRealLifeAttestation: jest.fn(async () => ({
      accepted: true,
      recordId: 'rec-1',
      subjectUserId: 'subjectUser',
      attestorUserId: 'me',
      points: 25,
    })),
    ...overrides,
  };
  __setOxyState({ isAuthenticated: true, user: { id: 'me' }, oxyServices: services });
  return services;
}

describe('useRealLifeAttest', () => {
  beforeEach(() => {
    __resetOxyState();
    authenticateMock.mockReset();
  });

  it('resolves the subject card from the DID and auto-runs the gate on mount', async () => {
    const services = install();
    authenticateMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useRealLifeAttest(PARAMS, 'reason'));

    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(services.getPublicCard).toHaveBeenCalledWith('subjectUser');
    expect(result.current.subject?.card.name).toBe('Alex Subject');
  });

  it('auto-submits the attestation after the biometric gate passes — no manual confirm', async () => {
    const services = install();
    authenticateMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useRealLifeAttest(PARAMS, 'reason'));

    // The tap is the intent: mounting alone (no confirm() call) drives the flow.
    await waitFor(() => expect(result.current.state).toBe('done'));

    expect(authenticateMock).toHaveBeenCalledWith('reason');
    expect(authenticateMock).toHaveBeenCalledTimes(1);
    expect(services.submitRealLifeAttestation).toHaveBeenCalledWith({
      subjectDid: SUBJECT_DID,
      context: 'ctx-1',
      nonce: 'nonce-1',
      exp: PARAMS.exp,
      biometricOk: true,
    });
    expect(result.current.result?.points).toBe(25);
  });

  it('does NOT submit when the biometric gate fails, and does not re-prompt in a loop', async () => {
    const services = install();
    authenticateMock.mockResolvedValue({ success: false, error: 'user_cancel' });
    const { result } = renderHook(() => useRealLifeAttest(PARAMS, 'reason'));

    await waitFor(() => expect(result.current.biometricFailed).toBe(true));
    expect(services.submitRealLifeAttestation).not.toHaveBeenCalled();
    expect(result.current.state).toBe('ready');
    // Auto-run fired exactly once; a failure must not spin the biometric prompt.
    expect(authenticateMock).toHaveBeenCalledTimes(1);
  });

  it('lets the caller retry the biometric gate after a failure', async () => {
    const services = install();
    authenticateMock.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    const { result } = renderHook(() => useRealLifeAttest(PARAMS, 'reason'));
    await waitFor(() => expect(result.current.biometricFailed).toBe(true));

    authenticateMock.mockResolvedValue({ success: true });
    await act(async () => {
      await result.current.confirm();
    });

    expect(services.submitRealLifeAttestation).toHaveBeenCalledTimes(1);
    expect(result.current.state).toBe('done');
  });

  it('classifies a server rejection into an error code', async () => {
    install({
      submitRealLifeAttestation: jest.fn(async () => {
        throw new Error('Attestation rejected: nonce_used');
      }),
    });
    authenticateMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useRealLifeAttest(PARAMS, 'reason'));

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorCode).toBe('nonce_used');
  });

  it('errors immediately when the payload could not be parsed (null params)', async () => {
    install();
    const { result } = renderHook(() => useRealLifeAttest(null, 'reason'));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorCode).toBe('generic');
  });
});
