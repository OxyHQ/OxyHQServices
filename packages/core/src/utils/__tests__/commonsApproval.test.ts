import {
  getCommonsApprovalBlockingReason,
  parseCommonsApprovalExpiresAt,
} from '../commonsApproval';

describe('commonsApproval validation', () => {
  const application = {
    id: 'app1',
    name: 'Mention',
    type: 'first_party' as const,
    isOfficial: true,
    isInternal: false,
    scopes: ['profile'],
  };

  it('blocks when the application is missing', () => {
    expect(
      getCommonsApprovalBlockingReason({
        application: null,
        status: 'pending',
        expiresAt: Date.now() + 60_000,
      }),
    ).toMatch(/could not be resolved/i);
  });

  it('blocks non-pending sessions', () => {
    expect(
      getCommonsApprovalBlockingReason({
        application,
        status: 'expired',
        expiresAt: Date.now() + 60_000,
      }),
    ).toMatch(/invalid, already used, or expired/i);
  });

  it('blocks expired pending sessions (ISO expiresAt)', () => {
    expect(
      getCommonsApprovalBlockingReason({
        application,
        status: 'pending',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toMatch(/expired/i);
  });

  it('allows a pending, unexpired session', () => {
    expect(
      getCommonsApprovalBlockingReason({
        application,
        status: 'pending',
        expiresAt: Date.now() + 60_000,
      }),
    ).toBeNull();
  });

  it('parses ISO expiresAt strings', () => {
    const iso = '2026-07-19T12:00:00.000Z';
    expect(parseCommonsApprovalExpiresAt(iso)).toBe(Date.parse(iso));
  });
});
