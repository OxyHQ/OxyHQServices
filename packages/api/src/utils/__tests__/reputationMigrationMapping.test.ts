/**
 * Migration mapping tests (karma → reputation, #217).
 *
 * Covers the documented legacy-category → ReputationCategory mapping and the
 * per-entry category inference. The end-to-end "history → transactions → recalc
 * → re-run no-op" flow is exercised against the in-memory store in
 * services/__tests__/reputationMigration.test.ts.
 */

import {
  mapLegacyRuleCategory,
  inferTransactionCategory,
} from '../reputationMigrationMapping';
import type { ReputationCategory } from '../reputation.constants';

describe('mapLegacyRuleCategory', () => {
  it('maps known legacy categories', () => {
    expect(mapLegacyRuleCategory('content')).toBe('content');
    expect(mapLegacyRuleCategory('social')).toBe('social');
    expect(mapLegacyRuleCategory('system')).toBe('trust');
    expect(mapLegacyRuleCategory('purchases')).toBe('other');
    expect(mapLegacyRuleCategory('other')).toBe('other');
  });

  it('falls back to "other" for unknown / missing categories', () => {
    expect(mapLegacyRuleCategory(undefined)).toBe('other');
    expect(mapLegacyRuleCategory('nonsense')).toBe('other');
  });
});

describe('inferTransactionCategory', () => {
  const rules = new Map<string, ReputationCategory>([['post_created', 'content']]);

  it('prefers the matching rule category', () => {
    expect(inferTransactionCategory('post_created', 5, rules)).toBe('content');
    // Even a negative-point entry keeps the rule category when one exists.
    expect(inferTransactionCategory('post_created', -5, rules)).toBe('content');
  });

  it('infers "penalty" for negative points without a matching rule', () => {
    expect(inferTransactionCategory('mystery', -3, rules)).toBe('penalty');
  });

  it('infers "other" for positive points without a matching rule', () => {
    expect(inferTransactionCategory('mystery', 3, rules)).toBe('other');
  });
});
