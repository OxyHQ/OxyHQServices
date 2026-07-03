import mongoose, { Document, Schema } from 'mongoose';

import { AFFINITY_EVENT_SEEN_TTL_SECONDS } from '../utils/recommendationWeights';

/**
 * Bounded idempotency ledger for interaction-affinity ingest.
 *
 * When a consuming app supplies an `eventId` on an interaction event, this
 * document records that (applicationId, eventId) was already folded so a retried
 * or duplicated delivery is applied at most once. It is intentionally SMALL and
 * SELF-PRUNING: a TTL index (`AFFINITY_EVENT_SEEN_TTL_SECONDS`) evicts entries
 * after the dedup window, so the collection never grows unbounded. Events without
 * an `eventId` are never recorded here (at-least-once delivery is accepted for
 * those, matching the additive/decayed edge model).
 */
export interface IAppAffinityEventSeen extends Document {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  /** The app-supplied event id (unique per application within the TTL window). */
  eventId: string;
  createdAt: Date;
}

const AppAffinityEventSeenSchema = new Schema<IAppAffinityEventSeen>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
    },
    eventId: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    // `createdAt` is managed explicitly so the TTL index can key off it; no
    // `updatedAt` churn is needed for an append-only dedup marker.
    timestamps: false,
  }
);

// One marker per (application, eventId) — a duplicate insert loses the unique
// race and is treated as "already seen".
AppAffinityEventSeenSchema.index({ applicationId: 1, eventId: 1 }, { unique: true });
// Self-prune: evict markers after the dedup window so the ledger stays bounded.
AppAffinityEventSeenSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: AFFINITY_EVENT_SEEN_TTL_SECONDS }
);

export const AppAffinityEventSeen = mongoose.model<IAppAffinityEventSeen>(
  'AppAffinityEventSeen',
  AppAffinityEventSeenSchema
);

export default AppAffinityEventSeen;
