import mongoose, { Schema, type Document } from 'mongoose';

/**
 * A release channel (track) for one application's Oxy Updates — e.g.
 * `production`, `preview`, or a CI-created `pr-123`. A channel is a named
 * pointer that devices subscribe to via the `expo-channel-name` header; the
 * update they receive is the newest published `AppUpdate` for the channel that
 * matches their `(runtimeVersion, platform)`.
 *
 * `rollbacksToEmbedded` records the currently-active `rollBackToEmbedded`
 * directives for this channel. When an entry matches a requesting client's
 * `(runtimeVersion, platform)`, the manifest endpoint serves a signed
 * `rollBackToEmbedded` directive (with `parameters.commitTime`) instead of an
 * update, instructing the client to fall back to the update embedded in its
 * binary. Nothing is deleted to roll back — this is an additive directive.
 */
export const UPDATE_PLATFORMS = ['ios', 'android'] as const;

export type UpdatePlatform = (typeof UPDATE_PLATFORMS)[number];

/** An active rollback-to-embedded directive scoped to a runtime + platform. */
export interface IRollbackToEmbedded {
  runtimeVersion: string;
  platform: UpdatePlatform;
  /**
   * The directive's `commitTime` (ISO datetime): clients roll back to embedded
   * only when their currently-running update was created before this time.
   */
  commitTime: Date;
}

export interface IUpdateChannel extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  applicationId: mongoose.Types.ObjectId;
  /** Channel name, unique per application. */
  name: string;
  rollbacksToEmbedded: IRollbackToEmbedded[];
  createdAt: Date;
  updatedAt: Date;
}

const RollbackToEmbeddedSchema = new Schema<IRollbackToEmbedded>(
  {
    runtimeVersion: { type: String, required: true },
    platform: { type: String, enum: UPDATE_PLATFORMS, required: true },
    commitTime: { type: Date, required: true },
  },
  { _id: false }
);

const UpdateChannelSchema = new Schema<IUpdateChannel>(
  {
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    rollbacksToEmbedded: {
      type: [RollbackToEmbeddedSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// A channel name is unique within an application (but reusable across apps).
UpdateChannelSchema.index({ applicationId: 1, name: 1 }, { unique: true });

export const UpdateChannel = mongoose.model<IUpdateChannel>('UpdateChannel', UpdateChannelSchema);

export default UpdateChannel;
