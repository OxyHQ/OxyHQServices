import mongoose, { Schema, Document } from 'mongoose';

export interface IVerification extends Document {
  userId: mongoose.Types.ObjectId;
  type: 'email' | '2fa';
  code: string;
  token: string;
  method: 'email' | '2fa';
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  verified: boolean;
  metadata: {
    email?: string;
    deviceId?: string;
    userAgent?: string;
    ipAddress?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const VerificationSchema = new Schema<IVerification>({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['email', '2fa'],
    required: true,
  },
  code: {
    type: String,
    required: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
  },
  method: {
    type: String,
    enum: ['email', '2fa'],
    required: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }, // MongoDB TTL index (removes after expiration)
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 5,
  },
  verified: {
    type: Boolean,
    default: false,
  },
  metadata: {
    email: String,
    deviceId: String,
    userAgent: String,
    ipAddress: String,
  },
}, {
  timestamps: true,
});

// Composite indexes for performance
VerificationSchema.index({ userId: 1, type: 1 });
VerificationSchema.index({ token: 1 }); // Token lookup index

// Pre-save middleware to ensure expiration
VerificationSchema.pre('save', function (next) {
  if (!this.expiresAt) {
    // Default 10 minutes expiration
    this.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  }
  next();
});

export default mongoose.model<IVerification>("Verification", VerificationSchema);
