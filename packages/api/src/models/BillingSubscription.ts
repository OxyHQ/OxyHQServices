import mongoose, { Schema, Document } from 'mongoose';

export interface IBillingSubscription extends Document {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string;
  status: 'active' | 'canceled' | 'past_due' | 'unpaid' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
  plan: {
    name: string;
    creditsPerMonth: number;
    price: number;
    currency: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const BillingSubscriptionSchema = new Schema<IBillingSubscription>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  stripeCustomerId: {
    type: String,
    required: true,
  },
  stripeSubscriptionId: {
    type: String,
    required: true,
    unique: true,
  },
  stripePriceId: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing'],
    default: 'active',
  },
  currentPeriodStart: {
    type: Date,
    required: true,
  },
  currentPeriodEnd: {
    type: Date,
    required: true,
  },
  cancelAtPeriodEnd: {
    type: Boolean,
    default: false,
  },
  plan: {
    name: { type: String, required: true },
    creditsPerMonth: { type: Number, required: true },
    price: { type: Number, required: true },
    currency: { type: String, default: 'usd' },
  },
}, {
  timestamps: true,
});

BillingSubscriptionSchema.index({ stripeCustomerId: 1 });
BillingSubscriptionSchema.index({ userId: 1, status: 1 });

const BillingSubscription = mongoose.model<IBillingSubscription>('BillingSubscription', BillingSubscriptionSchema);

export default BillingSubscription;
