import { z } from 'zod';

/**
 * Query schema for `GET /links/preview`.
 *  - `url`: the URL to unfurl (1..2048 chars; further validated/normalized by
 *    the resolver + SSRF guard).
 *  - `wait`: `'0'` (default) returns cached-or-`pending` and warms in the
 *    background; `'1'` performs a bounded synchronous resolve (compose-time).
 */
export const linkPreviewQuerySchema = z.object({
  url: z.string().trim().min(1).max(2048),
  wait: z.enum(['0', '1']).optional().default('0'),
});

export type LinkPreviewQuery = z.infer<typeof linkPreviewQuerySchema>;
