import mongoose, { Document, Schema } from 'mongoose';

export interface IReminder extends Document {
  userId: mongoose.Types.ObjectId;
  text: string;
  remindAt: Date;
  completed: boolean;
  pinned: boolean;
  snoozedUntil: Date | null;
  relatedMessageId: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ReminderSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    remindAt: {
      type: Date,
      required: true,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    snoozedUntil: {
      type: Date,
      default: null,
    },
    relatedMessageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Active reminders for a user (not completed), sorted by reminder time
ReminderSchema.index({ userId: 1, completed: 1, remindAt: 1 });
// Processing cron: find due reminders
ReminderSchema.index({ completed: 1, remindAt: 1 }, { sparse: true });

ReminderSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Reminder = mongoose.model<IReminder>('Reminder', ReminderSchema);
export default Reminder;
