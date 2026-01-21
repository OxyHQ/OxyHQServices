import mongoose, { Document, Schema } from 'mongoose';

export interface IFedCMClient extends Document {
  origin: string; // The client origin (e.g., https://example.com)
  name: string; // Friendly name for the client
  description?: string; // Optional description
  approved: boolean; // Whether this client is approved
  autoSignIn: boolean; // Whether to enable auto sign-in for this client
  createdAt: Date;
  updatedAt: Date;
  approvedAt?: Date;
  approvedBy?: mongoose.Types.ObjectId; // Admin user who approved
}

const FedCMClientSchema = new Schema<IFedCMClient>({
  origin: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    validate: {
      validator: function(v: string) {
        // Validate that origin is a valid URL
        try {
          const url = new URL(v);
          return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
          return false;
        }
      },
      message: 'Origin must be a valid HTTP or HTTPS URL'
    }
  },
  name: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  approved: {
    type: Boolean,
    default: false,
    index: true,
  },
  autoSignIn: {
    type: Boolean,
    default: true,
  },
  approvedAt: {
    type: Date,
  },
  approvedBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
  },
}, {
  timestamps: true,
});

// Index for fast approval lookups
FedCMClientSchema.index({ approved: 1, origin: 1 });

export default mongoose.model<IFedCMClient>('FedCMClient', FedCMClientSchema);
