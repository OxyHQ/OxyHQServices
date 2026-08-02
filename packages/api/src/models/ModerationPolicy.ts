import mongoose, { type Document, Schema } from 'mongoose';
import {
    CONDUCT_STANDINGS,
    MODERATION_SEVERITIES,
    type ModerationSeverity,
} from '@oxyhq/contracts';
import type { ConductStandingThreshold } from '../db/schema/moderationPolicyStandingThresholds';

/**
 * One IMMUTABLE version of the Oxy Conduct Policy.
 *
 * This model is the substrate the plan's "recompute a consequence under the
 * original policy" requirement needs, and it is why the numbers are not
 * constants in a source file. A conduct effect records the `policyVersion` it
 * was derived under; reversing or reconciling it resolves THIS document, so
 * shipping a new tuning can never rewrite what a past decision cost.
 *
 * A document is written once, at seed time, and then treated as read-only.
 * There is no update path: a new tuning is a NEW `policyVersion`, exactly like a
 * published decision is superseded rather than edited. `status` moves a version
 * between `active` (the one new effects use) and `retired` (still resolvable for
 * recomputation) — the only mutation the lifecycle allows.
 *
 * Everything an effect needs is in one document, so deriving a consequence is a
 * single lookup by version and no partially-applied tuning is possible.
 */
export interface IModerationSeverityRule {
    severity: ModerationSeverity;
    /** Signed ledger points (negative). */
    points: number;
    /** Active risk this severity contributes to conduct standing. */
    riskPoints: number;
    /**
     * Days after which the strike's risk lapses. `null` means it does not lapse
     * automatically and requires a specialised recovery review — the ledger row
     * survives either way, so traceability is never traded for forgiveness.
     */
    riskExpiryDays: number | null;
}

/**
 * An active-risk threshold and the standing it produces at or above it.
 *
 * Owned by `db/schema/moderationPolicyStandingThresholds.ts`, beside the table
 * that stores it. Re-imported here so this legacy model still describes the
 * same shape without being the source of it.
 */
export type { ConductStandingThreshold };

export interface IModerationPolicy extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    /** e.g. `oxy.2026.1`. Unique — a version is written once. */
    policyVersion: string;
    /** `active` is used for new effects; `retired` remains resolvable. */
    status: 'active' | 'retired';
    /** Per-severity points, risk and expiry. Exactly one entry per severity. */
    severityRules: IModerationSeverityRule[];
    /**
     * Conduct families this version recognises. A finding whose family is absent
     * produces NO effect: an unrecognised category must not be guessed at.
     */
    conductFamilies: string[];
    /**
     * Repetition multipliers by ordinal of a similar incident in the window.
     * The last value holds beyond the array, bounding the escalation.
     */
    repetitionMultipliers: number[];
    /** Window, in days, over which a similar incident counts as repetition. */
    repetitionWindowDays: number;
    /** Share of the primary effect each secondary finding adds. */
    multiFindingSecondaryShare: number;
    /** Ceiling on the multi-finding multiplier, relative to the primary effect. */
    multiFindingCap: number;
    /** Active-risk thresholds for conduct standing, highest first. */
    standingThresholds: ConductStandingThreshold[];
    /**
     * Whether a decision still marked `provisional` may already move reputation.
     *
     * The baseline says NO, and that default is the conservative one: a
     * provisional decision has not finished being contested, so penalising on it
     * means reversing more often. A policy version may permit it for a narrow
     * class of severe, time-critical harm, which is why it is a per-version
     * setting rather than a constant.
     */
    provisionalEffectsAllowed: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const SeverityRuleSchema = new Schema<IModerationSeverityRule>(
    {
        severity: { type: String, enum: MODERATION_SEVERITIES, required: true },
        points: { type: Number, required: true },
        riskPoints: { type: Number, required: true },
        // `null` is meaningful (no automatic expiry), so the path is nullable
        // rather than optional — an absent value and "never expires" must not
        // be the same state.
        riskExpiryDays: { type: Number, default: null },
    },
    { _id: false }
);

const StandingThresholdSchema = new Schema<ConductStandingThreshold>(
    {
        standing: { type: String, enum: CONDUCT_STANDINGS, required: true },
        minRisk: { type: Number, required: true },
    },
    { _id: false }
);

const ModerationPolicySchema = new Schema<IModerationPolicy>(
    {
        policyVersion: {
            type: String,
            required: true,
            unique: true,
            trim: true,
        },
        status: {
            type: String,
            enum: ['active', 'retired'],
            default: 'active',
            index: true,
        },
        severityRules: {
            type: [SeverityRuleSchema],
            required: true,
        },
        conductFamilies: {
            type: [String],
            required: true,
        },
        repetitionMultipliers: {
            type: [Number],
            required: true,
        },
        repetitionWindowDays: {
            type: Number,
            required: true,
        },
        multiFindingSecondaryShare: {
            type: Number,
            required: true,
        },
        multiFindingCap: {
            type: Number,
            required: true,
        },
        standingThresholds: {
            type: [StandingThresholdSchema],
            required: true,
        },
        provisionalEffectsAllowed: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

export const ModerationPolicy = mongoose.model<IModerationPolicy>(
    'ModerationPolicy',
    ModerationPolicySchema
);

export default ModerationPolicy;
