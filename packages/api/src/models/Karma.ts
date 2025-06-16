import mongoose, { Document, Schema } from "mongoose";

export interface KarmaAction {
  action: string;
  points: number;
  timestamp: Date;
  description?: string;
  sourceUserId?: mongoose.Types.ObjectId;
  targetContentId?: string;
}

export interface IKarma extends Document {
  userId: mongoose.Types.ObjectId;
  totalKarma: number;
  history: KarmaAction[];
  _id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const KarmaSchema: Schema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    totalKarma: {
      type: Number,
      default: 0,
    },
    history: [
      {
        action: {
          type: String,
          required: true,
        },
        points: {
          type: Number,
          required: true,
        },
        timestamp: {
          type: Date,
          default: Date.now,
        },
        description: {
          type: String,
        },
        sourceUserId: {
          type: Schema.Types.ObjectId,
          ref: "User",
        },
        targetContentId: {
          type: String,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

// When finding a karma record, sort history by timestamp descending
KarmaSchema.pre("findOne", function (next) {
  this.populate("userId", "username");
  next();
});

export const Karma = mongoose.model<IKarma>("Karma", KarmaSchema);
export default Karma; 