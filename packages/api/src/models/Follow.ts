import mongoose, { Document, Schema } from "mongoose";

export enum FollowType {
  USER = 'user',
  HASHTAG = 'hashtag',
  TOPIC = 'topic'
}

export interface IFollow extends Document {
  followerUserId: mongoose.Types.ObjectId;
  followType: FollowType;
  followedId: mongoose.Types.ObjectId | string;
  createdAt: Date;
  updatedAt: Date;
}

const FollowSchema: Schema = new Schema(
  {
    followerUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    followType: {
      type: String,
      enum: Object.values(FollowType),
      required: true,
    },
    followedId: {
      type: Schema.Types.ObjectId,
      refPath: 'followType',
      required: true,
    }
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Create a compound index to ensure unique follows
FollowSchema.index(
  { followerUserId: 1, followType: 1, followedId: 1 },
  { unique: true }
);

export default mongoose.model<IFollow>("Follow", FollowSchema);