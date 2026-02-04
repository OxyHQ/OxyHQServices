import mongoose, { Document, Schema } from 'mongoose';

export interface ILabel extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  color: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const LabelSchema = new Schema(
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
    color: {
      type: String,
      required: true,
      default: '#4285f4',
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

LabelSchema.index({ userId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

LabelSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc: any, ret: any) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Label = mongoose.model<ILabel>('Label', LabelSchema);
export default Label;
