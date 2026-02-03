import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailAddress {
  name?: string;
  address: string;
}

export interface IAttachment {
  filename: string;
  contentType: string;
  size: number;
  s3Key: string;
  contentId?: string;
  isInline: boolean;
}

export interface IMessageFlags {
  seen: boolean;
  starred: boolean;
  answered: boolean;
  forwarded: boolean;
  draft: boolean;
}

export interface IMessage extends Document {
  userId: mongoose.Types.ObjectId;
  mailboxId: mongoose.Types.ObjectId;
  messageId: string;
  from: IEmailAddress;
  to: IEmailAddress[];
  cc: IEmailAddress[];
  bcc: IEmailAddress[];
  replyTo?: IEmailAddress;
  subject: string;
  text?: string;
  html?: string;
  headers: Record<string, string>;
  attachments: IAttachment[];
  flags: IMessageFlags;
  labels: string[];
  /** True when body is encrypted with the recipient's publicKey */
  encrypted: boolean;
  encryptedBody?: string;
  spamScore?: number;
  spamAction?: string;
  /** Total message size in bytes (body + attachments) */
  size: number;
  /** RFC In-Reply-To header */
  inReplyTo?: string;
  /** RFC References header (for threading) */
  references: string[];
  /** Alias tag if received via user+tag@oxy.so */
  aliasTag?: string;
  /** Date header from the original message */
  date: Date;
  /** When our server received the message */
  receivedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const EmailAddressSchema = new Schema(
  {
    name: { type: String, default: '' },
    address: { type: String, required: true, lowercase: true, trim: true },
  },
  { _id: false }
);

const AttachmentSchema = new Schema(
  {
    filename: { type: String, required: true },
    contentType: { type: String, required: true },
    size: { type: Number, required: true, min: 0 },
    s3Key: { type: String, required: true },
    contentId: { type: String, default: null },
    isInline: { type: Boolean, default: false },
  },
  { _id: false }
);

const MessageFlagsSchema = new Schema(
  {
    seen: { type: Boolean, default: false },
    starred: { type: Boolean, default: false },
    answered: { type: Boolean, default: false },
    forwarded: { type: Boolean, default: false },
    draft: { type: Boolean, default: false },
  },
  { _id: false }
);

const MessageSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    mailboxId: {
      type: Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true,
      index: true,
    },
    messageId: {
      type: String,
      required: true,
      trim: true,
    },
    from: {
      type: EmailAddressSchema,
      required: true,
    },
    to: {
      type: [EmailAddressSchema],
      default: [],
    },
    cc: {
      type: [EmailAddressSchema],
      default: [],
    },
    bcc: {
      type: [EmailAddressSchema],
      default: [],
    },
    replyTo: {
      type: EmailAddressSchema,
      default: null,
    },
    subject: {
      type: String,
      default: '',
      trim: true,
    },
    text: {
      type: String,
      default: null,
      select: false,
    },
    html: {
      type: String,
      default: null,
      select: false,
    },
    headers: {
      type: Map,
      of: String,
      default: new Map(),
      select: false,
    },
    attachments: {
      type: [AttachmentSchema],
      default: [],
    },
    flags: {
      type: MessageFlagsSchema,
      default: () => ({
        seen: false,
        starred: false,
        answered: false,
        forwarded: false,
        draft: false,
      }),
    },
    labels: {
      type: [String],
      default: [],
    },
    encrypted: {
      type: Boolean,
      default: false,
    },
    encryptedBody: {
      type: String,
      default: null,
      select: false,
    },
    spamScore: {
      type: Number,
      default: null,
    },
    spamAction: {
      type: String,
      default: null,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    inReplyTo: {
      type: String,
      default: null,
    },
    references: {
      type: [String],
      default: [],
    },
    aliasTag: {
      type: String,
      default: null,
    },
    date: {
      type: Date,
      required: true,
    },
    receivedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Primary query: list messages in a mailbox, newest first
MessageSchema.index({ userId: 1, mailboxId: 1, date: -1 });
// Thread lookup
MessageSchema.index({ userId: 1, messageId: 1 });
MessageSchema.index({ userId: 1, inReplyTo: 1 });
MessageSchema.index({ userId: 1, references: 1 });
// Flag-based queries (unseen, starred)
MessageSchema.index({ userId: 1, 'flags.seen': 1, mailboxId: 1 });
MessageSchema.index({ userId: 1, 'flags.starred': 1 });
// Full-text search on subject and text
MessageSchema.index(
  { subject: 'text', text: 'text' },
  { default_language: 'en', weights: { subject: 10, text: 1 } }
);
// Alias tag filtering
MessageSchema.index({ userId: 1, aliasTag: 1 });
// Retention / cleanup
MessageSchema.index({ mailboxId: 1, receivedAt: 1 });

MessageSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
export default Message;
