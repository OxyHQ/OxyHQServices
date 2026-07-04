import mongoose, { Document, Schema } from 'mongoose';

export interface IDeviceSessionAccount {
  accountId: mongoose.Types.ObjectId;
  sessionId: string;
  authuser: number;
  addedAt: Date;
  operatedByUserId?: mongoose.Types.ObjectId | null;
}

export interface IDeviceSession extends Document {
  deviceId: string;
  accounts: IDeviceSessionAccount[];
  activeAccountId: mongoose.Types.ObjectId | null;
  /**
   * SHA-256 hex of the random 256-bit `oxy_device` cookie secret bound to this
   * device. The cookie value itself is NEVER the deviceId — it is an opaque
   * secret, and only its hash is stored, so a Mongo dump cannot forge the cookie
   * and possessing the cookie reveals nothing about the deviceId. Sparse-unique:
   * legacy device docs predate it and carry none.
   */
  cookieKeyHash?: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}

const AccountSchema = new Schema<IDeviceSessionAccount>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    sessionId: { type: String, required: true },
    authuser: { type: Number, required: true, min: 0 },
    addedAt: { type: Date, default: Date.now },
    operatedByUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const DeviceSessionSchema = new Schema<IDeviceSession>(
  {
    deviceId: { type: String, required: true },
    accounts: { type: [AccountSchema], default: [] },
    activeAccountId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Sparse-unique: only device docs bound to an `oxy_device` cookie carry a
    // hash. Never `default: null`, or sparse uniqueness would collide across
    // legacy docs.
    cookieKeyHash: { type: String, default: undefined },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DeviceSessionSchema.index({ deviceId: 1 }, { unique: true });
DeviceSessionSchema.index({ cookieKeyHash: 1 }, { unique: true, sparse: true });

export default mongoose.model<IDeviceSession>('DeviceSession', DeviceSessionSchema);
