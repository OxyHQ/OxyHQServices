import mongoose, { type Document, Schema } from 'mongoose';

export interface IContact extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  email: string;
  company?: string;
  notes?: string;
  starred: boolean;
  autoCollected: boolean;
  lastContactedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ContactSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    company: {
      type: String,
      trim: true,
      default: undefined,
    },
    notes: {
      type: String,
      trim: true,
      default: undefined,
    },
    starred: {
      type: Boolean,
      default: false,
    },
    autoCollected: {
      type: Boolean,
      default: false,
    },
    lastContactedAt: {
      type: Date,
      default: undefined,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Unique per user + email
ContactSchema.index({ userId: 1, email: 1 }, { unique: true });
// Full-text search on name and email
ContactSchema.index({ userId: 1, name: 'text', email: 'text' });
// Starred contacts for a user
ContactSchema.index({ userId: 1, starred: 1 });

ContactSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = String(ret._id);
    const { _id: _, ...rest } = ret;
    return rest;
  },
});

export const Contact = mongoose.model<IContact>('Contact', ContactSchema);
export default Contact;
