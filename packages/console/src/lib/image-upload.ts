import type { OxyServices } from '@oxyhq/core';

/**
 * Shared image-upload helpers for Console logo / avatar widgets.
 *
 * Upload mechanism (Google-Cloud-Console style — upload only, no URL paste):
 *  1. `oxyServices.uploadRawFile(file, 'public')` uploads the raw `File`.
 *  2. The upload response is `{ file: { id, mime, size, ... } }` — the id is at
 *     `response.file.id`. The response does NOT contain a ready URL.
 *  3. We derive a public, directly-renderable URL with the synchronous helper
 *     `oxyServices.getFileDownloadUrl(id)`, which returns the
 *     `/assets/:id/stream` endpoint. For `public`-visibility assets that endpoint
 *     serves without a session token, so the URL renders in a plain `<img>` and
 *     on the public consent screen.
 */

/** Allowed image MIME types for logo / avatar uploads. */
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
] as const;

/** Maximum upload size: 2 MB. */
export const MAX_IMAGE_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Human-readable max size, used in validation messages. */
export const MAX_IMAGE_UPLOAD_LABEL = '2 MB';

/** Visibility used for uploaded logos/avatars — public so they render unauthenticated. */
const PUBLIC_VISIBILITY = 'public' as const;

/** Shape of the `uploadRawFile` response that we depend on. */
interface RawFileUploadResponse {
  file: { id: string };
}

function isRawFileUploadResponse(value: unknown): value is RawFileUploadResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const file = (value as { file?: unknown }).file;
  if (!file || typeof file !== 'object') {
    return false;
  }
  return typeof (file as { id?: unknown }).id === 'string';
}

/** Result of validating a candidate image file before upload. */
export type ImageValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Validate a candidate image file against the allowed MIME types and size cap.
 * Returns a discriminated result so callers can surface the precise message.
 */
export function validateImageFile(file: File): ImageValidationResult {
  const isAllowedType = (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  if (!isAllowedType) {
    return {
      ok: false,
      message: 'Unsupported image type. Use PNG, JPEG, SVG, or WebP.',
    };
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      message: `Image is too large. The maximum size is ${MAX_IMAGE_UPLOAD_LABEL}.`,
    };
  }
  return { ok: true };
}

/**
 * Upload a public image and return a directly-renderable URL string.
 *
 * @throws when the upload fails or the response is missing a file id.
 */
export async function uploadPublicImage(
  oxyServices: OxyServices,
  file: File
): Promise<string> {
  const response = await oxyServices.uploadRawFile(file, PUBLIC_VISIBILITY);
  if (!isRawFileUploadResponse(response)) {
    throw new Error('Upload did not return a file id');
  }
  return oxyServices.getFileDownloadUrl(response.file.id);
}
