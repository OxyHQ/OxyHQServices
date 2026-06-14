/**
 * Federation media-cache constants.
 *
 * These pin down a single, reserved namespace for assets created via the
 * service-token cache endpoints (`POST /assets/service/cache`,
 * `DELETE /assets/service/cache/:id`). Backend services (e.g. the Mention
 * backend, which holds an Oxy service token via `configureServiceAuth`) use
 * those endpoints to cache federated/remote media to Oxy S3.
 *
 * Scoping rationale: a leaked or abused service token must NEVER be able to
 * read or delete user-owned media. Every asset created through the cache path
 * is forced onto the reserved owner {@link FEDERATION_CACHE_OWNER_ID} AND
 * tagged with {@link FEDERATION_MEDIA_CACHE_PURPOSE}. The delete endpoint
 * re-loads the asset and rejects anything that is not in this namespace, so
 * the blast radius of the service token is bounded to cache objects only.
 */

/**
 * Reserved synthetic owner id for all federation-cached media. Not a valid
 * Mongo ObjectId, so it can never collide with a real user `_id` and the
 * media-privacy block checks short-circuit it (see `mediaPrivacyService`).
 */
export const FEDERATION_CACHE_OWNER_ID = '__federation_media_cache__';

/**
 * `purpose` tag stamped onto every File created via the cache path. The delete
 * endpoint requires this value before it will touch an asset.
 */
export const FEDERATION_MEDIA_CACHE_PURPOSE = 'federation-media-cache';

/**
 * Maximum size (bytes) accepted by the cache upload endpoint. 256 MiB leaves
 * head-room for federated video while still bounding S3 write cost and the
 * work an abused token could trigger.
 */
export const FEDERATION_CACHE_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Content-type prefixes the cache endpoint will accept. Federated media is
 * always image / video / audio; anything else (documents, archives,
 * executables) is rejected to keep the cache a pure media surface.
 */
export const FEDERATION_CACHE_ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/'] as const;

/**
 * Content-type prefixes that are explicitly REJECTED even when they match an
 * allowed prefix. `image/svg+xml` (and any `image/svg*`) is an active document:
 * an SVG can embed `<script>` and execute in a browsing context, so caching
 * one and serving it back is a stored-XSS vector. SVG is therefore disallowed
 * despite matching the `image/` family.
 */
export const DISALLOWED_CACHE_MIME_PREFIXES = ['image/svg'] as const;

/**
 * True when `mime` is an SVG content-type (`image/svg+xml`, `image/svg`, …).
 */
export function isSvgMime(mime: string): boolean {
  return DISALLOWED_CACHE_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

/**
 * True when `mime` is one of the allowed media families AND not an explicitly
 * disallowed type (e.g. SVG, which is rejected as a stored-XSS vector).
 */
export function isAllowedCacheMime(mime: string): boolean {
  if (isSvgMime(mime)) {
    return false;
  }
  return FEDERATION_CACHE_ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}
