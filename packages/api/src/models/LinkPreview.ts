import mongoose, { Schema, type Document } from 'mongoose';
import type { LinkPreviewStatus } from '@oxyhq/contracts';

/**
 * Durable store for resolved (or in-flight) link previews — the source of truth
 * behind the `/links/preview` + `/links/previews` API.
 *
 * `_id` is the SHA-256 hex of the NORMALIZED requested URL, so a lookup by URL
 * is a primary-key read and the same URL can never produce two rows.
 *
 * PRIVACY INVARIANT: `imageUrl` / `favicon` are ALWAYS Oxy-hosted
 * (`cloud.oxy.so/<fileId>`) URLs, set only once the remote image was downloaded
 * server-side and re-hosted onto Oxy media. The raw remote URLs live in the
 * server-only `originImageUrl` / `originFaviconUrl` fields and are used solely
 * to re-host on refresh — the serializer NEVER copies them into the client DTO.
 */
export interface ILinkPreview extends Omit<Document, '_id'> {
  /** SHA-256 hex of the normalized requested URL. */
  _id: string;
  /** The normalized URL that was requested/resolved. */
  requestedUrl: string;
  /** Canonical / final URL after following redirects. */
  canonicalUrl: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Oxy-hosted (`cloud.oxy.so`) favicon URL returned to clients. */
  favicon?: string;
  /** Oxy-hosted (`cloud.oxy.so`) image URL returned to clients. */
  imageUrl?: string;
  /**
   * SERVER-ONLY raw remote image URL. Used to re-host on refresh. NEVER
   * serialized into the client DTO (would leak the viewer's IP to the origin).
   */
  originImageUrl?: string;
  /** SERVER-ONLY raw remote favicon URL. Same contract as {@link originImageUrl}. */
  originFaviconUrl?: string;
  status: LinkPreviewStatus;
  /** Resolver version that produced this row (see resolver constants). */
  version: number;
  /** When the preview was last (re)resolved. */
  resolvedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const LinkPreviewSchema = new Schema<ILinkPreview>(
  {
    _id: { type: String, required: true },
    requestedUrl: { type: String, required: true },
    canonicalUrl: { type: String, required: true },
    title: { type: String },
    description: { type: String },
    siteName: { type: String },
    favicon: { type: String },
    imageUrl: { type: String },
    originImageUrl: { type: String },
    originFaviconUrl: { type: String },
    status: {
      type: String,
      enum: ['resolved', 'pending', 'empty'],
      required: true,
      default: 'pending',
      index: true,
    },
    version: { type: Number, required: true, default: 0 },
    resolvedAt: { type: Date },
  },
  {
    timestamps: true,
    // `_id` is a caller-supplied SHA-256 string, not a generated ObjectId.
    _id: false,
  },
);

// Refresh sweeps query by recency of resolution.
LinkPreviewSchema.index({ updatedAt: -1 });

export const LinkPreview = mongoose.model<ILinkPreview>('LinkPreview', LinkPreviewSchema);
