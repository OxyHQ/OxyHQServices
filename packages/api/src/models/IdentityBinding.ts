import mongoose, { type Document, Schema } from 'mongoose';
import {
    IDENTITY_BINDING_STATUSES,
    IDENTITY_BINDING_TYPES,
    type IdentityBindingStatus,
    type IdentityBindingType,
} from '@oxyhq/contracts';

/**
 * Proof that a particular Oxy identity was present in a particular application
 * as a particular local principal, at a particular time.
 *
 * This model closes the hole the whole reputation bridge exists around: without
 * it, an application reports a bare Oxy user id and is believed. With it, a
 * moderation effect references a binding, and the engine checks that the binding
 * resolves to the claimed principal, belongs to the emitting application, is not
 * revoked, and was VERIFIED AT OR BEFORE the reported action. A binding created
 * after the fact proves nothing about who acted, so the time comparison is not
 * decoration.
 *
 * NO PROOF MATERIAL IS STORED. A `session_proof` binding is created by verifying
 * the user's own Oxy access token and discarding it; what survives is the fact
 * that the check passed and when. Storing the token would turn this collection
 * into a credential store, and a binding record is not worth that.
 *
 * `oauth_grant` bindings are not written here at all — they are DERIVED from
 * `AppGrant`, which Oxy's own authorize flow writes when a user consents to a
 * third-party application. That path is the strongest available: the application
 * asserts nothing, and `AppGrant.firstGrantedAt` is Oxy's own record of when the
 * user was present. Note that trusted first-party applications are auto-approved
 * and record no grant, which is exactly why the `session_proof` path exists.
 */
export interface IIdentityBinding extends Omit<Document, '_id'> {
    _id: mongoose.Types.ObjectId;
    /** The application the binding is scoped to. Never cross-application. */
    applicationId: mongoose.Types.ObjectId;
    /** The bound Oxy user. */
    userId: mongoose.Types.ObjectId;
    /** The application's own identifier for this person. */
    localPrincipalId: string;
    bindingType: IdentityBindingType;
    status: IdentityBindingStatus;
    /**
     * When the proof was verified. An effect is only derived for an action that
     * happened at or after this instant.
     */
    verifiedAt: Date;
    /**
     * The credential that presented the proof, for audit. Not part of the check:
     * a credential rotation must not invalidate a binding the user consented to.
     */
    credentialId?: mongoose.Types.ObjectId;
    /** When the binding was revoked, if it was. */
    revokedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const IdentityBindingSchema = new Schema<IIdentityBinding>(
    {
        applicationId: {
            type: Schema.Types.ObjectId,
            ref: 'Application',
            required: true,
            index: true,
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        localPrincipalId: {
            type: String,
            required: true,
            trim: true,
        },
        bindingType: {
            type: String,
            enum: IDENTITY_BINDING_TYPES,
            required: true,
        },
        status: {
            type: String,
            enum: IDENTITY_BINDING_STATUSES,
            default: 'active',
            index: true,
        },
        verifiedAt: {
            type: Date,
            required: true,
            default: Date.now,
        },
        credentialId: {
            type: Schema.Types.ObjectId,
            ref: 'ApplicationCredential',
        },
        revokedAt: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

// One ACTIVE binding per (application, local principal), so a local principal
// can never resolve to two Oxy users at once.
//
// Partial on `status: 'active'` deliberately: rebinding a local principal to a
// different Oxy user REVOKES the old row and inserts a new one, and the revoked
// row must survive because a past effect references it and its original
// `verifiedAt` is what made that effect legitimate. Making the index total would
// force the rebind to overwrite history instead.
IdentityBindingSchema.index(
    { applicationId: 1, localPrincipalId: 1 },
    { unique: true, partialFilterExpression: { status: 'active' } }
);

// Resolving a subject's bindings within one application.
IdentityBindingSchema.index({ applicationId: 1, userId: 1, status: 1 });

export const IdentityBinding = mongoose.model<IIdentityBinding>(
    'IdentityBinding',
    IdentityBindingSchema
);

export default IdentityBinding;
