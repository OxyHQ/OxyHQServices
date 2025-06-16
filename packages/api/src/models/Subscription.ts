import mongoose, { Document, Schema } from "mongoose";

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  plan: "basic" | "pro" | "business";
  status: "active" | "canceled" | "expired";
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
// TTL index to automatically expire subscriptions
SubscriptionSchema.index({ endDate: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<ISubscription>("Subscription", SubscriptionSchema);