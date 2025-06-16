import mongoose, { Document, Schema } from "mongoose";

export type TransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'purchase';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'cancelled';

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  description?: string;
  recipientId?: mongoose.Types.ObjectId;
  itemId?: string;
  itemType?: string;
  externalReference?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

const TransactionSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['deposit', 'withdrawal', 'transfer', 'purchase'],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending',
    },
    description: {
      type: String,
    },
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    itemId: {
      type: String,
    },
    itemType: {
      type: String,
    },
    externalReference: {
      type: String,
    },
    completedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Create compound indexes for efficient querying
TransactionSchema.index({ userId: 1, status: 1 });
TransactionSchema.index({ userId: 1, type: 1 });
TransactionSchema.index({ recipientId: 1, status: 1 });

export const Transaction = mongoose.model<ITransaction>("Transaction", TransactionSchema);
export default Transaction; 