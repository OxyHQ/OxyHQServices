import mongoose, { type Document, Schema } from 'mongoose';
import {
    MODERATION_EFFECT_STATUSES,
    MODERATION_EFFECT_TYPES,
    MODERATION_SEVERITIES,
    type ModerationEffectStatus,
    type ModerationEffectType,
    type ModerationSeverity,
} from '@oxyhq/contracts';

/**
 * The idempotent mapping between a published moderation decision and the
 * reputation it moved.
 *
 * This is the record that makes "one penalty per incident" auditable rather than
 * merely intended. Two unique indexes, each closing a different hole:
 *
 *  - `(incidentId, principalId, effectType, decisionRevision)` — the SEMANTIC
 *    key. A hundred reports about the same material collapse into one incident
 *    and therefore one effect. Two different emitters, two different event ids
 *    and two different cases still cannot double-penalise the same person for
 *    the same incident and revision.
 *  - `eventId` — the TRANSPORT key. A redelivery of the same event is answered
 *    from the stored effect without recomputing anything.
 *
 * Both are needed: the transport key alone would let a re-emitted event with a
 * fresh id apply a second penalty, and the semantic key alone would make an
 * honest retry look like a conflict.
 *
 * The document also carries everything needed to EXPLAIN the figure — the
 * multipliers, the severity, the policy versions — so a subject can be told why
 * a consequence is what it is without the decision's contents being reopened,
 * and so the effect can be recomputed under the original policy.
 */
export interface IModerationEffect extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    /** The emitter's event id — the transport-level idempotency key. */
    eventId: string;
    /** The cross-tenant incident. THE unit of consequence. */
    incidentId: string;
    caseId: string;
    decisionId: string;
    decisionRevision: number;
    /** The Oxy user the effect landed on. */
    principalId: mongoose.Types.ObjectId;
    /** The binding that proved the identity. No binding, no effect. */
    bindingId: mongoose.Types.ObjectId;
    /** The emitting application, resolved from its credential — never the body. */
    applicationId: mongoose.Types.ObjectId;
    /** The credential the event arrived on. */
    credentialId?: mongoose.Types.ObjectId;
    effectType: ModerationEffectType;
    status: ModerationEffectStatus;
    /** Signed points written to the ledger, already multiplied and capped. */
    points: number;
    /** Active risk added to conduct standing, already multiplied and capped. */
    activeRisk: number;
    severity: ModerationSeverity;
    /** Conduct family of the primary finding. Never the taxonomy code. */
    family: string;
    /** Repetition multiplier applied (1.0 for a first similar incident). */
    repetitionMultiplier: number;
    /** Multi-finding multiplier applied, capped by the policy version. */
    multiFindingMultiplier: number;
    /** The exact key the ledger transaction was written under. */
    idempotencyKey: string;
    transactionId: mongoose.Types.ObjectId;
    /** The strike this effect created, when it carries risk. */
    strikeId?: mongoose.Types.ObjectId;
    /** The compensating transaction, once an appeal reversed the effect. */
    reversalTransactionId?: mongoose.Types.ObjectId;
    /** All three policy versions the decision was made under. */
    policyVersions: {
        universal: string;
        application: string;
        oxyConduct: string;
    };
    /** Hash of the private decision document — provenance without contents. */
    proofHash: string;
    appliedAt: Date;
    reversedAt?: Date;
    /** Why the effect was reversed, when it was. */
    reversalReason?: string;
    createdAt: Date;
    updatedAt: Date;
}

const PolicyVersionsSchema = new Schema<IModerationEffect['policyVersions']>(
    {
        universal: { type: String, required: true, trim: true },
        application: { type: String, required: true, trim: true },
        oxyConduct: { type: String, required: true, trim: true },
    },
    { _id: false }
);

const ModerationEffectSchema = new Schema<IModerationEffect>(
    {
        eventId: {
            type: String,
            required: true,
            trim: true,
        },
        incidentId: {
            type: String,
            required: true,
            trim: true,
        },
        caseId: {
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
        principalId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        bindingId: {
            type: Schema.Types.ObjectId,
            ref: 'IdentityBinding',
            required: true,
        },
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            index: true,
        },
        credentialId: {
            type: Schema.Types.ObjectId,
            ref: 'ApplicationCredential',
        },
        effectType: {
            type: String,
            enum: MODERATION_EFFECT_TYPES,
            required: true,
        },
        status: {
            type: String,
            enum: MODERATION_EFFECT_STATUSES,
            default: 'applied',
            index: true,
        },
        points: {
            type: Number,
            required: true,
        },
        activeRisk: {
            type: Number,
            required: true,
        },
        severity: {
            type: String,
            enum: MODERATION_SEVERITIES,
            required: true,
        },
        family: {
            type: String,
            required: true,
            trim: true,
        },
        repetitionMultiplier: {
            type: Number,
            required: true,
        },
        multiFindingMultiplier: {
            type: Number,
            required: true,
        },
        idempotencyKey: {
            type: String,
            required: true,
            trim: true,
        },
        transactionId: {
            type: Schema.Types.ObjectId,
            ref: 'ReputationTransaction',
            required: true,
        },
        strikeId: {
            type: Schema.Types.ObjectId,
            ref: 'ConductStrike',
        },
        reversalTransactionId: {
            type: Schema.Types.ObjectId,
            ref: 'ReputationTransaction',
        },
        policyVersions: {
            type: PolicyVersionsSchema,
            required: true,
        },
        proofHash: {
            type: String,
            required: true,
            trim: true,
        },
        appliedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        reversedAt: {
            type: Date,
        },
        reversalReason: {
            type: String,
            trim: true,
        },
    },
    {
        timestamps: true,
    }
);

// THE semantic idempotency guard: one effect per incident, principal, effect
// type and decision revision. Everything else about "one penalty per incident"
// is a consequence of this index existing.
ModerationEffectSchema.index(
    { incidentId: 1, principalId: 1, effectType: 1, decisionRevision: 1 },
    { unique: true }
);

// The transport guard: a redelivery of the same event is answered, not replayed.
ModerationEffectSchema.index({ eventId: 1 }, { unique: true });

// Reversal resolves every effect a decision revision produced.
ModerationEffectSchema.index({ decisionId: 1, decisionRevision: 1 });

// Reconciliation walks an incident's effects across revisions.
ModerationEffectSchema.index({ incidentId: 1, createdAt: 1 });

export const ModerationEffect = mongoose.model<IModerationEffect>(
    'ModerationEffect',
    ModerationEffectSchema
);

export default ModerationEffect;
