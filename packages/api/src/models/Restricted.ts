import mongoose, { Document, Schema } from "mongoose";

export interface IRestricted extends Document {
  userId: mongoose.Types.ObjectId;
  restrictedId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const RestrictedSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  restrictedId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Create compound index to ensure uniqueness of user-restrict pairs
RestrictedSchema.index({ userId: 1, restrictedId: 1 }, { unique: true });

export default mongoose.model<IRestricted>("Restricted", RestrictedSchema);

