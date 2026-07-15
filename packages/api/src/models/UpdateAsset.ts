import mongoose, { Schema, type Document } from 'mongoose';

/**
 * A content-addressed asset uploaded as part of an Oxy Update (self-hosted
 * expo-updates). Assets are keyed by their SHA-256 content hash and shared
 * across every update and application that references the same bytes — an
 * unchanged JS bundle or image is stored in S3 exactly once.
 *
 * The S3 object always lives at `public/updates/assets/<sha256-hex>` and is
 * served to devices by the existing `cloud.oxy.so` CloudFront distribution
 * (`https://cloud.oxy.so/updates/assets/<sha256-hex>`). The object is IMMUTABLE:
 * a URL for a given content hash must never change or be removed, because a
 * client may fetch any historical update's assets at any time (expo-updates
 * spec, "Asset response").
 *
 * Upload is a two-step flow mirroring `routes/assets.ts`: `assets/init` creates
 * the record `pending` and hands back a presigned PUT; `assets/complete` HEADs
 * the object and flips it to `uploaded`. Only `uploaded` assets may be
 * referenced by a published update.
 */
export const UPDATE_ASSET_STATUSES = ['pending', 'uploaded'] as const;

export type UpdateAssetStatus = (typeof UPDATE_ASSET_STATUSES)[number];

export interface IUpdateAsset extends Omit<Document, '_id'> {
  _id: mongoose.Types.ObjectId;
  /** Lowercase-hex SHA-256 of the asset bytes. The content-address / dedup key. */
  sha256: string;
  /** S3 object key: `public/updates/assets/<sha256-hex>`. */
  s3Key: string;
  /** MIME type of the bytes (declared at init; e.g. `application/javascript`). */
  contentType: string;
  /** Byte length of the object (verified against S3 HeadObject at complete). */
  size: number;
  status: UpdateAssetStatus;
  createdAt: Date;
  updatedAt: Date;
}

const UpdateAssetSchema = new Schema<IUpdateAsset>(
  {
    sha256: {
      type: String,
      required: true,
      unique: true,
      index: true,
      match: /^[a-f0-9]{64}$/,
    },
    s3Key: {
      type: String,
      required: true,
    },
    contentType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: UPDATE_ASSET_STATUSES,
      default: 'pending',
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const UpdateAsset = mongoose.model<IUpdateAsset>('UpdateAsset', UpdateAssetSchema);

export default UpdateAsset;
