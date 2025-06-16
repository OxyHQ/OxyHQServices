import mongoose, { Document, Schema } from "mongoose";

export interface IKarmaRule extends Document {
  action: string;
  points: number;
  description: string;
  cooldownInMinutes: number;
  isEnabled: boolean;
  category: string;
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const KarmaRuleSchema: Schema = new Schema(
  {
    action: {
      type: String,
      required: true,
      unique: true,
    },
    points: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    cooldownInMinutes: {
      type: Number,
      default: 0,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
    category: {
      type: String,
      enum: ["content", "social", "system", "purchases", "other"],
      default: "other",
    },
  },
  {
    timestamps: true,
  }
);

export const KarmaRule = mongoose.model<IKarmaRule>("KarmaRule", KarmaRuleSchema);
export default KarmaRule; 