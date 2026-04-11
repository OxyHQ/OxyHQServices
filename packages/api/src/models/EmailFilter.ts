import mongoose, { Document, Schema } from 'mongoose';

export interface IEmailFilterCondition {
  field: 'from' | 'to' | 'subject' | 'has-attachment' | 'size';
  operator: 'contains' | 'equals' | 'not-contains' | 'starts-with' | 'ends-with' | 'greater-than' | 'less-than';
  value: string;
}

export interface IEmailFilterAction {
  type: 'move' | 'label' | 'star' | 'mark-read' | 'archive' | 'delete' | 'forward';
  value?: string; // mailbox ID, label name, or forward address
}

export interface IEmailFilter extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  enabled: boolean;
  conditions: IEmailFilterCondition[];
  matchAll: boolean; // true = AND, false = OR
  actions: IEmailFilterAction[];
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const EmailFilterConditionSchema = new Schema(
  {
    field: {
      type: String,
      required: true,
      enum: ['from', 'to', 'subject', 'has-attachment', 'size'],
    },
    operator: {
      type: String,
      required: true,
      enum: ['contains', 'equals', 'not-contains', 'starts-with', 'ends-with', 'greater-than', 'less-than'],
    },
    value: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const EmailFilterActionSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ['move', 'label', 'star', 'mark-read', 'archive', 'delete', 'forward'],
    },
    value: {
      type: String,
    },
  },
  { _id: false }
);

const EmailFilterSchema = new Schema(
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
    enabled: {
      type: Boolean,
      default: true,
    },
    conditions: {
      type: [EmailFilterConditionSchema],
      required: true,
      validate: [(v: any[]) => v.length > 0, 'At least one condition is required'],
    },
    matchAll: {
      type: Boolean,
      default: true,
    },
    actions: {
      type: [EmailFilterActionSchema],
      required: true,
      validate: [(v: any[]) => v.length > 0, 'At least one action is required'],
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// User's filters, sorted by order
EmailFilterSchema.index({ userId: 1, enabled: 1, order: 1 });

EmailFilterSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const EmailFilter = mongoose.model<IEmailFilter>('EmailFilter', EmailFilterSchema);
export default EmailFilter;
