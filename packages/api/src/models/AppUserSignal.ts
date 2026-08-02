import mongoose, { type Document, Schema } from 'mongoose';

/**
 * Per-(application, user) aggregate of cross-app discovery signals.
 *
 * Each consuming app (Mention, Homiio, …) reports endorsements and interest
 * signals about its users via `POST /app-signals/ingest`. This document is the
 * denormalized roll-up the recommendation scorer reads cheaply at query time:
 *
 *  - `endorsementScore` — signed sum of applied endorsement weights for this
 *    member within this app (an "owner endorsed this member" edge contributes
 *    the owner's reputation-derived ranking weight; a remove subtracts it).
 *  - `endorsementCount` — number of currently-active endorsement edges.
 *  - `interestScore` — latest app-reported interest signal in [0, 1].
 *
 * Exactly one document per (applicationId, userId). The edge ledger
 * (`AppEndorsementEdge`) is the source of truth; this is its recomputable cache,
 * maintained incrementally by `appSignals.service`.
 */
export interface IAppUserSignal extends Document {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  endorsementScore: number;
  endorsementCount: number;
  interestScore: number;
  lastEndorsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AppUserSignalSchema = new Schema<IAppUserSignal>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    endorsementScore: {
      type: Number,
      default: 0,
    },
    endorsementCount: {
      type: Number,
      default: 0,
    },
    interestScore: {
      type: Number,
      default: 0,
    },
    lastEndorsedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// One roll-up per (application, user); the scorer's per-app candidate union and
// top-signal lookups read this index directly.
AppUserSignalSchema.index({ applicationId: 1, userId: 1 }, { unique: true });
// Cross-app lookups for a single user (e.g. denorm/diagnostics).
AppUserSignalSchema.index({ userId: 1 });

export const AppUserSignal = mongoose.model<IAppUserSignal>(
  'AppUserSignal',
  AppUserSignalSchema
);

export default AppUserSignal;
