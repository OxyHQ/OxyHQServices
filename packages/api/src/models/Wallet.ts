import mongoose, { Document, Schema } from "mongoose";

export interface IWallet extends Document {
  userId: mongoose.Types.ObjectId;
  balance: number;
  address?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WalletSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    address: {
      type: String,
      sparse: true,
    },
  },
  { timestamps: true }
);

export const Wallet = mongoose.model<IWallet>("Wallet", WalletSchema);
export default Wallet; 