import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useSessionAutoConnect,
  type SessionAutoConnectInput,
} from '@/hooks/identity/useSessionAutoConnect';
import { useSessionConnectStore } from '@/hooks/identity/sessionConnectStore';

/** All preconditions met (a returning user in the vault with no live session). */
function makeProps(overrides: Partial<SessionAutoConnectInput> = {}): SessionAutoConnectInput {
  return {
    isAuthResolved: true,
    hasUser: false,
    onboardingComplete: true,
    identityPresent: true,
    online: true,
    syncIdentity: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mount(props: SessionAutoConnectInput) {
  return renderHook((p: SessionAutoConnectInput) => useSessionAutoConnect(p), {
    initialProps: props,
  });
}

/** Flush microtasks so a just-mounted effect's async body settles. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useSessionAutoConnect', () => {
  beforeEach(() => {
    useSessionConnectStore.getState().reset();
  });

  it('connects once, from the identity key, when every precondition is met', async () => {
    const syncIdentity = jest.fn().mockResolvedValue({ id: 'me' });
    mount(makeProps({ syncIdentity }));

    await waitFor(() => expect(syncIdentity).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['offline', { online: false }],
    ['there is no local identity', { identityPresent: false }],
    ['a live session is already present', { hasUser: true }],
    ['onboarding is still in progress', { onboardingComplete: false }],
    ['the cold boot has not resolved', { isAuthResolved: false }],
  ])('does not connect when %s', async (_label, overrides: Partial<SessionAutoConnectInput>) => {
    const syncIdentity = jest.fn().mockResolvedValue(undefined);
    mount(makeProps({ syncIdentity, ...overrides }));

    await flush();
    expect(syncIdentity).not.toHaveBeenCalled();
  });

  it('does not launch a second attempt on re-render (single-flight ref guard)', async () => {
    const syncIdentity = jest.fn().mockResolvedValue(undefined);
    const { rerender } = mount(makeProps({ syncIdentity }));

    await waitFor(() => expect(syncIdentity).toHaveBeenCalledTimes(1));
    rerender(makeProps({ syncIdentity }));
    rerender(makeProps({ syncIdentity }));
    await flush();

    expect(syncIdentity).toHaveBeenCalledTimes(1);
  });

  it('publishes phase error after a failed attempt', async () => {
    const syncIdentity = jest.fn().mockRejectedValue(new Error('boom'));
    mount(makeProps({ syncIdentity }));

    await waitFor(() => expect(useSessionConnectStore.getState().phase).toBe('error'));
    expect(syncIdentity).toHaveBeenCalledTimes(1);
  });

  it('retries immediately when a manual retry is requested after a failure', async () => {
    const syncIdentity = jest
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'me' });
    mount(makeProps({ syncIdentity }));

    await waitFor(() => expect(useSessionConnectStore.getState().phase).toBe('error'));

    act(() => {
      useSessionConnectStore.getState().requestRetry();
    });

    await waitFor(() => expect(syncIdentity).toHaveBeenCalledTimes(2));
  });
});
