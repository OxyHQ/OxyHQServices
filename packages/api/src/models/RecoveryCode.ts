import mongoose, { Document, Schema } from 'mongoose';

export interface IRecoveryCode extends Document {
  userId: mongoose.Types.ObjectId;
  identifier: string; // email or username used for request
  codeHash: string; // scrypt hash of recovery code
  expiresAt: Date;
  used: boolean;
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const RecoveryCodeSchema = new Schema<IRecoveryCode>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  identifier: { type: String, required: true },
  codeHash: { type: String, required: true },
  expiresAt: { type: Date, required: true }, // Index defined below with TTL
  used: { type: Boolean, default: false },
  attempts: { type: Number, default: 0 },
}, {
  timestamps: true
});

// TTL cleanup: automatically delete documents after expiration
RecoveryCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IRecoveryCode>('RecoveryCode', RecoveryCodeSchema);
