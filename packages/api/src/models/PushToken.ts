import mongoose, { type Document, Schema } from 'mongoose';

export interface IPushToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  platform: 'ios' | 'android' | 'web';
  createdAt: Date;
  updatedAt: Date;
}

const PushTokenSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      trim: true,
    },
    platform: {
      type: String,
      required: true,
      enum: ['ios', 'android', 'web'],
    },
  },
  {
    timestamps: true,
  }
);

// Unique index: one token per user (prevents duplicate registrations)
PushTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

PushTokenSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = (ret._id as mongoose.Types.ObjectId)?.toString();
    const { _id: _, ...rest } = ret;
    return rest;
  },
});

export const PushToken = mongoose.model<IPushToken>('PushToken', PushTokenSchema);
export default PushToken;
