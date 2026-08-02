import mongoose, { type Document, Schema } from 'mongoose';

/**
 * A single push-notification install: the pair (user, Expo push token).
 *
 * `deviceId` and `applicationId` SCOPE that install:
 *
 *  - `deviceId`      — the central device the install belongs to (same id space
 *                      as `DeviceSession.deviceId`), so delivery can be reasoned
 *                      about per device rather than per user.
 *  - `applicationId` — the registered `Application` the install belongs to,
 *                      resolved SERVER-side from the caller's `clientId` (an
 *                      `ApplicationCredential.publicKey`) at registration time.
 *                      It is the only trustworthy answer to "which app is this
 *                      token for" — the client never asserts it directly.
 *
 * Both are OPTIONAL: rows predating the scoping (and any caller that registers
 * without a `clientId`) carry neither and keep working exactly as before.
 */
export interface IPushToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  platform: 'ios' | 'android' | 'web';
  /** Central device id of the install, when the client supplied one. */
  deviceId?: string;
  /** Registered application the install belongs to, resolved from a `clientId`. */
  applicationId?: mongoose.Types.ObjectId;
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
    deviceId: {
      type: String,
      default: null,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Unique index: one token per user (prevents duplicate registrations)
PushTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

// App-scoped delivery lookup: "this user's installs of these applications".
PushTokenSchema.index({ userId: 1, applicationId: 1 });

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
