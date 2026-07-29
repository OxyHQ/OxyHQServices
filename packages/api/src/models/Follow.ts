import mongoose, { type Document, Schema } from "mongoose";

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

// Create a compound index to ensure unique follows.
// Doubles as the FOLLOWING-direction access path: `{followerUserId, followType}`
// is a prefix of this key, so `GET /users/:id/following` reads only that user's
// own edges.
FollowSchema.index(
  { followerUserId: 1, followType: 1, followedId: 1 },
  { unique: true }
);
// Supports bounded public recommendations by scanning only a recent,
// followType-filtered prefix before grouping popular followed users.
FollowSchema.index({ followType: 1, createdAt: -1, _id: 1 });
// The FOLLOWERS-direction access path (`GET /users/:id/followers`, and the
// mutuals intersection, which also matches on `followedId`). Without it no
// index has `followedId` as a prefix, so those queries fall back to the
// `followType`-leading index above — and since `followType` is 3-valued, that
// scans EVERY user-type follow edge in the collection and fetches each one just
// to test `followedId`. Measured on a seeded 49,991-edge collection with a
// 5,000-follower target: 49,991 keys/docs examined before, 5,000 after — i.e.
// O(all follows) collapses to O(this account's fan-in).
// `createdAt`/`_id` mirror the list ordering so the key stays useful as the
// sort grows a tiebreak.
FollowSchema.index({ followedId: 1, followType: 1, createdAt: -1, _id: 1 });

export default mongoose.model<IFollow>("Follow", FollowSchema);