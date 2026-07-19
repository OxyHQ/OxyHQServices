import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react';
import {
  __resetOxyState,
  __setOxyState,
  __setOnlineStatus,
} from '@/__mocks__/oxyhq-services';
import { __resetAsyncStorage } from '@/__mocks__/async-storage';
import { LocaleProvider } from '@/lib/i18n/locale-context';
import { useSessionConnectStore } from '@/hooks/identity/sessionConnectStore';

// The gate reads the onboarding verdict for its defensive no-identity branch.
// Drive it directly rather than standing up React Query + KeyManager.
const mockOnboarding: { status: string; identityPresent: boolean } = {
  status: 'complete',
  identityPresent: true,
};
jest.mock('@/hooks/useOnboardingStatus', () => ({
  ...jest.requireActual('@/hooks/useOnboardingStatus'),
  useOnboardingStatus: () => mockOnboarding,
}));

import { SessionGate } from '@/components/ui/session-gate';

function renderGate() {
  return render(
    <LocaleProvider>
      <SessionGate>
        <Text>PRIVATE CONTENT</Text>
      </SessionGate>
    </LocaleProvider>,
  );
}

describe('SessionGate', () => {
  beforeEach(() => {
    __resetAsyncStorage();
    __resetOxyState();
    __setOnlineStatus(true);
    useSessionConnectStore.getState().reset();
    mockOnboarding.status = 'complete';
    mockOnboarding.identityPresent = true;
  });

  it('shows a bounded loading state while the cold boot is still resolving', () => {
    __setOxyState({ isAuthResolved: false, user: null });
    const { container } = renderGate();

    expect(container.textContent).toContain('Connecting your identity');
    expect(container.textContent).not.toContain('PRIVATE CONTENT');
  });

  it('renders the children once a live session is up', () => {
    __setOxyState({ isAuthResolved: true, user: { id: 'me' } });
    const { container } = renderGate();

    expect(container.textContent).toContain('PRIVATE CONTENT');
  });

  it('shows the connecting state — never a sign-in prompt — when resolved with no session', () => {
    __setOxyState({ isAuthResolved: true, user: null });
    const { container } = renderGate();

    expect(container.textContent).toContain('Connecting your identity');
    expect(container.textContent).not.toContain('PRIVATE CONTENT');
    // Commons IS the identity: the vault must never ask its owner to sign in.
    expect(container.textContent?.toLowerCase()).not.toContain('sign in');
  });

  it('shows a calm offline notice (no action) when resolved with no session and offline', () => {
    __setOxyState({ isAuthResolved: true, user: null });
    __setOnlineStatus(false);
    const { container } = renderGate();

    expect(container.textContent).toContain("You're offline");
    expect(container.textContent).not.toContain('PRIVATE CONTENT');
  });

  it('offers a Retry that requests an immediate reconnect after a failed attempt', () => {
    __setOxyState({ isAuthResolved: true, user: null });
    useSessionConnectStore.getState().setPhase('error');
    const { container, getByText } = renderGate();

    expect(container.textContent).toContain("Couldn't connect");
    expect(useSessionConnectStore.getState().retryNonce).toBe(0);

    fireEvent.click(getByText('Retry'));

    expect(useSessionConnectStore.getState().retryNonce).toBe(1);
    expect(useSessionConnectStore.getState().phase).toBe('connecting');
  });

  it('routes to onboarding — never sign-in — when the local identity is absent', () => {
    __setOxyState({ isAuthResolved: true, user: null });
    mockOnboarding.status = 'none';
    mockOnboarding.identityPresent = false;
    const { container } = renderGate();

    // The expo-router mock renders a <Redirect href> marker.
    expect(container.innerHTML).toContain('/(auth)');
    expect(container.textContent).not.toContain('PRIVATE CONTENT');
    expect(container.textContent?.toLowerCase()).not.toContain('sign in');
  });
});
