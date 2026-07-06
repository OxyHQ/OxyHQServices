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
  /**
   * SHA-256 hex of the current `deviceSecret` (phase 2c — zero-cookie transport).
   * The client stores the raw 256-bit secret first-party (web localStorage /
   * native SecureStore) and presents it at `POST /session/device/token`; only the
   * hash is stored server-side, so a Mongo dump cannot forge the secret. Sparse-
   * unique, exactly like `cookieKeyHash`: legacy device docs predate it and carry
   * none, and it is populated on the next sign-in / mint.
   */
  secretHash?: string;
  /**
   * The PREVIOUS `deviceSecret` hash, kept valid for a short grace window
   * (`prevSecretExpiresAt`) after a rotation so a multi-tab race presenting the
   * just-superseded secret still succeeds (rotation-in-use, mirroring the
   * refresh-family single-use-with-grace pattern). Transient — never indexed.
   */
  prevSecretHash?: string;
  /** Epoch after which `prevSecretHash` is no longer accepted. Transient. */
  prevSecretExpiresAt?: Date;
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
    // Sparse-unique: only device docs bound to a `deviceSecret` carry a hash.
    // Never `default: null`, or sparse uniqueness would collide across legacy
    // docs — same rationale as `cookieKeyHash`.
    secretHash: { type: String, default: undefined },
    // Transient grace fields — never indexed (they churn on every rotation).
    prevSecretHash: { type: String, default: undefined },
    prevSecretExpiresAt: { type: Date, default: undefined },
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DeviceSessionSchema.index({ deviceId: 1 }, { unique: true });
DeviceSessionSchema.index({ cookieKeyHash: 1 }, { unique: true, sparse: true });
DeviceSessionSchema.index({ secretHash: 1 }, { unique: true, sparse: true });

export default mongoose.model<IDeviceSession>('DeviceSession', DeviceSessionSchema);
