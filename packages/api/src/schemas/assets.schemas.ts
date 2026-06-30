import { z } from 'zod';

// Params with :id
export const assetIdParams = z.object({
  id: z.string().trim().min(1),
});

// GET /assets (list)
export const listAssetsQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/).optional(),
  offset: z.string().regex(/^\d+$/).optional(),
});

// GET /assets/:id/url
export const assetUrlQuerySchema = z.object({
  variant: z.string().optional(),
  expiresIn: z.string().regex(/^\d+$/).optional(),
});

// PATCH /assets/:id/visibility
export const updateVisibilitySchema = z.object({
  visibility: z.enum(['private', 'public', 'unlisted']),
});

// DELETE /assets/:id
export const deleteAssetQuerySchema = z.object({
  force: z.enum(['true', 'false']).optional(),
});

// POST /assets/batch-access
export const batchAccessSchema = z.object({
  fileIds: z.array(z.string().min(1)).min(1).max(100),
  context: z.any().optional(),
});

// Maximum number of ids accepted by POST /assets/service/by-ids in a single
// request. Mirrors the POST /users/by-ids cap so a single service call can
// resolve all media of one post at once without unbounded fan-out.
export const MAX_ASSETS_BY_IDS = 100;

// POST /assets/service/by-ids
export const assetsByIdsBodySchema = z.object({
  ids: z
    .array(z.string().trim().min(1))
    .min(1, 'ids must not be empty')
    .max(MAX_ASSETS_BY_IDS, `Cannot request more than ${MAX_ASSETS_BY_IDS} assets at once`),
});

// Maximum number of content hashes accepted by POST /assets/service/by-sha256
// in a single request. Mirrors MAX_ASSETS_BY_IDS so the reverse content-address
// lookup has the same per-call fan-out ceiling as the forward id lookup.
export const MAX_ASSETS_BY_SHA256 = 100;

// A lowercase hex SHA-256 digest: exactly 64 hex characters.
const sha256Hex = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-f0-9]{64}$/, 'sha256 must be a 64-character hex digest');

// POST /assets/service/by-sha256
export const assetsBySha256BodySchema = z.object({
  sha256s: z
    .array(sha256Hex)
    .min(1, 'sha256s must not be empty')
    .max(MAX_ASSETS_BY_SHA256, `Cannot request more than ${MAX_ASSETS_BY_SHA256} hashes at once`),
});
