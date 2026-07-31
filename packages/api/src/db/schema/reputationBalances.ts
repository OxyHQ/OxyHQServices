/**
 * `reputation_balances` (+ one child table) — the recomputable snapshot of a
 * user's standing, one row per account.
 *
 * Ported from `models/ReputationBalance.ts`. Always re-derivable from that
 * user's `active` transactions plus their active strikes and reviewer profile,
 * via `reputationService.recalculateBalance` — a cache, never an authority.
 *
 * ## Nine `{_id: false}` subdocuments become columns
 *
 * `breakdown`, `influence`, `reliability`, `personhood`, `contribution`,
 * `conduct`, `reporting`, `reviewing` and `contextualInfluence` each have a
 * fully known, closed shape, so they are real columns with the block as a name
 * prefix — the same treatment `users` gives its privacy and notification blocks.
 * `jsonb` is for genuinely shape-less data; "it was an object in Mongo" is not a
 * reason (`CONVENTIONS.md`, "Arrays and objects").
 *
 * Each subdocument defaulted to `() => ({})`, which Mongoose expands to the
 * per-field defaults. Those defaults now live on the columns, so a row created
 * with only `user_id` lands in exactly the state Mongoose produced — including
 * `reporting_reliability` and `reviewing_global_reliability` at the NEUTRAL 0.5
 * rather than at 0, which is a real distinction (no history, not a terrible
 * record).
 *
 * ## The V1/V2 split is preserved deliberately
 *
 * `total` / `positive` / `negative` / `breakdown_*` / `trust_tier` /
 * `influence_*` / `reliability_*` are the V1 fields, unchanged in meaning, kept
 * because live consumers read them. The V2 axes (`personhood_*`,
 * `contribution_*`, `conduct_*`, `reporting_*`, `reviewing_*`,
 * `contextual_*`) are the multidimensional model that replaces the single score
 * that let contribution offset conduct. Collapsing them here would be a product
 * decision wearing a schema change's clothes.
 *
 * ## What deliberately has NO constraint
 *
 * The `influence_*` weights are clamped to `[INFLUENCE_MIN, INFLUENCE_MAX]` by
 * `recalculateBalance`, but their DEFAULT is `0` — outside that range. A range
 * CHECK would reject every freshly-created balance before its first recompute,
 * so the clamp stays where it is enforceable.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import {
  CONDUCT_STANDINGS as CONTRACT_CONDUCT_STANDINGS,
  CONTRIBUTION_TIERS as CONTRACT_CONTRIBUTION_TIERS,
  PERSONHOOD_STATUSES as CONTRACT_PERSONHOOD_STATUSES,
} from '@oxyhq/contracts';
import type { ConductStanding, ContributionTier, PersonhoodStatusValue } from '@oxyhq/contracts';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from './columns';
import { reputationTransactions } from './reputationTransactions';
// The trust ladder is declared ONCE, on `users`, where the denormalized mirror
// column needed it first. Importing it rather than deriving a second tuple from
// the contract is what keeps the mirror and the source of truth from drifting —
// two `satisfies`-checked copies of the same union would each typecheck while
// disagreeing about order, and the CHECK constraints would follow them apart.
import { TRUST_TIERS, users } from './users';

/** Whether Oxy believes this is a real, distinct person. */
export const PERSONHOOD_STATUSES = [
  ...CONTRACT_PERSONHOOD_STATUSES,
] as const satisfies readonly PersonhoodStatusValue[];

/** `never` while the tuple covers the contract union. */
export type PersonhoodStatusGap = Exclude<
  PersonhoodStatusValue,
  (typeof PERSONHOOD_STATUSES)[number]
>;

/** What the person BUILT. Never lowered by conduct. */
export const CONTRIBUTION_TIERS = [
  ...CONTRACT_CONTRIBUTION_TIERS,
] as const satisfies readonly ContributionTier[];

/** `never` while the tuple covers the contract union. */
export type ContributionTierGap = Exclude<ContributionTier, (typeof CONTRIBUTION_TIERS)[number]>;

/** Standing that moderation outcomes move. Derived from active risk alone. */
export const CONDUCT_STANDINGS = [
  ...CONTRACT_CONDUCT_STANDINGS,
] as const satisfies readonly ConductStanding[];

/** `never` while the tuple covers the contract union. */
export type ConductStandingGap = Exclude<ConductStanding, (typeof CONDUCT_STANDINGS)[number]>;

/** Which open key space a reviewing-reliability row is measured over. */
export const REVIEWING_RELIABILITY_SCOPES = ['category', 'language'] as const;

/** The neutral prior for a reliability estimate with no history behind it. */
const NEUTRAL_RELIABILITY = 0.5;

export const reputationBalances = pgTable(
  'reputation_balances',
  {
    id: generatedId(),
    /** `CASCADE` — a cached standing for an account that no longer exists. */
    userId: text()
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    // ---- V1: the single-score model -------------------------------------
    /** Net lifetime total across all `active` transactions. */
    total: integer().notNull().default(0),
    /** Sum of positive points only. */
    positive: integer().notNull().default(0),
    /** Sum of negative points only — a negative number. */
    negative: integer().notNull().default(0),
    breakdownContent: integer().notNull().default(0),
    breakdownSocial: integer().notNull().default(0),
    breakdownTrust: integer().notNull().default(0),
    breakdownModeration: integer().notNull().default(0),
    breakdownPhysical: integer().notNull().default(0),
    /** Absolute sum of every negative active transaction, across all categories. */
    breakdownPenalties: integer().notNull().default(0),
    trustTier: text({ enum: TRUST_TIERS }).notNull().default('new'),
    influenceDefaultWeight: doublePrecision().notNull().default(0),
    influenceReportWeight: doublePrecision().notNull().default(0),
    influenceModerationWeight: doublePrecision().notNull().default(0),
    influenceRankingFeedbackWeight: doublePrecision().notNull().default(0),
    reliabilityAccurateReports: integer().notNull().default(0),
    reliabilityRejectedReports: integer().notNull().default(0),
    reliabilityReportAccuracyScore: doublePrecision().notNull().default(0),
    /** Smoothed 0..1 abuse signal; a high value forces the `restricted` tier. */
    reliabilityAbuseScore: doublePrecision().notNull().default(0),

    // ---- V2: personhood --------------------------------------------------
    personhoodStatus: text({ enum: PERSONHOOD_STATUSES }).notNull().default('unknown'),
    personhoodScore: doublePrecision().notNull().default(0),

    // ---- V2: contribution ------------------------------------------------
    /** EXCLUDES conduct penalties — a penalty must not lower what was built. */
    contributionPoints: integer().notNull().default(0),
    contributionTier: text({ enum: CONTRIBUTION_TIERS }).notNull().default('new'),

    // ---- V2: conduct -----------------------------------------------------
    conductStanding: text({ enum: CONDUCT_STANDINGS }).notNull().default('good'),
    /** Sum of risk carried by ACTIVE strikes. Already multiplied, so fractional. */
    conductActiveRisk: doublePrecision().notNull().default(0),
    conductActiveStrikes: integer().notNull().default(0),
    /**
     * When the earliest-expiring active strike lapses. NULL when there is none,
     * or when every active strike requires manual recovery review — critical
     * severity never expires on a timer.
     */
    conductNextExpiryAt: timestamptz(),

    // ---- V2: reporting ---------------------------------------------------
    /** Beta posterior mean over reporting outcomes ONLY. Neutral prior. */
    reportingReliability: doublePrecision().notNull().default(NEUTRAL_RELIABILITY),
    /** 0..1 confidence in that estimate, from effective sample size. */
    reportingConfidence: doublePrecision().notNull().default(0),
    reportingConfirmed: integer().notNull().default(0),
    reportingRejected: integer().notNull().default(0),
    /** CONFIRMED report abuse. A rejected report is not bad faith. */
    reportingMalicious: integer().notNull().default(0),

    // ---- V2: reviewing ---------------------------------------------------
    reviewingGlobalReliability: doublePrecision().notNull().default(NEUTRAL_RELIABILITY),

    // ---- V2: contextual influence ---------------------------------------
    // Three different questions, none of them the weight of a vote — a vote
    // inside a jury is never weighted. One qualified person, one vote.
    contextualReportPriorityWeight: doublePrecision().notNull().default(0),
    contextualReviewSelectionWeight: doublePrecision().notNull().default(0),
    contextualRankingWeight: doublePrecision().notNull().default(0),

    /**
     * Most recent transaction folded into this snapshot.
     *
     * `SET NULL`, and the column is already nullable: this is a cache marker,
     * not ownership. It only ever names a transaction of the SAME user, so the
     * action is reachable in practice only if that ledger row is removed on its
     * own — in which case "no marker" is the honest state.
     */
    lastTransactionId: text().references(() => reputationTransactions.id, {
      onDelete: 'set null',
    }),
    /** When this snapshot was last recomputed. */
    recalculatedAt: timestamptz().notNull().defaultNow(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Leaderboard ordering.
    index('reputation_balances_total_idx').on(t.total.desc()),
    index('reputation_balances_trust_tier_idx').on(t.trustTier),
    // Standing is a query dimension of its own: the reviewer pool excludes
    // anyone under consequence, and Trust & Safety reads it directly.
    index('reputation_balances_conduct_standing_idx').on(t.conductStanding),

    check('reputation_balances_trust_tier_check', sql`${t.trustTier} in (${sql.raw(inList(TRUST_TIERS))})`),
    check(
      'reputation_balances_personhood_status_check',
      sql`${t.personhoodStatus} in (${sql.raw(inList(PERSONHOOD_STATUSES))})`
    ),
    check(
      'reputation_balances_contribution_tier_check',
      sql`${t.contributionTier} in (${sql.raw(inList(CONTRIBUTION_TIERS))})`
    ),
    check(
      'reputation_balances_conduct_standing_check',
      sql`${t.conductStanding} in (${sql.raw(inList(CONDUCT_STANDINGS))})`
    ),
    // Counts and the penalty total are magnitudes, never signed.
    check('reputation_balances_positive_check', sql`${t.positive} >= 0`),
    check('reputation_balances_negative_check', sql`${t.negative} <= 0`),
    check('reputation_balances_penalties_check', sql`${t.breakdownPenalties} >= 0`),
    // Contribution counts only what was BUILT — `recalculateBalance` adds a
    // transaction to it exclusively when its points are positive.
    check('reputation_balances_contribution_points_check', sql`${t.contributionPoints} >= 0`),
    check('reputation_balances_reliability_counts_check', sql`${t.reliabilityAccurateReports} >= 0 and ${t.reliabilityRejectedReports} >= 0`),
    check('reputation_balances_reporting_counts_check', sql`${t.reportingConfirmed} >= 0 and ${t.reportingRejected} >= 0 and ${t.reportingMalicious} >= 0`),
    check('reputation_balances_conduct_check', sql`${t.conductActiveRisk} >= 0 and ${t.conductActiveStrikes} >= 0`),
    // The 0..1 scores. Every default sits inside the range, so this rejects only
    // a genuinely impossible value — a probability of 1.4 is not a data point.
    check(
      'reputation_balances_scores_check',
      sql`${t.reliabilityReportAccuracyScore} between 0 and 1 and ${t.reliabilityAbuseScore} between 0 and 1 and ${t.personhoodScore} between 0 and 1 and ${t.reportingReliability} between 0 and 1 and ${t.reportingConfidence} between 0 and 1 and ${t.reviewingGlobalReliability} between 0 and 1`
    ),
  ]
);

/**
 * `reputation_reviewing_reliability` — per-category and per-language reviewer
 * reliability.
 *
 * Ported from the two `Map<string, number>` fields on the `reviewing`
 * subdocument. A map from an OPEN key space (moderation category ids, BCP-47
 * language tags) to a number is a key→value RELATION, not shape-less data, so it
 * is a child table rather than `jsonb` — and the table can carry the 0..1 CHECK
 * that a blob cannot, and can answer "which categories is this reviewer reliable
 * in" as a query instead of a full deserialize.
 *
 * One table with a `scope` discriminator, not two near-identical ones: the two
 * maps differ only in what their keys name, and every writer sets both together.
 */
export const reputationReviewingReliability = pgTable(
  'reputation_reviewing_reliability',
  {
    /** `CASCADE` — the snapshot has no meaning apart from its balance. */
    balanceId: text()
      .notNull()
      .references(() => reputationBalances.id, { onDelete: 'cascade' }),
    scope: text({ enum: REVIEWING_RELIABILITY_SCOPES }).notNull(),
    /** The moderation category id or BCP-47 language tag. */
    key: text().notNull(),
    /** Reliability in that scope, 0..1. */
    reliability: doublePrecision().notNull(),
  },
  (t) => [
    // The natural key IS the identity: one reliability per (balance, scope, key).
    // A surrogate id would invent an identity for a row nothing references and
    // leave the map free to hold the same key twice with different values.
    primaryKey({
      columns: [t.balanceId, t.scope, t.key],
      name: 'reputation_reviewing_reliability_pkey',
    }),
    check(
      'reputation_reviewing_reliability_scope_check',
      sql`${t.scope} in (${sql.raw(inList(REVIEWING_RELIABILITY_SCOPES))})`
    ),
    check('reputation_reviewing_reliability_value_check', sql`${t.reliability} between 0 and 1`),
    check('reputation_reviewing_reliability_key_check', sql`length(${t.key}) > 0`),
  ]
);
