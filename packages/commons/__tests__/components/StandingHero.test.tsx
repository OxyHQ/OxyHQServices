import React from 'react';
import { render } from '@testing-library/react';
import { __resetOxyState, __setOxyState } from '@/__mocks__/oxyhq-services';
import { __resetAsyncStorage } from '@/__mocks__/async-storage';
import { LocaleProvider } from '@/lib/i18n/locale-context';
import { StandingHero } from '@/components/reputation/StandingHero';
import type { ReputationBalance } from '@oxyhq/core';

const BALANCE: ReputationBalance = {
  userId: 'me',
  total: 47,
  positive: 57,
  negative: -10,
  breakdown: { content: 5, social: 3, trust: 8, moderation: 0, physical: 25, penalties: 10 },
  trustTier: 'new',
  influence: { defaultWeight: 1.4, reportWeight: 1.4, moderationWeight: 0.7, rankingFeedbackWeight: 1.1 },
  reliability: { accurateReports: 9, rejectedReports: 1, reportAccuracyScore: 0.9, abuseScore: 0.05 },
  recalculatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function renderHero(balance: ReputationBalance, isOffline = false) {
  return render(
    <LocaleProvider>
      <StandingHero balance={balance} isOffline={isOffline} />
    </LocaleProvider>,
  );
}

describe('StandingHero', () => {
  beforeEach(() => {
    __resetAsyncStorage();
    __resetOxyState();
    __setOxyState({ user: { id: 'me', language: 'en-US' } });
  });

  it('renders the trust tier as the headline with progress toward the next tier', () => {
    const { container } = renderHero(BALANCE);
    expect(container.textContent).toContain('New');
    expect(container.textContent).toContain('47 → 100');
    expect(container.textContent).toContain('53 to Trusted');
  });

  it('renders the influence and reliability stat chips', () => {
    const { container } = renderHero(BALANCE);
    expect(container.textContent).toContain('×1.4');
    expect(container.textContent).toContain('90%');
    expect(container.textContent).toContain('Influence');
    expect(container.textContent).toContain('Reliability');
  });

  it('renders the verified "max" state with no points progress', () => {
    const { container } = renderHero({ ...BALANCE, trustTier: 'verified', total: 1200 });
    expect(container.textContent).toContain('highest standing');
    expect(container.textContent).not.toContain('to Trusted');
  });

  it('surfaces the offline chip when rendering cached data offline', () => {
    const { container } = renderHero(BALANCE, true);
    expect(container.textContent).toContain('Offline');
  });
});
