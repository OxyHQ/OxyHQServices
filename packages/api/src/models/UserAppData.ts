import mongoose, { type Document, Schema } from 'mongoose';

/**
 * UserAppData — generic per-user key/value store keyed by `(userId, namespace, key)`.
 *
 * First consumer is the Oxy Academy progress tracker on the website, but the
 * shape is intentionally generic so any Oxy surface can persist small bits of
 * cross-device app state against the signed-in user without each one needing
 * to grow a bespoke schema.
 *
 * Sizing / abuse controls live in the routes (request body cap, per-user rate
 * limit). The model itself only enforces the structural invariants the index
 * relies on: uniqueness on `(userId, namespace, key)` and the kebab/snake
 * case validation on the namespace and key.
 */
export interface IUserAppData extends Document {
  userId: mongoose.Types.ObjectId;
  namespace: string;
  key: string;
  value: unknown;
  updatedAt: Date;
  createdAt: Date;
}

/** Allowed characters for `namespace` and `key`: lowercase letters, digits, `-`, `_`. */
export const APP_DATA_IDENTIFIER_PATTERN = /^[a-z0-9_-]{1,64}$/u;

const UserAppDataSchema = new Schema<IUserAppData>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    namespace: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: APP_DATA_IDENTIFIER_PATTERN,
      maxlength: 64,
    },
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: APP_DATA_IDENTIFIER_PATTERN,
      maxlength: 64,
    },
    value: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
    strict: true,
    minimize: false,
  },
);

// Composite uniqueness — one document per (user, namespace, key).
UserAppDataSchema.index({ userId: 1, namespace: 1, key: 1 }, { unique: true });
// Listing a whole namespace for a user.
UserAppDataSchema.index({ userId: 1, namespace: 1 });

// `_id` → `id` rewrite on serialization. Mongoose narrows `ret` to the
// document type, which forbids `delete ret._id` because `_id` is required.
// We work around that by reshaping the payload via destructuring — same
// runtime semantics, but TypeScript sees a clean object literal so no
// `any` cast or eslint-disable is needed.
UserAppDataSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform(_doc, ret) {
    const { _id, __v: _versionKey, ...rest } = ret as { _id: { toString: () => string }; __v?: unknown };
    return { ...rest, id: _id.toString() };
  },
});

export const UserAppData = mongoose.model<IUserAppData>('UserAppData', UserAppDataSchema);
export default UserAppData;
