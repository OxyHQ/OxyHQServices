/**
 * Oxy-scoped signed-record types.
 *
 * The base `signedRecordEnvelopeSchema` (`./identity`) now treats `type` as an
 * OPEN, non-empty string so ANY Oxy app may define its own record categories
 * (e.g. `app.mention.*`'s `app_record`) on the shared envelope grammar. The Oxy
 * identity/civic/node STORE, however, accepts ONLY the closed set of categories
 * it knows how to verify and materialize — this module is that closed set.
 *
 * `oxySignedRecordTypeSchema` is the runtime gate the Oxy store re-narrows with
 * (the API's `verifyEnvelope` rejects any `type` outside it; the Mongoose
 * `SignedRecord.type` enum is derived from `.options`); `OxySignedRecordType` is
 * the matching compile-time union the SDK identity/civic mixins type against.
 *
 * The signing input INCLUDES `type`, so this set is part of the signed bytes —
 * a record cannot have its category swapped after signing.
 *
 * v1 only ever carried `identity` / `profile` (already in production); v2 added
 * the civic record types (reputation attestations, real-life / peer validations,
 * personhood vouches, verifiable credentials) and the user-node registration
 * record. Every value here is an Oxy `app.oxy.*` (or legacy v1) category — an
 * app's own `type` (e.g. `app_record`) is intentionally NOT in this set and is
 * rejected by the Oxy store.
 *
 * Platform-agnostic — zod only, no react/react-native/expo, ESM-safe.
 */

import { z } from 'zod';

export const oxySignedRecordTypeSchema = z.enum([
    'identity',
    'profile',
    'reputation_attestation',
    'real_life_attestation',
    'validation_verdict',
    'personhood_vouch',
    'credential',
    'node',
]);

/**
 * The closed set of record categories the Oxy identity/civic/node store accepts.
 * The base envelope `type` is an open string; this is what the Oxy store
 * re-narrows it to.
 */
export type OxySignedRecordType = z.infer<typeof oxySignedRecordTypeSchema>;
