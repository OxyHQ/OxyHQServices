import mongoose, { Document, Schema } from 'mongoose';

export interface IManagerEntry {
  userId: mongoose.Types.ObjectId;
  role: 'owner' | 'admin' | 'editor';
  addedAt: Date;
  addedBy: mongoose.Types.ObjectId;
}

export interface IManagedAccount extends Document {
  accountId: mongoose.Types.ObjectId;
  ownerId: mongoose.Types.ObjectId;
  managers: IManagerEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const ManagerEntrySchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: String,
      enum: ['owner', 'admin', 'editor'],
      required: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { _id: false }
);

const ManagedAccountSchema = new Schema<IManagedAccount>(
  {
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    managers: {
      type: [ManagerEntrySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Index for querying all accounts a user manages
ManagedAccountSchema.index({ 'managers.userId': 1 });

export const ManagedAccount = mongoose.model<IManagedAccount>(
  'ManagedAccount',
  ManagedAccountSchema
);

export default ManagedAccount;
