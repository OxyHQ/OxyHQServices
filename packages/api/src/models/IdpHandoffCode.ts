import mongoose, { Document, Schema } from 'mongoose';

/**
 * Single-use codes for cross-origin IdP session handoff (auth.oxy.so hub).
 * A first-party app with an active bearer mints a code; auth.oxy.so exchanges
 * it to plant the same DeviceSession credentials locally — no cookies.
 */
export interface IIdpHandoffCode extends Document {
  codeHash: string;
  deviceId: string;
  sessionId: string;
  userId: mongoose.Types.ObjectId;
  usedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const IdpHandoffCodeSchema = new Schema(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

IdpHandoffCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 300 });

export const IdpHandoffCode = mongoose.model<IIdpHandoffCode>('IdpHandoffCode', IdpHandoffCodeSchema);
export default IdpHandoffCode;
