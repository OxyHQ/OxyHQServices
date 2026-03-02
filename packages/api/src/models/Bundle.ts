import mongoose, { Document, Schema } from 'mongoose';

export interface IBundle extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  icon: string;
  color: string;
  matchLabels: string[];
  enabled: boolean;
  collapsed: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const BundleSchema = new Schema(
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
    icon: {
      type: String,
      required: true,
      default: 'folder-outline',
    },
    color: {
      type: String,
      required: true,
      default: '#5F6368',
    },
    matchLabels: {
      type: [String],
      default: [],
    },
    enabled: {
      type: Boolean,
      default: true,
    },
    collapsed: {
      type: Boolean,
      default: true,
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

BundleSchema.index({ userId: 1, name: 1 }, { unique: true });

BundleSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Bundle = mongoose.model<IBundle>('Bundle', BundleSchema);
export default Bundle;
