import mongoose, { type Document, Schema } from 'mongoose';
import {
  REPUTATION_CATEGORIES,
  type ReputationCategory,
} from '../utils/reputation.constants';

/**
 * A configurable reputation award/penalty rule.
 *
 * `award` looks up the enabled rule by `actionType`; the rule supplies the
 * signed `points` and the `category` the resulting transaction is filed under.
 * `cooldownInMinutes > 0` rate-limits repeated awards of the same action to the
 * same subject user.
 */
export interface IReputationRule extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** Unique action key (e.g. `post_created`). */
  actionType: string;
  /** Signed points the rule awards (may be negative for penalties). */
  points: number;
  /** Category the resulting transaction is filed under. */
  category: ReputationCategory;
  description: string;
  /** Per (user, actionType) cooldown in minutes; 0 disables the cooldown. */
  cooldownInMinutes: number;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ReputationRuleSchema = new Schema<IReputationRule>(
  {
    actionType: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    points: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      enum: REPUTATION_CATEGORIES,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    cooldownInMinutes: {
      type: Number,
      default: 0,
    },
    isEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

export const ReputationRule = mongoose.model<IReputationRule>(
  'ReputationRule',
  ReputationRuleSchema
);

export default ReputationRule;
