import mongoose, { Document, Schema } from 'mongoose';

export interface ITotp extends Document {
  userId: mongoose.Types.ObjectId;
  secret: string; // base32 secret
  verified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const TotpSchema = new Schema<ITotp>({
  userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true, index: true },
  secret: { type: String, required: true, select: false },
  verified: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model<ITotp>('Totp', TotpSchema);

