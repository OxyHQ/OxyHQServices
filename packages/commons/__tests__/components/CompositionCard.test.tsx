import React from 'react';
import { render } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';
import { __resetAsyncStorage } from '@/__mocks__/async-storage';
import { LocaleProvider } from '@/lib/i18n/locale-context';
import { CompositionCard } from '@/components/reputation/CompositionCard';
import { deriveReputationSources } from '@/lib/civic/reputation-sources';

function renderComposition(breakdown: Parameters<typeof deriveReputationSources>[0]) {
  return render(
    <LocaleProvider>
      <CompositionCard sources={deriveReputationSources(breakdown)} />
    </LocaleProvider>,
  );
}

describe('CompositionCard', () => {
  beforeEach(() => {
    __resetAsyncStorage();
    __resetOxyState();
    __setOxyState({ user: { id: 'me', language: 'en-US' } });
  });

  it('renders each positive source with its label, points, and compact weight tag', () => {
    const { container } = renderComposition({
      content: 5,
      social: 3,
      trust: 8,
      moderation: 0,
      physical: 25,
      penalties: 10,
    });

    expect(container.textContent).toContain('Real life');
    expect(container.textContent).toContain('Peer & civic');
    expect(container.textContent).toContain('Apps');
    expect(container.textContent).toContain('HIGH');
    expect(container.textContent).toContain('MED');
    expect(container.textContent).toContain('LOW');
    expect(container.textContent).toContain('Earned');
  });

  it('breaks penalties out separately as a subtracted value', () => {
    const { container } = renderComposition({
      content: 0,
      social: 0,
      trust: 0,
      moderation: 0,
      physical: 0,
      penalties: 10,
    });

    expect(container.textContent).toContain('Penalties');
    expect(container.textContent).toContain('-10');
  });

  it('shows the empty state when nothing has been earned or penalised', () => {
    const { container } = renderComposition({
      content: 0,
      social: 0,
      trust: 0,
      moderation: 0,
      physical: 0,
      penalties: 0,
    });

    expect(container.textContent).toContain('No reputation earned yet');
  });
});
