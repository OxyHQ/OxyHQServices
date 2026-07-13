import mongoose, { type Document, Schema } from 'mongoose';

/**
 * A per-(application) directed interaction-affinity edge: `fromUserId` has
 * accumulated affinity toward `toUserId` within a consuming app (Mention, …),
 * folded from the interaction events reported at `POST /app-signals/events`.
 *
 * `affinity` is a decayed, additive strength: each event decays the stored value
 * from `lastEventAt` to now (exponential half-life, see the API's
 * `AFFINITY_HALF_LIFE_MS` / `decayAffinity`) and ADDS the event's weight (the
 * per-type default or a caller override). The recommendation scorer decays it
 * once more on read, so an edge that stops receiving events fades toward 0 and a
 * dormant graph contributes nothing (strict no-op until events flow).
 *
 * This is v1 DIRECT affinity (viewer → candidate), keyed per Application `_id`.
 * The reverse index supports later 2-hop / collaborative aggregation without a
 * schema change.
 */
export interface IAppAffinityEdge extends Document {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  /** The interacting user (the viewer, on the read path). */
  fromUserId: mongoose.Types.ObjectId;
  /** The interacted-with user (a candidate, on the read path). */
  toUserId: mongoose.Types.ObjectId;
  /** Decayed, additive affinity strength as of `lastEventAt`. */
  affinity: number;
  /** Timestamp the affinity was last folded (the decay reference point). */
  lastEventAt: Date;
  /** Number of events folded into this edge (diagnostics / future weighting). */
  eventCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const AppAffinityEdgeSchema = new Schema<IAppAffinityEdge>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    fromUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    toUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    affinity: {
      type: Number,
      default: 0,
    },
    lastEventAt: {
      type: Date,
    },
    eventCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// One directed edge per (application, from, to). Re-ingesting an interaction
// decays-then-adds onto the same edge rather than creating a duplicate.
AppAffinityEdgeSchema.index(
  { applicationId: 1, fromUserId: 1, toUserId: 1 },
  { unique: true }
);
// Read a viewer's strongest affinities within an app (the scorer's pre-query:
// find({applicationId, fromUserId}).sort({affinity:-1})).
AppAffinityEdgeSchema.index({ applicationId: 1, fromUserId: 1, affinity: -1 });
// Reverse fan-in (who has affinity toward a user) for future 2-hop lookups.
AppAffinityEdgeSchema.index({ applicationId: 1, toUserId: 1 });

export const AppAffinityEdge = mongoose.model<IAppAffinityEdge>(
  'AppAffinityEdge',
  AppAffinityEdgeSchema
);

export default AppAffinityEdge;
