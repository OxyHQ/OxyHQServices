import { type LinkPreview, linkPreviewSchema } from '@oxyhq/contracts';
import type { ILinkPreview } from '../../models/LinkPreview';

/**
 * Fields the serializer reads off a stored preview. Deliberately a NARROW pick
 * that EXCLUDES `originImageUrl` / `originFaviconUrl` — the privacy invariant is
 * enforced at the type level here: the server-only origin URLs are not even in
 * scope for the mapping, so they can never be copied into the client DTO.
 */
export type SerializableLinkPreview = Pick<
  ILinkPreview,
  | 'requestedUrl'
  | 'canonicalUrl'
  | 'title'
  | 'description'
  | 'siteName'
  | 'favicon'
  | 'imageUrl'
  | 'status'
  | 'resolvedAt'
>;

/**
 * Map a stored preview to the `@oxyhq/contracts` `LinkPreview` DTO.
 *
 * Hard rules:
 *  - `image` / `favicon` come ONLY from the Oxy-hosted `imageUrl` / `favicon`
 *    columns — NEVER from the raw `originImageUrl` / `originFaviconUrl` (which
 *    are not even in {@link SerializableLinkPreview}).
 *  - The output is run through `linkPreviewSchema.parse`, which strips any field
 *    not declared on the contract — a second, defense-in-depth guarantee that no
 *    server-only field can leak.
 *  - `resolvedAt` is emitted only for a `resolved` preview.
 */
export function serializeLinkPreview(doc: SerializableLinkPreview): LinkPreview {
  const dto: LinkPreview = {
    url: doc.canonicalUrl || doc.requestedUrl,
    status: doc.status,
  };

  if (doc.title) dto.title = doc.title;
  if (doc.description) dto.description = doc.description;
  if (doc.siteName) dto.siteName = doc.siteName;
  if (doc.imageUrl) dto.image = doc.imageUrl;
  if (doc.favicon) dto.favicon = doc.favicon;
  if (doc.status === 'resolved' && doc.resolvedAt) {
    dto.resolvedAt = doc.resolvedAt.toISOString();
  }

  return linkPreviewSchema.parse(dto);
}
