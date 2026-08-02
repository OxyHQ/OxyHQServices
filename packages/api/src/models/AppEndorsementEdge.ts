import mongoose, { type Document, Schema } from 'mongoose';

/**
 * A single endorsement edge reported by a consuming app: `ownerId` endorses
 * `memberId` (e.g. an owner added a member to a curated list / starter pack in
 * that app). This is the SOURCE OF TRUTH for `AppUserSignal.endorsementScore` —
 * the roll-up is derived from these edges and can always be recomputed by
 * summing the active edges per (applicationId, memberId).
 *
 * `weight` is the reputation-derived ranking weight of the OWNER at the moment
 * the edge was applied (stored so a later `remove` subtracts exactly what was
 * added, even if the owner's reputation changed in between). `sourceId` lets an
 * app key the edge to its own object (list id, pack id) so re-ingesting the same
 * edge is idempotent.
 */
export interface IAppEndorsementEdge extends Document {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  memberId: mongoose.Types.ObjectId;
  /** App-scoped source object key (list/pack id). Empty string when unset. */
  sourceId: string;
  /** Applied endorsement weight (the owner's ranking weight at apply time). */
  weight: number;
  createdAt: Date;
  updatedAt: Date;
}

const AppEndorsementEdgeSchema = new Schema<IAppEndorsementEdge>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    memberId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    sourceId: {
      type: String,
      default: '',
      trim: true,
    },
    weight: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Idempotency: one edge per (app, owner, member, source). Re-ingesting the same
// edge updates it in place rather than double-counting.
AppEndorsementEdgeSchema.index(
  { applicationId: 1, ownerId: 1, memberId: 1, sourceId: 1 },
  { unique: true }
);
// Recompute / fan-in for a single member within an app.
AppEndorsementEdgeSchema.index({ applicationId: 1, memberId: 1 });

export const AppEndorsementEdge = mongoose.model<IAppEndorsementEdge>(
  'AppEndorsementEdge',
  AppEndorsementEdgeSchema
);

export default AppEndorsementEdge;
