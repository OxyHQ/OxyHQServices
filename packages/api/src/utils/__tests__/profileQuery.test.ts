import { eligibleUserMatch, FEDERATED_RECOMMENDATION_MAX_AGE_MS, isDiscoverableUser, isFederatableUser } from '../profileQuery';

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

describe('isDiscoverableUser', () => {
  it('accepts active users without a reputation tier', () => {
    expect(isDiscoverableUser({ accountStatus: 'active' })).toBe(true);
  });

  it('rejects archived accounts', () => {
    expect(isDiscoverableUser({ accountStatus: 'archived' })).toBe(false);
  });

  it('rejects restricted-tier accounts', () => {
    expect(isDiscoverableUser({ accountStatus: 'active', reputationTier: 'restricted' })).toBe(false);
  });
});

describe('isFederatableUser', () => {
  it('accepts discoverable users with sharing enabled or unset', () => {
    expect(isFederatableUser({ accountStatus: 'active' })).toBe(true);
    expect(isFederatableUser({ accountStatus: 'active', privacySettings: { fediverseSharing: true } })).toBe(true);
  });

  it('rejects users who opted out of fediverse sharing', () => {
    expect(
      isFederatableUser({
        accountStatus: 'active',
        privacySettings: { fediverseSharing: false },
      }),
    ).toBe(false);
  });

  it('rejects archived and restricted users regardless of sharing', () => {
    expect(
      isFederatableUser({
        accountStatus: 'archived',
        privacySettings: { fediverseSharing: true },
      }),
    ).toBe(false);
    expect(
      isFederatableUser({
        accountStatus: 'active',
        reputationTier: 'restricted',
        privacySettings: { fediverseSharing: true },
      }),
    ).toBe(false);
  });
});
