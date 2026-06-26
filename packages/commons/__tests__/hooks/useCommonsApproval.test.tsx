import { act, renderHook, waitFor } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';

const authenticateMock = jest.fn<Promise<{ success: boolean; error?: string }>, [string?]>();

// Replace the biometric helper entirely so the test controls the gate result
// and never loads `expo-local-authentication`.
jest.mock('@/lib/biometricAuth', () => ({
  authenticate: (...args: [string?]) => authenticateMock(...args),
}));

// Imported AFTER jest.mock so the hook sees the patched biometric helper.
// eslint-disable-next-line import/first
import { useCommonsApproval } from '@/hooks/commons-signin/useCommonsApproval';

const SAMPLE_INFO = {
  application: {
    id: 'app1',
    name: 'Mention',
    type: 'first_party',
    isOfficial: true,
    isInternal: false,
    scopes: ['profile:read'],
    developerName: 'Oxy',
  },
  scopes: ['profile:read', 'email:read'],
  boundOrigin: 'https://mention.earth',
  expiresAt: Date.now() + 300_000,
  status: 'pending',
};

interface ServiceOverrides {
  getCommonsApprovalInfo?: jest.Mock;
  approveCommonsSignIn?: jest.Mock;
  denyCommonsSignIn?: jest.Mock;
}

function installServices(overrides: ServiceOverrides = {}) {
  const services = {
    getCommonsApprovalInfo: jest.fn(async () => SAMPLE_INFO),
    approveCommonsSignIn: jest.fn(async () => ({ success: true })),
    denyCommonsSignIn: jest.fn(async () => ({ success: true })),
    ...overrides,
  };
  __setOxyState({
    isAuthenticated: true,
    user: { username: 'nate' },
    oxyServices: services,
  });
  return services;
}

describe('useCommonsApproval', () => {
  beforeEach(() => {
    __resetOxyState();
    authenticateMock.mockReset();
  });

  it('resolves the server-side application identity on mount', async () => {
    const services = installServices();
    const { result } = renderHook(() => useCommonsApproval('code-1', 'reason'));

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(services.getCommonsApprovalInfo).toHaveBeenCalledWith('code-1');
    expect(result.current.info?.application.name).toBe('Mention');
    expect(result.current.info?.application.isOfficial).toBe(true);
  });

  it('enters the error state when the code cannot be resolved', async () => {
    installServices({
      getCommonsApprovalInfo: jest.fn(async () => {
        throw new Error('used');
      }),
    });
    const { result } = renderHook(() => useCommonsApproval('bad', 'reason'));

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.errorMessage).toBe('used');
  });

  it('errors immediately when no code is supplied', async () => {
    installServices();
    const { result } = renderHook(() => useCommonsApproval(undefined, 'reason'));

    await waitFor(() => expect(result.current.state).toBe('error'));
  });

  it('approves only AFTER the biometric gate passes', async () => {
    const services = installServices();
    authenticateMock.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useCommonsApproval('code-1', 'reason'));
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      await result.current.approve();
    });

    expect(authenticateMock).toHaveBeenCalledWith('reason');
    expect(services.approveCommonsSignIn).toHaveBeenCalledWith({ authorizeCode: 'code-1' });
    expect(result.current.state).toBe('approved');
  });

  it('does NOT call approveCommonsSignIn when the biometric gate fails', async () => {
    const services = installServices();
    authenticateMock.mockResolvedValue({ success: false, error: 'user_cancel' });
    const { result } = renderHook(() => useCommonsApproval('code-1', 'reason'));
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      await result.current.approve();
    });

    expect(services.approveCommonsSignIn).not.toHaveBeenCalled();
    expect(result.current.biometricFailed).toBe(true);
    expect(result.current.state).toBe('ready');
  });

  it('denies via denyCommonsSignIn', async () => {
    const services = installServices();
    const { result } = renderHook(() => useCommonsApproval('code-1', 'reason'));
    await waitFor(() => expect(result.current.state).toBe('ready'));

    await act(async () => {
      await result.current.deny();
    });

    expect(services.denyCommonsSignIn).toHaveBeenCalledWith('code-1');
    expect(result.current.state).toBe('denied');
  });
});
