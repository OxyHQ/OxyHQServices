import { eligibleUserMatch, FEDERATED_RECOMMENDATION_MAX_AGE_MS } from '../profileQuery';

describe('eligibleUserMatch', () => {
  const minResolvedAt = new Date(Date.now() - FEDERATED_RECOMMENDATION_MAX_AGE_MS);

  it('excludes archived accounts from discovery pipelines', () => {
    const match = eligibleUserMatch(minResolvedAt);
    expect(match.$and).toEqual(
      expect.arrayContaining([
        { accountStatus: { $ne: 'archived' } },
      ]),
    );
  });

  it('excludes restricted-tier accounts from discovery pipelines', () => {
    const match = eligibleUserMatch(minResolvedAt);
    expect(match.$and).toEqual(
      expect.arrayContaining([
        { reputationTier: { $ne: 'restricted' } },
      ]),
    );
  });

  it('prefixes the archived exclusion when nested under user.', () => {
    const match = eligibleUserMatch(minResolvedAt, 'user.');
    expect(match.$and).toEqual(
      expect.arrayContaining([
        { 'user.accountStatus': { $ne: 'archived' } },
      ]),
    );
  });

  it('prefixes the restricted-tier exclusion when nested under user.', () => {
    const match = eligibleUserMatch(minResolvedAt, 'user.');
    expect(match.$and).toEqual(
      expect.arrayContaining([
        { 'user.reputationTier': { $ne: 'restricted' } },
      ]),
    );
  });
});
