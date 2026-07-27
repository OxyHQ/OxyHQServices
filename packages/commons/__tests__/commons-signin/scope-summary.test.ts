import { summarizeScopes } from '@/lib/commons-signin/scope-summary';

describe('summarizeScopes', () => {
  it('maps known scopes to the shared consent sentences', () => {
    expect(summarizeScopes(['profile:read', 'email:read'])).toEqual([
      { scope: 'profile:read', translationKey: 'consent.scopes.profile' },
      { scope: 'email:read', translationKey: 'consent.scopes.email' },
    ]);
  });

  it('preserves the order the server resolved the scopes in', () => {
    const lines = summarizeScopes(['files:write', 'openid', 'profile']);
    expect(lines.map((line) => line.translationKey)).toEqual([
      'consent.scopes.filesWrite',
      'consent.scopes.openid',
      'consent.scopes.profile',
    ]);
  });

  it('collapses scopes that mean the same thing into one line', () => {
    expect(summarizeScopes(['profile', 'profile:read'])).toEqual([
      { scope: 'profile', translationKey: 'consent.scopes.profile' },
    ]);
  });

  it('de-duplicates a repeated scope', () => {
    expect(summarizeScopes(['email', 'email'])).toHaveLength(1);
  });

  it('shows an unknown scope verbatim rather than hiding it', () => {
    // A permission this build has no sentence for is still a permission being
    // granted — the person approving must see that it exists.
    expect(summarizeScopes(['ledger:write'])).toEqual([{ scope: 'ledger:write' }]);
  });

  it('keeps two distinct unknown scopes as two lines', () => {
    expect(summarizeScopes(['a:write', 'b:write'])).toHaveLength(2);
  });

  it('ignores blank entries', () => {
    expect(summarizeScopes(['', '   ', 'openid'])).toEqual([
      { scope: 'openid', translationKey: 'consent.scopes.openid' },
    ]);
  });

  it('returns nothing for a request that carries no scopes', () => {
    expect(summarizeScopes([])).toEqual([]);
  });
});
