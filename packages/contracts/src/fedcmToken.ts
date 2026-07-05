/**
 * Canonical contract for the FedCM ID-token JWT payload.
 *
 * DEAD SINCE THE WAVE-2 FEDCM DELETION (found during the comment sweep, not
 * fixed here — this is a published `@oxyhq/contracts` export, so removing it
 * is a breaking change/major-version decision, out of scope for a comment
 * fix): `POST /fedcm/exchange`, `fedcm.service.exchangeIdToken`, and
 * `packages/auth/server/index.ts`'s `mintSessionForClient` — every consumer
 * and producer this file describes — are all deleted. No current code
 * imports `fedcmTokenPayloadSchema` / `FedcmTokenPayload` outside this
 * package. Flag for a follow-up major-version cleanup.
 *
 * Original doc (historical, describes the now-deleted system):
 * SINGLE SOURCE OF TRUTH for the decoded claims of the HS256 ID token the auth
 * IdP (`auth.oxy.so`) signs and `POST /fedcm/exchange` consumes. The API decodes
 * the JWT, verifies its signature, then validates the resulting claim object
 * against this schema before trusting any field — a malformed payload (e.g. a
 * forged token whose signature happened to match but whose body is the wrong
 * shape) is rejected at the boundary instead of being cast and used.
 *
 * Validation philosophy — match the existing exchange behaviour exactly:
 *  - This schema validates the STRUCTURAL shape of the decoded claims only
 *    (types of the fields, not their presence or business-rule validity).
 *  - `sub` / `aud` / `nonce` / `iss` / `exp` presence + value checks remain in
 *    `fedcm.service.exchangeIdToken`, which returns the specific
 *    `missing_required_fields` / `invalid_issuer` / `token_expired` errors. So
 *    every field is `.optional()` here: a token missing `nonce` must still reach
 *    the `missing_required_fields` branch, not be rejected as a malformed token.
 *  - `.passthrough()` preserves any additional claims the IdP may add without a
 *    coordinated contract bump.
 *
 * Faithful to the producer:
 *  - `packages/auth/server/index.ts` `mintSessionForClient` — builds the
 *    assertion with `iss` (central issuer), `sub` (user id), `aud` (RP origin),
 *    `exp` / `iat` (numeric epoch seconds), and `nonce` (the server-minted,
 *    origin-bound nonce).
 *
 * Platform-agnostic — zod only, no react/react-native/expo. ESM-safe (no
 * `require()`).
 */

import { z } from 'zod';

/**
 * Decoded FedCM ID-token claims. Every field is optional because presence is
 * enforced downstream (see module doc); the schema's job is to guarantee that
 * any present claim has the correct primitive type before it is read.
 */
export const fedcmTokenPayloadSchema = z
    .object({
        iss: z.string().optional(),
        sub: z.string().optional(),
        aud: z.string().optional(),
        exp: z.number().optional(),
        iat: z.number().optional(),
        nonce: z.string().optional(),
        /**
         * An explicit central deviceId minted by the IdP, threaded through so the
         * RP session can inherit a unified device id instead of deriving one from
         * the (userId, RP origin) stableDeviceKey. Optional and additive — omitted
         * tokens fall back to the existing stableDeviceKey/UA-IP derivation.
         */
        deviceId: z.string().optional(),
    })
    .passthrough();

export type FedcmTokenPayload = z.infer<typeof fedcmTokenPayloadSchema>;
