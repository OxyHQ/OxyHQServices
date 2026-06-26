/**
 * Derive a "reputation by source" view from the canonical balance breakdown.
 *
 * Oxy Trust weights reputation by HOW it was earned. The API returns a flat
 * per-category `breakdown`; Commons re-buckets it into the four civic sources a
 * citizen cares about, ordered strongest → weakest:
 *
 *   - `realLife`  (HIGH)    ← `physical`            — a counterpart scanned your
 *                                                     DNI and signed for it
 *   - `peerCivic` (MEDIUM)  ← `trust`               — validated by a random jury
 *   - `apps`      (LOW)     ← `content` + `social`  — earned inside apps
 *   - `penalties` (PENALTY) ← `penalties`           — the absolute sum of debits
 *
 * This is a pure re-shaping of `ReputationBalance.breakdown` — the schema is NOT
 * changed (per the plan, the source split is derived client-side). The
 * authoritative lifetime total still comes from `ReputationBalance.total`, which
 * also folds in `moderation` (not surfaced as its own civic source in Fase 1).
 */

import type { ReputationBalanceBreakdown } from '@oxyhq/core';

/** A civic reputation source key (drives the `civic.reputation.sources.*` i18n). */
export type ReputationSourceKey = 'realLife' | 'peerCivic' | 'apps' | 'penalties';

/** How strongly a source counts (drives the `civic.reputation.weight.*` i18n). */
export type ReputationSourceWeight = 'high' | 'medium' | 'low' | 'penalty';

/** A single derived reputation source row. */
export interface ReputationSource {
  key: ReputationSourceKey;
  weight: ReputationSourceWeight;
  /** Signed points contributed by this source (penalties are reported as a
   *  positive magnitude — the breakdown already sums debits as an absolute). */
  points: number;
}

/**
 * Re-bucket a reputation `breakdown` into the four ordered civic sources.
 *
 * @param breakdown - The per-category sums from `getReputationBalance()`.
 * @returns Four sources in strongest → weakest order (`realLife`, `peerCivic`,
 *   `apps`, `penalties`).
 */
export function deriveReputationSources(
  breakdown: ReputationBalanceBreakdown,
): ReputationSource[] {
  return [
    { key: 'realLife', weight: 'high', points: breakdown.physical },
    { key: 'peerCivic', weight: 'medium', points: breakdown.trust },
    { key: 'apps', weight: 'low', points: breakdown.content + breakdown.social },
    { key: 'penalties', weight: 'penalty', points: breakdown.penalties },
  ];
}
