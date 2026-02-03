import mongoose, { Document, Schema } from 'mongoose';

export interface IMailbox extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  path: string;
  specialUse?: string;
  totalMessages: number;
  unseenMessages: number;
  size: number;
  retentionDays?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const MailboxSchema = new Schema(
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
    path: {
      type: String,
      required: true,
      trim: true,
    },
    specialUse: {
      type: String,
      trim: true,
      default: null,
    },
    totalMessages: {
      type: Number,
      default: 0,
      min: 0,
    },
    unseenMessages: {
      type: Number,
      default: 0,
      min: 0,
    },
    size: {
      type: Number,
      default: 0,
      min: 0,
    },
    retentionDays: {
      type: Number,
      default: null,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Unique mailbox path per user
MailboxSchema.index({ userId: 1, path: 1 }, { unique: true });
// Quick lookup by specialUse (e.g. find user's Inbox)
MailboxSchema.index({ userId: 1, specialUse: 1 });

MailboxSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Mailbox = mongoose.model<IMailbox>('Mailbox', MailboxSchema);
export default Mailbox;
