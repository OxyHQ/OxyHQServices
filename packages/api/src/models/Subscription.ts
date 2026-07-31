import mongoose, { type Document, Schema } from "mongoose";

/**
 * Lifecycle states of a legacy subscription row.
 *
 * `active`   — in force (see `utils/subscriptionStatus.ts` for the authoritative rule)
 * `canceled` — terminal; the user cancelled it and it grants nothing from that moment
 * `expired`  — its `endDate` has passed
 *
 * A subscription row is NEVER deleted when it lapses: it becomes `expired` and is
 * kept as history (billing disputes, renewals, analytics all read it). See the
 * note on the index block below.
 */
export type SubscriptionStatus = "active" | "canceled" | "expired";

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  plan: "basic" | "pro" | "business";
  status: SubscriptionStatus;
  startDate: Date;
  endDate: Date;
  autoRenew: boolean;
  paymentMethod?: string;
  latestInvoice?: string;
  features: {
    analytics: boolean;
    premiumBadge: boolean;
    unlimitedFollowing: boolean;
    higherUploadLimits: boolean;
    promotedPosts: boolean;
    businessTools: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  plan: {
    type: String,
    enum: ["basic", "pro", "business"],
    default: "basic",
    required: true,
  },
  status: {
    type: String,
    enum: ["active", "canceled", "expired"],
    default: "active",
    required: true,
  },
  startDate: {
    type: Date,
    required: true,
    default: Date.now,
  },
  endDate: {
    type: Date,
    required: true,
  },
  autoRenew: {
    type: Boolean,
    default: true,
  },
  paymentMethod: String,
  latestInvoice: String,
  features: {
    analytics: { type: Boolean, default: false },
    premiumBadge: { type: Boolean, default: false },
    unlimitedFollowing: { type: Boolean, default: false },
    higherUploadLimits: { type: Boolean, default: false },
    promotedPosts: { type: Boolean, default: false },
    businessTools: { type: Boolean, default: false },
  },
}, {
  timestamps: true
});

// Index to quickly find a user's subscription
SubscriptionSchema.index({ userId: 1 });
// Index for querying active subscriptions
SubscriptionSchema.index({ status: 1 });
// Serves both halves of the lifecycle: the "is this row in force right now"
// lookup (`utils/subscriptionStatus.ts`) and the periodic status reconciliation
// sweep (`services/subscriptionLifecycle.service.ts`), which both filter on
// status + endDate.
SubscriptionSchema.index({ userId: 1, status: 1, endDate: -1 });
SubscriptionSchema.index({ status: 1, endDate: 1 });

// NEVER add a TTL index on `endDate`. A Mongo TTL index DELETES the document; it
// does not mark it. This collection previously carried
// `index({ endDate: 1 }, { expireAfterSeconds: 0 })`, which destroyed every
// subscription the moment its period ended — making `status: 'expired'`
// unreachable, erasing all subscription history, and deleting auto-renewing rows
// instead of renewing them. Lapsing is a STATUS TRANSITION here, owned by
// `services/subscriptionLifecycle.service.ts`. `models/__tests__/subscription.indexes.test.ts`
// fails if a TTL index reappears on this schema.

export default mongoose.model<ISubscription>("Subscription", SubscriptionSchema);