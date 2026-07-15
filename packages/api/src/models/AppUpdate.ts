import mongoose, { Schema, type Document } from 'mongoose';
import crypto from 'crypto';
import { UPDATE_PLATFORMS, type UpdatePlatform } from './UpdateChannel';

/**
 * One published Oxy Update for a single `(channel, runtimeVersion, platform)`.
 * There is one `AppUpdate` per platform of a publish.
 *
 * `updateId` is a **UUIDv4** — the expo-updates client parses the manifest `id`
 * as a UUID, so this is deliberately NOT a ULID. It is the manifest `id` served
 * to devices and the public handle used by promote/rollout admin operations.
 *
 * The HEAD of a track is the newest `published` `AppUpdate` for a given
 * `(applicationId, channelId, runtimeVersion, platform)`, ordered by
 * `createdAt`. Rolling back marks the current head `rolled_back` (nothing is
 * deleted) so the previous published update becomes head again. Promoting into
 * a channel creates a NEW `AppUpdate` (new UUID) pointing at the SAME assets.
 *
 * The manifest asset descriptors are embedded (not foreign-keyed) so a published
 * update's manifest is self-contained and IMMUTABLE — the hot public manifest
 * endpoint builds the exact bytes to sign without any join, and an asset URL is
 * derived purely from its `sha256`. Upload/S3 bookkeeping lives separately in the
 * content-addressed `UpdateAsset` collection, linked by `sha256`.
 */
export const APP_UPDATE_STATUSES = ['published', 'superseded', 'rolled_back'] as const;

export type AppUpdateStatus = (typeof APP_UPDATE_STATUSES)[number];

/**
 * An embedded manifest asset descriptor. `key` is the expo-export asset key (the
 * md5 basename app code uses to reference — and to skip — assets already embedded
 * in the binary); `sha256` links to the content-addressed `UpdateAsset` and
 * yields the CDN URL + integrity hash. `fileExtension` (with leading dot) is
 * omitted for the launch asset.
 */
export interface IUpdateAssetRef {
  sha256: string;
  key: string;
  contentType: string;
  fileExtension?: string;
}

export interface IAppUpdate extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  updateId: string;
  applicationId: mongoose.Types.ObjectId;
  channelId: mongoose.Types.ObjectId;
  runtimeVersion: string;
  platform: UpdatePlatform;
  status: AppUpdateStatus;
  launchAsset: IUpdateAssetRef;
  assets: IUpdateAssetRef[];
  /**
   * Opaque `extra` blob embedded verbatim in the signed manifest. MUST carry
   * `expoClient` (the public expo config) so `Constants.expoConfig` resolves
   * after an OTA update.
   */
  extra: Record<string, unknown>;
  /** String→string manifest metadata dict (filtered client-side). */
  metadata: Record<string, string>;
  /** Rollout percentage [0,100]; deterministic per-device bucketing at serve time. */
  rolloutPercent: number;
  gitCommit?: string;
  message?: string;
  /** When this update is a promotion, the `updateId` it was promoted from. */
  promotedFromUpdateId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const UpdateAssetRefSchema = new Schema<IUpdateAssetRef>(
  {
    sha256: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
    key: { type: String, required: true },
    contentType: { type: String, required: true },
    fileExtension: { type: String },
  },
  { _id: false }
);

const AppUpdateSchema = new Schema<IAppUpdate>(
  {
    updateId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      default: () => crypto.randomUUID(),
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: 'Application',
      required: true,
      index: true,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'UpdateChannel',
      required: true,
      index: true,
    },
    runtimeVersion: {
      type: String,
      required: true,
    },
    platform: {
      type: String,
      enum: UPDATE_PLATFORMS,
      required: true,
    },
    status: {
      type: String,
      enum: APP_UPDATE_STATUSES,
      default: 'published',
      index: true,
    },
    launchAsset: {
      type: UpdateAssetRefSchema,
      required: true,
    },
    assets: {
      type: [UpdateAssetRefSchema],
      default: [],
    },
    extra: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator: (value: unknown): boolean =>
          typeof value === 'object' &&
          value !== null &&
          typeof (value as Record<string, unknown>).expoClient === 'object' &&
          (value as Record<string, unknown>).expoClient !== null,
        message: 'extra.expoClient is required so Constants.expoConfig resolves after OTA',
      },
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    rolloutPercent: {
      type: Number,
      default: 100,
      min: 0,
      max: 100,
    },
    gitCommit: { type: String },
    message: { type: String },
    promotedFromUpdateId: { type: String },
  },
  {
    timestamps: true,
  }
);

// Head resolution: newest published update for a channel + runtime + platform.
AppUpdateSchema.index({
  applicationId: 1,
  channelId: 1,
  runtimeVersion: 1,
  platform: 1,
  status: 1,
  createdAt: -1,
});

export const AppUpdate = mongoose.model<IAppUpdate>('AppUpdate', AppUpdateSchema);

export default AppUpdate;
