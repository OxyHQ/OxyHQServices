import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react';
import {
  __resetOxyState,
  __setOxyState,
  __getAuthDialogMock,
} from '@/__mocks__/oxyhq-services';
import { __resetAsyncStorage } from '@/__mocks__/async-storage';
import { LocaleProvider } from '@/lib/i18n/locale-context';
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
  });

  it('shows a bounded loading state while the cold boot is still resolving', () => {
    __setOxyState({ isAuthResolved: false, user: null });
    const { container } = renderGate();

    expect(container.textContent).toContain('Connecting');
    // The private children must not render until a session is resolved.
    expect(container.textContent).not.toContain('PRIVATE CONTENT');
  });

  it('shows a sign-in state and opens the sign-in dialog once resolved with no user', () => {
    __setOxyState({ isAuthResolved: true, user: null });
    const { container, getByText } = renderGate();

    expect(container.textContent).toContain('Sign in to continue');
    expect(container.textContent).not.toContain('PRIVATE CONTENT');

    fireEvent.click(getByText('Sign in'));
    expect(__getAuthDialogMock()).toHaveBeenCalledWith('signin');
  });

  it('renders the children once resolved with a signed-in user', () => {
    __setOxyState({ isAuthResolved: true, user: { id: 'me' } });
    const { container } = renderGate();

    expect(container.textContent).toContain('PRIVATE CONTENT');
    expect(container.textContent).not.toContain('Sign in to continue');
    expect(container.textContent).not.toContain('Connecting');
  });
});
