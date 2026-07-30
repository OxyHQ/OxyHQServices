import mongoose, { type Document, Schema } from 'mongoose';
import {
    APPLICATION_MODERATION_STANDINGS,
    type ApplicationModerationStanding,
} from '@oxyhq/contracts';

/**
 * An application's own moderation standing.
 *
 * An external application can abuse this system as readily as a person can:
 * forged evidence, unreliable identity bindings, a policy written to launder
 * harassment. So an application carries standing too, and
 * `globalReputationEffectsAllowed` is the gate.
 *
 * The default matters more than the fields. A newly-integrated application has
 * NO trust document, and the engine treats an absent document as `sandbox` with
 * global effects DISALLOWED. That means the failure mode of forgetting to
 * configure an application is "it moderates locally and touches nothing global",
 * not "it can penalise arbitrary Oxy users". Enabling global effects is an
 * explicit act by Oxy staff after technical review, identity verification and a
 * quality period — never a side effect of integrating.
 *
 * `standing` and the gate are stored separately on purpose: an application can
 * be `trusted` for prioritisation and still have global effects withheld, and a
 * `restricted` application keeps its history rather than being deleted.
 */
export interface IApplicationModerationTrust extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    applicationId: mongoose.Types.ObjectId;
    standing: ApplicationModerationStanding;
    /** 0..1 — how well the application's evidence survives scrutiny. */
    evidenceIntegrity: number;
    /** 0..1 — how well its identity bindings hold up under verification. */
    identityBindingReliability: number;
    /** 0..1 — share of its decisions overturned on appeal. */
    decisionOverturnRate: number;
    /** 0..1 — assessed quality of the application's own policy. */
    policyQuality: number;
    /**
     * THE gate on global reputation effects. Defaults to false, and an absent
     * document is treated as false, so local-only is the safe default.
     */
    globalReputationEffectsAllowed: boolean;
    /** Staff principal who last changed the gate, for audit. */
    reviewedByUserId?: mongoose.Types.ObjectId;
    reviewedAt?: Date;
    /** Why the current standing was set. */
    reviewNote?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ApplicationModerationTrustSchema = new Schema<IApplicationModerationTrust>(
    {
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            unique: true,
        },
        standing: {
            type: String,
            enum: APPLICATION_MODERATION_STANDINGS,
            default: 'sandbox',
            index: true,
        },
        evidenceIntegrity: { type: Number, default: 0 },
        identityBindingReliability: { type: Number, default: 0 },
        decisionOverturnRate: { type: Number, default: 0 },
        policyQuality: { type: Number, default: 0 },
        globalReputationEffectsAllowed: { type: Boolean, default: false },
        reviewedByUserId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
        },
        reviewedAt: { type: Date },
        reviewNote: { type: String, trim: true },
    },
    {
        timestamps: true,
    }
);

export const ApplicationModerationTrust = mongoose.model<IApplicationModerationTrust>(
    'ApplicationModerationTrust',
    ApplicationModerationTrustSchema
);

export default ApplicationModerationTrust;
