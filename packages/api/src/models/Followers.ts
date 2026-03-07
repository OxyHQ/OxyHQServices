import mongoose, { Document, Schema } from "mongoose";

const followersSchema: Schema = new Schema({
  userID: { type: String, required: true },
  contentID: { type: String, required: true },
  created_at: { type: Date, required: true },
  updatedAt: { type: Date, required: true },
});

followersSchema.index({ userID: 1, contentID: 1 }, { unique: true });
followersSchema.index({ contentID: 1 });

export default mongoose.model("Followers", followersSchema);
