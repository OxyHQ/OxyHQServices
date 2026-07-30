import mongoose, { type Document, Schema } from 'mongoose';
import {
    CONDUCT_STRIKE_STATUSES,
    MODERATION_EFFECT_TYPES,
    MODERATION_SEVERITIES,
    type ConductStrikeStatus,
    type ModerationEffectType,
    type ModerationSeverity,
} from '@oxyhq/contracts';

/**
 * The unit of ACTIVE RISK on a user's conduct axis.
 *
 * A strike is what makes conduct independent of contribution. The ledger
 * transaction records what the incident cost in points; the strike records that
 * the person is currently under consequence, and `conduct.standing` derives from
 * the sum of risk carried by `active` strikes and from nothing else. Earning
 * points therefore cannot cancel a strike — the two live on different axes, and
 * that is the defect this model exists to fix.
 *
 * Three ways a strike stops carrying risk, and they are not interchangeable:
 *  - `expired`  — its `expiresAt` passed with no similar incident. The risk
 *    lapses; the ledger row stays. A minor error must not become a permanent
 *    condemnation.
 *  - `reversed` — an appeal overturned the decision. The risk is removed
 *    immediately and a compensating ledger entry is appended.
 *  - Critical severity has NO `expiresAt` at all: it requires a specialised
 *    recovery review rather than lapsing on a timer.
 *
 * One strike per (incident, subject, decision revision) — enforced by the unique
 * index below rather than by a check in the service, so a concurrent replay of
 * the same event cannot produce two.
 */
export interface IConductStrike extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    /** The subject under consequence. */
    userId: mongoose.Types.ObjectId;
    /** The cross-tenant incident that produced it. THE unit of consequence. */
    incidentId: string;
    /** The decision that produced it. */
    decisionId: string;
    /** Revision of that decision. An appeal's revision creates its own strike. */
    decisionRevision: number;
    /** The application whose report started the incident. */
    applicationId?: mongoose.Types.ObjectId;
    /**
     * Which axis the strike came from. Part of the uniqueness key: a person who
     * is both the author of violating material and a colluding reviewer in the
     * same incident carries two distinct consequences, not one merged strike.
     */
    effectType: ModerationEffectType;
    severity: ModerationSeverity;
    /** Active risk contributed while `status` is `active`, already multiplied. */
    riskPoints: number;
    /** Conduct family, not the taxonomy code — no intimate category is stored. */
    family: string;
    status: ConductStrikeStatus;
    /**
     * When the risk lapses. Absent for critical severity, which requires a
     * specialised recovery review instead of expiring on its own.
     */
    expiresAt?: Date;
    /** The Oxy Conduct Policy version the consequence was derived under. */
    policyVersion: string;
    /** The ledger transaction this strike accompanies. */
    transactionId: mongoose.Types.ObjectId;
    /** When the strike stopped being active, if it has. */
    resolvedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ConductStrikeSchema = new Schema<IConductStrike>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        incidentId: {
            type: String,
            required: true,
            trim: true,
        },
        decisionId: {
            type: String,
            required: true,
            trim: true,
        },
        decisionRevision: {
            type: Number,
            required: true,
        },
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: 'Application',
        },
        effectType: {
            type: String,
            enum: MODERATION_EFFECT_TYPES,
            required: true,
        },
        severity: {
            type: String,
            enum: MODERATION_SEVERITIES,
            required: true,
        },
        riskPoints: {
            type: Number,
            required: true,
        },
        family: {
            type: String,
            required: true,
            trim: true,
        },
        status: {
            type: String,
            enum: CONDUCT_STRIKE_STATUSES,
            default: 'active',
            index: true,
        },
        expiresAt: {
            type: Date,
        },
        policyVersion: {
            type: String,
            required: true,
            trim: true,
        },
        transactionId: {
            type: Schema.Types.ObjectId,
            ref: 'ReputationTransaction',
            required: true,
        },
        resolvedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// ONE strike per incident, subject, effect type and decision revision. This
// index — not a read-then-write in the service — is what makes "one penalty per
// incident" hold under a concurrent replay of the same event. It mirrors the
// `ModerationEffect` semantic key exactly, so a strike and its effect cannot
// disagree about how many consequences an incident produced.
ConductStrikeSchema.index(
    { incidentId: 1, userId: 1, effectType: 1, decisionRevision: 1 },
    { unique: true }
);

// Summing a user's active risk.
ConductStrikeSchema.index({ userId: 1, status: 1 });

// The expiry sweep: due active strikes, oldest first. Partial so the index holds
// only rows the sweep can act on.
ConductStrikeSchema.index(
    { expiresAt: 1 },
    {
        partialFilterExpression: { status: 'active', expiresAt: { $exists: true } },
    }
);

// Repetition assessment: prior similar incidents for a subject, by family.
ConductStrikeSchema.index({ userId: 1, family: 1, createdAt: -1 });

// Reversal resolves every strike a decision revision produced.
ConductStrikeSchema.index({ decisionId: 1, decisionRevision: 1 });

export const ConductStrike = mongoose.model<IConductStrike>('ConductStrike', ConductStrikeSchema);

export default ConductStrike;
