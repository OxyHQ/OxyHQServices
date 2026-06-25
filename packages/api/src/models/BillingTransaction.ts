import mongoose, { Schema, Document } from 'mongoose';

export interface IBillingTransaction extends Document {
  userId: string;
  stripeCustomerId?: string;
  stripePaymentIntentId?: string;
  stripeSubscriptionId?: string;
  stripeSubscriptionPeriodStart?: Date;
  type: 'credit_purchase' | 'subscription_payment' | 'refund';
  amount: number;
  currency: string;
  credits: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BillingTransactionSchema = new Schema<IBillingTransaction>({
  userId: {
    type: String,
    required: true,
    index: true,
  },
  stripeCustomerId: {
    type: String,
  },
  stripePaymentIntentId: {
    type: String,
    sparse: true,
  },
  stripeSubscriptionId: {
    type: String,
    index: true,
  },
  stripeSubscriptionPeriodStart: {
    type: Date,
  },
  type: {
    type: String,
    enum: ['credit_purchase', 'subscription_payment', 'refund'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
  },
  currency: {
    type: String,
    default: 'usd',
  },
  credits: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending',
  },
  description: {
    type: String,
  },
}, {
  timestamps: true,
});

BillingTransactionSchema.index({ userId: 1, createdAt: -1 });
BillingTransactionSchema.index(
  { stripeSubscriptionId: 1, stripeSubscriptionPeriodStart: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'subscription_payment',
      stripeSubscriptionId: { $exists: true },
      stripeSubscriptionPeriodStart: { $exists: true },
    },
  }
);

const BillingTransaction = mongoose.model<IBillingTransaction>('BillingTransaction', BillingTransactionSchema);

export default BillingTransaction;
