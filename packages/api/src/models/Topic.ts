import mongoose, { Document, Schema } from 'mongoose';

export enum TopicType {
  CATEGORY = 'category',
  TOPIC = 'topic',
  ENTITY = 'entity',
}

export enum TopicSource {
  SEED = 'seed',
  AI = 'ai',
  MANUAL = 'manual',
  SYSTEM = 'system',
}

export interface TopicTranslation {
  displayName: string;
  description?: string;
}

export interface ITopic extends Document {
  name: string;
  slug: string;
  displayName: string;
  description: string;
  type: TopicType;
  source: TopicSource;
  aliases: string[];
  parentTopicId?: mongoose.Types.ObjectId;
  icon?: string;
  image?: string;
  isActive: boolean;
  translations?: Map<string, TopicTranslation>;
  createdAt: Date;
  updatedAt: Date;
}

const TranslationSchema = new Schema(
  {
    displayName: { type: String, required: true },
    description: { type: String },
  },
  { _id: false }
);

const TopicSchema: Schema = new Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    type: {
      type: String,
      enum: Object.values(TopicType),
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: Object.values(TopicSource),
      required: true,
    },
    aliases: {
      type: [String],
      default: [],
      index: true,
    },
    parentTopicId: {
      type: Schema.Types.ObjectId,
      ref: 'Topic',
      index: true,
    },
    icon: { type: String },
    image: { type: String },
    isActive: {
      type: Boolean,
      default: true,
    },
    translations: {
      type: Map,
      of: TranslationSchema,
    },
  },
  {
    timestamps: true,
    strict: true,
  }
);

// Compound index for filtered listing
TopicSchema.index({ isActive: 1, type: 1 });

// Text index with weights for search relevance
TopicSchema.index(
  {
    name: 'text',
    displayName: 'text',
    aliases: 'text',
    description: 'text',
  },
  {
    weights: {
      name: 10,
      displayName: 8,
      aliases: 5,
      description: 1,
    },
    default_language: 'en',
  }
);

TopicSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    ret.id = ret._id?.toString();
    delete ret._id;
    return ret;
  },
});

export const Topic = mongoose.model<ITopic>('Topic', TopicSchema);
export default Topic;
