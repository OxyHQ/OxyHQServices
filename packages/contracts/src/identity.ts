/**
 * Self-sovereign identity API contracts.
 *
 * SINGLE SOURCE OF TRUTH for the wire shape of Oxy's AtProto/Bluesky-flavoured
 * identity & portability layer: the W3C DID document the API derives on demand,
 * the signed-record envelope clients sign with their cryptographic key (and the
 * server verifies), the verified-domain badge, the auth-method ↔ DID
 * verification-method mapping, and the signed data-export ("credible exit")
 * bundle. The API validates its OUTPUT against these schemas; every consumer
 * (the Commons vault app, `@oxyhq/core`'s identity mixin) validates its INPUT
 * against the same definitions, so producer and consumers cannot drift.
 *
 * Design anchors (from the identity-layer plan):
 *  - DID = `did:web:oxy.so:u:<userId>` — anchored on the stable account id, NOT
 *    the keypair. The keypair is a *verification method* that maps 1:1 to the
 *    existing `authMethods[]`. Custodial (password-only) users get a DID
 *    controlled solely by Oxy (`OXY_DID`); creating a Commons key upgrades them
 *    to self-sovereign (`controller = [userDid, OXY_DID]`); fully reversible.
 *  - Verification methods use the secp256k1 `EcdsaSecp256k1VerificationKey2019`
 *    type with `publicKeyHex` for now (a `Multikey`/`publicKeyMultibase` form may
 *    be added later — see the plan's open risks).
 *  - Signed records carry an envelope whose signing input is the canonical-JSON
 *    of every field EXCEPT `publicKey` and `signature`; `alg` is
 *    `ES256K-DER-SHA256` (secp256k1 over the SHA-256 of the canonical bytes,
 *    DER-encoded signature) — the same scheme `SignatureService` uses.
 *
 * Explicit-`interface` exports (DidDocument, SignedRecordEnvelope, ExportBundle,
 * VerifiedDomain, AuthMethodsResponse and their sub-parts) follow the same
 * rationale as `UserNameResponse` in `./userResponse`: a `z.infer<>` of a nested
 * object schema can degrade under a consumer's `moduleResolution: "node"`
 * (node10) resolution, so the load-bearing response shapes are declared as
 * literal interfaces and the runtime schemas are annotated `z.ZodType<Interface>`
 * — the emitted `.d.ts` then states the field types verbatim and survives BOTH
 * `node` and `bundler` resolution. Request schemas (no nested-object hazard) are
 * inferred via `z.infer<>`.
 *
 * Platform-agnostic — zod only, no react/react-native/expo. ESM-safe (no
 * `require()`).
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*  DID document (W3C DID core)                                               */
/* -------------------------------------------------------------------------- */

/**
 * A single DID verification method. Mirrors the secp256k1 key entries the API
 * derives from `User.publicKey` + each `authMethods[]` of type `identity`.
 * `id` is a fragment reference within the DID document (e.g.
 * `did:web:oxy.so:u:<id>#key-1`); `controller` is the controlling DID;
 * `publicKeyHex` is the uncompressed/compressed secp256k1 public key in hex.
 */
export interface VerificationMethod {
    id: string;
    type: 'EcdsaSecp256k1VerificationKey2019';
    controller: string;
    publicKeyHex: string;
}

export const verificationMethodSchema: z.ZodType<VerificationMethod> = z.object({
    id: z.string(),
    type: z.literal('EcdsaSecp256k1VerificationKey2019'),
    controller: z.string(),
    publicKeyHex: z.string(),
});

/**
 * A DID service entry (the `service[]` array). Oxy publishes its API root and
 * profile endpoints here so a resolver can discover where to fetch the user's
 * data. `serviceEndpoint` is a URL string.
 */
export interface DidService {
    id: string;
    type: string;
    serviceEndpoint: string;
}

export const didServiceSchema: z.ZodType<DidService> = z.object({
    id: z.string(),
    type: z.string(),
    serviceEndpoint: z.string(),
});

/**
 * A W3C DID document derived on demand by the API (no stored document).
 *
 * - `controller` is `[userDid, OXY_DID]` for a self-sovereign account (it holds
 *   at least one `identity` verification method) or `[OXY_DID]` for a custodial
 *   (password-only) account.
 * - `verificationMethod[]` is composed from the account's secp256k1 keys.
 * - `authentication` / `assertionMethod` reference verification-method ids.
 * - `alsoKnownAs[]` carries the account's other identifiers (`acct:` handle,
 *   profile URL, any verified-domain URLs).
 */
export interface DidDocument {
    '@context': string[];
    id: string;
    controller: string[];
    verificationMethod: VerificationMethod[];
    authentication: string[];
    assertionMethod: string[];
    alsoKnownAs: string[];
    service: DidService[];
}

export const didDocumentSchema: z.ZodType<DidDocument> = z.object({
    '@context': z.array(z.string()),
    id: z.string(),
    controller: z.array(z.string()),
    verificationMethod: z.array(verificationMethodSchema),
    authentication: z.array(z.string()),
    assertionMethod: z.array(z.string()),
    alsoKnownAs: z.array(z.string()),
    service: z.array(didServiceSchema),
});

/* -------------------------------------------------------------------------- */
/*  Signed records                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A signed record envelope. `record` is the arbitrary payload; the signing
 * input is the canonical-JSON of every envelope field EXCEPT `publicKey` and
 * `signature`. `subject` and `issuer` are DIDs (the subject the record is about
 * and the signer's DID — equal for self-issued records, `OXY_DID` for a
 * custodial provenance attestation). `issuedAt` is epoch milliseconds.
 */
export interface SignedRecordEnvelope {
    version: 1;
    type: 'identity' | 'profile';
    subject: string;
    issuer: string;
    record: Record<string, unknown>;
    issuedAt: number;
    publicKey: string;
    alg: 'ES256K-DER-SHA256';
    signature: string;
}

export const signedRecordEnvelopeSchema: z.ZodType<SignedRecordEnvelope> = z.object({
    version: z.literal(1),
    type: z.enum(['identity', 'profile']),
    subject: z.string(),
    issuer: z.string(),
    record: z.record(z.unknown()),
    issuedAt: z.number(),
    publicKey: z.string(),
    alg: z.literal('ES256K-DER-SHA256'),
    signature: z.string(),
});

/* -------------------------------------------------------------------------- */
/*  Verified domains (badge)                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A proven domain ownership badge. `method` records how ownership was proven —
 * a DNS-TXT record (`_oxy-identity.<domain>`) or a `/.well-known/oxy-domain`
 * HTTP file. `verifiedAt` is a string on the wire (ISO timestamp) but accepts a
 * `Date` so the API can validate its own pre-serialization model objects.
 */
export interface VerifiedDomain {
    domain: string;
    verifiedAt: string | Date;
    method: 'dns-txt' | 'well-known';
}

export const verifiedDomainSchema: z.ZodType<VerifiedDomain> = z.object({
    domain: z.string(),
    verifiedAt: z.union([z.string(), z.date()]),
    method: z.enum(['dns-txt', 'well-known']),
});

/** Request body for `POST /identity/domains` — the domain to start verifying. */
export const domainVerificationRequestSchema = z.object({
    domain: z.string().trim().min(1),
});

export type DomainVerificationRequest = z.infer<typeof domainVerificationRequestSchema>;

/**
 * The instructions the API returns when a domain verification is requested. The
 * caller may prove ownership EITHER by publishing the `dns` TXT record OR by
 * serving the `wellKnown` file; either path then satisfies
 * `POST /identity/domains/:domain/verify`.
 */
export const domainVerificationInstructionsSchema = z.object({
    domain: z.string(),
    token: z.string(),
    dns: z.object({
        name: z.string(),
        value: z.string(),
    }),
    wellKnown: z.object({
        url: z.string(),
        body: z.string(),
    }),
});

export type DomainVerificationInstructions = z.infer<
    typeof domainVerificationInstructionsSchema
>;

/* -------------------------------------------------------------------------- */
/*  Auth methods ↔ verification methods                                       */
/* -------------------------------------------------------------------------- */

/**
 * One linked authentication method. Mirrors a `User.authMethods[]` entry.
 * `verificationMethodId` is present for `identity` methods (a key) and absent
 * for `password`/social methods, linking the auth method to its DID
 * verification-method fragment.
 */
export interface AuthMethodEntry {
    type: 'identity' | 'password' | 'google' | 'apple' | 'github';
    linkedAt: string | Date;
    verificationMethodId?: string;
}

export const authMethodEntrySchema: z.ZodType<AuthMethodEntry> = z.object({
    type: z.enum(['identity', 'password', 'google', 'apple', 'github']),
    linkedAt: z.union([z.string(), z.date()]),
    verificationMethodId: z.string().optional(),
});

/**
 * Wire shape of `GET /auth/methods` — the account's DID plus every linked
 * authentication method.
 */
export interface AuthMethodsResponse {
    did: string;
    methods: AuthMethodEntry[];
}

export const authMethodsResponseSchema: z.ZodType<AuthMethodsResponse> = z.object({
    did: z.string(),
    methods: z.array(authMethodEntrySchema),
});

/* -------------------------------------------------------------------------- */
/*  Signed data export ("credible exit")                                      */
/* -------------------------------------------------------------------------- */

/**
 * A cryptographic attestation over the canonical-JSON of an export bundle.
 * Reused for both the mandatory Oxy provenance `attestation` (signed with the
 * Oxy custodial key) and the optional client `proof` (signed with the user's
 * own key when they hold one). `signedAt` is epoch milliseconds.
 */
export interface ExportAttestation {
    issuer: string;
    publicKey: string;
    alg: 'ES256K-DER-SHA256';
    signature: string;
    signedAt: number;
}

export const exportAttestationSchema: z.ZodType<ExportAttestation> = z.object({
    issuer: z.string(),
    publicKey: z.string(),
    alg: z.literal('ES256K-DER-SHA256'),
    signature: z.string(),
    signedAt: z.number(),
});

/**
 * The signed, open-format data-export bundle from `GET /users/me/export`. A
 * portable snapshot of the account: its DID document, profile, verified
 * domains, auth methods (no secrets), published signed records, per-app data,
 * and social graph.
 *
 * `attestation` is the Oxy custodial provenance signature. It is `null` only
 * when the Oxy custodial signing key (`OXY_PRIVATE_KEY`) is unset (dev /
 * pre-prod); in production it is always present. Carries an optional client
 * `proof` when the user signed the bundle with their own key.
 */
export interface ExportBundle {
    '$schema': string;
    exportedAt: string;
    did: string;
    didDocument: DidDocument;
    profile: Record<string, unknown>;
    verifiedDomains: VerifiedDomain[];
    authMethods: AuthMethodEntry[];
    signedRecords: SignedRecordEnvelope[];
    appData: Record<string, unknown>[];
    social: {
        following: string[];
        followers: string[];
    };
    attestation: ExportAttestation | null;
    proof?: ExportAttestation;
}

export const exportBundleSchema: z.ZodType<ExportBundle> = z.object({
    '$schema': z.string(),
    exportedAt: z.string(),
    did: z.string(),
    didDocument: didDocumentSchema,
    profile: z.record(z.unknown()),
    verifiedDomains: z.array(verifiedDomainSchema),
    authMethods: z.array(authMethodEntrySchema),
    signedRecords: z.array(signedRecordEnvelopeSchema),
    appData: z.array(z.record(z.unknown())),
    social: z.object({
        following: z.array(z.string()),
        followers: z.array(z.string()),
    }),
    attestation: exportAttestationSchema.nullable(),
    proof: exportAttestationSchema.optional(),
});
