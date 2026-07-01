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
    revision: { type: Number, default: 0 },
  },
  { timestamps: true },
);

DeviceSessionSchema.index({ deviceId: 1 }, { unique: true });

export default mongoose.model<IDeviceSession>('DeviceSession', DeviceSessionSchema);
