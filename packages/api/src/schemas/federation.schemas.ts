import { z } from 'zod';

/**
 * Schemas for the federation sign-on-behalf routes (`/federation/...`).
 *
 * SECURITY: these endpoints let a service credential (e.g. Mention) obtain the
 * public half of, and HTTP-Signature signatures from, a domain-scoped key whose
 * PRIVATE half never leaves Oxy. The schemas here enforce the structural
 * contract; the route enforces the trust boundary (keyId host must belong to
 * the credential's Application — see `routes/federation.ts`).
 */

/**
 * Max length of an HTTP-Signature signing string. A signing string is a handful
 * of header lines (request-target, host, date, digest, content-type); a few KB
 * is comfortably above any legitimate value and well below anything that could
 * be abused to turn the endpoint into a bulk signing oracle.
 */
export const MAX_SIGNING_STRING_LENGTH = 4096;

/** A federation `#main-key` keyId — must be an absolute https URL. */
const keyIdSchema = z
  .string()
  .trim()
  .url('keyId must be a valid URL')
  .max(2048, 'keyId is too long')
  .refine((value) => value.startsWith('https://'), {
    message: 'keyId must be an https URL',
  })
  .refine((value) => value.endsWith('#main-key'), {
    message: 'keyId must end with #main-key',
  });

// GET /federation/public-key/:username
export const publicKeyParamsSchema = z.object({
  username: z.string().trim().min(1, 'username is required').max(256),
});

// GET /federation/public-key/:username?domain=<domain>
export const publicKeyQuerySchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, 'domain is required')
    .max(253, 'domain is too long')
    // RFC-1123-ish hostname: labels of [a-z0-9-] separated by dots, at least
    // one dot. Rejects schemes, ports, paths, and userinfo.
    .regex(
      /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
      'domain must be a bare hostname',
    ),
});

// POST /federation/sign
export const signRequestSchema = z.object({
  keyId: keyIdSchema,
  signingString: z
    .string()
    .min(1, 'signingString is required')
    .max(MAX_SIGNING_STRING_LENGTH, `signingString must not exceed ${MAX_SIGNING_STRING_LENGTH} characters`)
    // Not a generic signing oracle: the first signed header MUST be the HTTP
    // request-target pseudo-header, i.e. this is signing an outbound AP request.
    .refine((value) => value.startsWith('(request-target):'), {
      message: 'signingString must begin with "(request-target):"',
    }),
});

export type PublicKeyParams = z.infer<typeof publicKeyParamsSchema>;
export type PublicKeyQuery = z.infer<typeof publicKeyQuerySchema>;
export type SignRequestBody = z.infer<typeof signRequestSchema>;
