import mongoose, { Schema } from 'mongoose';

export interface ISenderAvatar {
  email: string;
  /** Relative path (e.g. /api/assets/:id/stream or /email/proxy?url=...) or null */
  avatarPath: string | null;
  source: 'oxy' | 'bimi' | 'gravatar' | 'favicon' | 'none';
  resolvedAt: Date;
  expiresAt: Date;
}

const SenderAvatarSchema = new Schema<ISenderAvatar>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    avatarPath: { type: String, default: null },
    source: { type: String, enum: ['oxy', 'bimi', 'gravatar', 'favicon', 'none'], required: true },
    resolvedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: false },
);

export const SenderAvatar = mongoose.model<ISenderAvatar>('SenderAvatar', SenderAvatarSchema);
