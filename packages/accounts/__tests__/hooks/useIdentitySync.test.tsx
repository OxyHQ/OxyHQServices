import React from 'react';
import { renderHook, waitFor, act } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';
import { LocaleProvider } from '@/lib/i18n/locale-context';

/**
 * Identity-sync contract for the home screen.
 *
 * `useIdentitySync` wraps the on-mount check-and-sync behaviour and the
 * "username required" modal flow that previously lived inline on the home
 * screen. These tests pin the load-bearing semantics: it only syncs when the
 * identity is reported NOT synced, it surfaces the modal on a
 * `USERNAME_REQUIRED` error, and it swallows any other sync error.
 */

const syncIdentityMock = jest.fn<Promise<unknown>, []>();
const isIdentitySyncedMock = jest.fn<Promise<boolean>, []>();
const toastErrorMock = jest.fn();

let identitySyncState = { isSynced: false, isSyncing: false };

// Surgically mock the identity hook so we control sync state + outcomes
// without standing up KeyManager / secure storage.
jest.mock('@/hooks/useIdentity', () => ({
  useIdentity: () => ({
    syncIdentity: syncIdentityMock,
    isIdentitySynced: isIdentitySyncedMock,
    identitySyncState,
  }),
}));

jest.mock('@oxyhq/bloom', () => ({
  toast: { error: (msg: string) => toastErrorMock(msg) },
}));

// Imported after the mocks so the hook resolves the patched modules.
// eslint-disable-next-line import/first
import { useIdentitySync } from '@/hooks/identity/useIdentitySync';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <LocaleProvider>{children}</LocaleProvider>;
}

function makeUsernameRequiredError(): Error & { code: string } {
  const err = new Error('USERNAME_REQUIRED') as Error & { code: string };
  err.code = 'USERNAME_REQUIRED';
  return err;
}

describe('useIdentitySync', () => {
  beforeEach(() => {
    __resetOxyState();
    syncIdentityMock.mockReset();
    isIdentitySyncedMock.mockReset();
    toastErrorMock.mockReset();
    identitySyncState = { isSynced: false, isSyncing: false };
    __setOxyState({ user: { language: 'en-US' } });
  });

  it('does not sync when the identity is already synced', async () => {
    isIdentitySyncedMock.mockResolvedValue(true);
    renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(isIdentitySyncedMock).toHaveBeenCalled();
    });
    expect(syncIdentityMock).not.toHaveBeenCalled();
  });

  it('auto-syncs when the identity is reported not synced', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockResolvedValue(undefined);
    renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(syncIdentityMock).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces the username modal when sync throws USERNAME_REQUIRED', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockRejectedValue(makeUsernameRequiredError());
    const { result } = renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.showUsernameModal).toBe(true);
    });
  });

  it('does not surface the modal for non-username sync errors', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(syncIdentityMock).toHaveBeenCalled();
    });
    expect(result.current.showUsernameModal).toBe(false);
  });

  it('retries the sync and hides the modal on completion', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockRejectedValueOnce(makeUsernameRequiredError());
    const { result } = renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.showUsernameModal).toBe(true);
    });

    syncIdentityMock.mockResolvedValueOnce(undefined);
    await act(async () => {
      await result.current.handleUsernameModalComplete();
    });

    expect(result.current.showUsernameModal).toBe(false);
    // initial auto-sync + the retry
    expect(syncIdentityMock).toHaveBeenCalledTimes(2);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('toasts when the post-username retry fails', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockRejectedValueOnce(makeUsernameRequiredError());
    const { result } = renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.showUsernameModal).toBe(true);
    });

    syncIdentityMock.mockRejectedValueOnce(new Error('still failing'));
    await act(async () => {
      await result.current.handleUsernameModalComplete();
    });

    expect(result.current.showUsernameModal).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith('still failing');
  });

  it('dismissUsernameModal hides the modal without retrying', async () => {
    isIdentitySyncedMock.mockResolvedValue(false);
    syncIdentityMock.mockRejectedValueOnce(makeUsernameRequiredError());
    const { result } = renderHook(() => useIdentitySync(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.showUsernameModal).toBe(true);
    });

    const callsBefore = syncIdentityMock.mock.calls.length;
    act(() => {
      result.current.dismissUsernameModal();
    });

    expect(result.current.showUsernameModal).toBe(false);
    expect(syncIdentityMock.mock.calls.length).toBe(callsBefore);
  });
});
