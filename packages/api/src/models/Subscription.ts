import mongoose, { Document, Schema } from "mongoose";

export interface ISubscription extends Document {
  userId: mongoose.Types.ObjectId;
  plan: "Free" | "Mention+" | "Oxy+ Insider" | "Oxy+ Connect" | "Oxy+ Premium" | "Oxy+ Creator" | "basic" | "pro" | "business";
  status: "active" | "canceled" | "expired";
  startDate: Date;
  endDate: Date;
  autoRenew: boolean;
  paymentMethod?: string;
  latestInvoice?: string;
  features: {
    analytics: boolean;
    advancedAnalytics?: boolean;
    premiumBadge: boolean;
    unlimitedFollowing: boolean;
    higherUploadLimits: boolean;
    promotedPosts: boolean;
    businessTools: boolean;
    undoPosts?: boolean;
    customThemes?: boolean;
    prioritySupport?: boolean;
    advancedPrivacy?: boolean;
    bulkActions?: boolean;
    contentScheduling?: boolean;
    teamCollaboration?: boolean;
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
    enum: ["Free", "Mention+", "Oxy+ Insider", "Oxy+ Connect", "Oxy+ Premium", "Oxy+ Creator", "basic", "pro", "business"],
    default: "Free",
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
    advancedAnalytics: { type: Boolean, default: false },
    premiumBadge: { type: Boolean, default: false },
    unlimitedFollowing: { type: Boolean, default: false },
    higherUploadLimits: { type: Boolean, default: false },
    promotedPosts: { type: Boolean, default: false },
    businessTools: { type: Boolean, default: false },
    undoPosts: { type: Boolean, default: false },
    customThemes: { type: Boolean, default: false },
    prioritySupport: { type: Boolean, default: false },
    advancedPrivacy: { type: Boolean, default: false },
    bulkActions: { type: Boolean, default: false },
    contentScheduling: { type: Boolean, default: false },
    teamCollaboration: { type: Boolean, default: false },
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