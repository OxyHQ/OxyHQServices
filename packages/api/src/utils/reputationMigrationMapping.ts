/**
 * Pure mapping helpers for the karma → reputation migration
 * (`scripts/migrate-karma-to-reputation.ts`). Extracted here so the
 * category-mapping rules are independently unit-testable without running the
 * migration's `main()` (which connects to MongoDB and calls `process.exit`).
 */

import type { ReputationCategory } from './reputation.constants';

/**
 * Map a legacy `KarmaRule.category` to the new `ReputationCategory`:
 *   content   → content
 *   social    → social
 *   system    → trust   (identity / trust-graph signals)
 *   purchases → other   (no real-world receipt in the legacy data)
 *   other     → other
 * Anything unrecognised / missing falls back to `other`.
 */
export function mapLegacyRuleCategory(legacy: string | undefined): ReputationCategory {
  switch (legacy) {
    case 'content':
      return 'content';
    case 'social':
      return 'social';
    case 'system':
      return 'trust';
    case 'purchases':
      return 'other';
    case 'other':
      return 'other';
    default:
      return 'other';
  }
}

/**
 * Infer the category for a migrated history entry: prefer the matching rule's
 * category, else negative points → `penalty`, else `other`.
 */
export function inferTransactionCategory(
  actionType: string,
  points: number,
  ruleCategoryByAction: Map<string, ReputationCategory>
): ReputationCategory {
  const ruleCategory = ruleCategoryByAction.get(actionType);
  if (ruleCategory) {
    return ruleCategory;
  }
  return points < 0 ? 'penalty' : 'other';
}
