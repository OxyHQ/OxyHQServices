import mongoose, { Document, Schema } from 'mongoose';

interface IBackupCode {
  codeHash: string;
  used: boolean;
  createdAt: Date;
  usedAt?: Date;
}

export interface IRecoveryFactors extends Document {
  userId: mongoose.Types.ObjectId;
  backupCodes: IBackupCode[];
  recoveryKeyHash: string;
  lastRotatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BackupCodeSchema = new Schema<IBackupCode>({
  codeHash: { type: String, required: true },
  used: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  usedAt: { type: Date },
});

const RecoveryFactorsSchema = new Schema<IRecoveryFactors>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, index: true, required: true },
  backupCodes: { type: [BackupCodeSchema], default: [] },
  recoveryKeyHash: { type: String, required: true },
  lastRotatedAt: { type: Date },
}, { timestamps: true });

export default mongoose.model<IRecoveryFactors>('RecoveryFactors', RecoveryFactorsSchema);

