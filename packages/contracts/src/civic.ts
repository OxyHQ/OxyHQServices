/**
 * Civic / Commons API contracts (Fase 1 — DNI + crypto-owned reputation).
 *
 * SINGLE SOURCE OF TRUTH for the wire shape of the public "DNI" card a Commons
 * user shows (and others scan): the user's DID, display identity, trust tier,
 * personhood status, verified domains, and credential badges — sealed with an
 * Oxy custodial attestation so a scanner can verify it OFFLINE against the Oxy
 * public key (the same `ES256K-DER-SHA256` scheme as the signed data export).
 *
 * The QR encodes ONLY the DID (`oxydni://card?did=…`) — never trust data — so a
 * card cannot be spoofed by crafting a QR; the scanner resolves the signed card
 * server-side and verifies the Oxy signature. The attestation is computed over
 * the canonical-JSON of the `card` object, so a consumer re-canonicalizes the
 * card it received and verifies `attestation.signature` against
 * `attestation.publicKey` (which MUST be a current verification method of the
 * Oxy DID).
 *
 * Explicit-`interface` exports (PublicCard, SignedPublicCard) follow the same
 * node-resolution rationale as `UserNameResponse` / the identity contracts: a
 * nested `z.infer<>` can degrade to `{}` under a consumer's
 * `moduleResolution: "node"`, so the load-bearing shapes are declared as literal
 * interfaces and the runtime schemas are annotated `z.ZodType<Interface>`.
 *
 * The `attestation` reuses the export-bundle `ExportAttestation` shape from
 * `./identity` (mirrored, not duplicated): `{ issuer, publicKey, alg, signature,
 * signedAt }`. It is `null` ONLY when the Oxy signing key is unconfigured (dev).
 *
 * Platform-agnostic — zod only, no react/react-native/expo, ESM-safe.
 */

import { z } from 'zod';
import { exportAttestationSchema, type ExportAttestation } from './identity';

/* -------------------------------------------------------------------------- */
/*  Public DNI card                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The trust tier shown on the card. Mirrors the API's reputation `TRUST_TIERS`
 * (lowest → highest, plus the punitive `restricted`). Declared as a literal
 * union here (NOT imported from the API) so the contract package stays
 * dependency-free while giving consumers an exhaustive type to render against.
 */
export type CardTrustTier = 'restricted' | 'new' | 'trusted' | 'high_trust' | 'verified';

/**
 * Personhood verification status. `unverified` for everyone in Fase 1; the
 * web-of-trust pipeline (Fase 3) graduates users to `pending` / `verified`.
 */
export type PersonhoodStatus = 'unverified' | 'pending' | 'verified';

/**
 * The public, render-ready "DNI" card for a Commons user. Assembled server-side
 * from the canonical account fields and signed by Oxy.
 *
 * - `name` is the canonical composed display name (`name.displayName`) — a
 *   consumer renders it directly and NEVER recomposes it from `name.first` etc.
 * - `username` / `avatarUrl` are OPTIONAL (omitted entirely for accounts that
 *   have none) — `avatarUrl` is the public `cloud.oxy.so` URL when an avatar is
 *   set. The server emits ONLY present keys so a consumer re-canonicalizing the
 *   card it received derives byte-identical bytes for signature verification.
 * - `trustTier` is the user's current reputation tier; `personhoodStatus` is
 *   `unverified` for everyone in Fase 1 (Fase 3 graduates users) and
 *   `credentialBadges` is `[]` until verifiable credentials land (Fase 4).
 * - `issuedAt` is epoch milliseconds — part of the signed bytes (the attestation
 *   covers the canonical-JSON of the whole card), so a scanner can detect a
 *   stale/replayed card.
 */
export interface PublicCard {
    did: string;
    userId: string;
    name: string;
    username?: string;
    avatarUrl?: string;
    trustTier: CardTrustTier;
    personhoodStatus: PersonhoodStatus;
    verifiedDomains: string[];
    credentialBadges: string[];
    issuedAt: number;
}

export const publicCardSchema: z.ZodType<PublicCard> = z.object({
    did: z.string(),
    userId: z.string(),
    name: z.string(),
    username: z.string().optional(),
    avatarUrl: z.string().optional(),
    trustTier: z.enum(['restricted', 'new', 'trusted', 'high_trust', 'verified']),
    personhoodStatus: z.enum(['unverified', 'pending', 'verified']),
    verifiedDomains: z.array(z.string()),
    credentialBadges: z.array(z.string()),
    issuedAt: z.number(),
});

/**
 * A {@link PublicCard} sealed with an Oxy custodial attestation. The attestation
 * is an `ES256K-DER-SHA256` signature over the canonical-JSON of `card` (the
 * exact `ExportAttestation` shape reused from the signed data export). It is
 * `null` ONLY when the Oxy signing key (`OXY_PRIVATE_KEY`/`OXY_PUBLIC_KEY`) is
 * unconfigured (dev / pre-prod) — in production it is always present. A consumer
 * MUST check `attestation !== null` and that `attestation.publicKey` is the Oxy
 * custodial key before trusting the card.
 */
export interface SignedPublicCard {
    card: PublicCard;
    attestation: ExportAttestation | null;
}

export const signedPublicCardSchema: z.ZodType<SignedPublicCard> = z.object({
    card: publicCardSchema,
    attestation: exportAttestationSchema.nullable(),
});

/* -------------------------------------------------------------------------- */
/*  Real-life counterparty attestation (Fase 2 — Part A)                      */
/* -------------------------------------------------------------------------- */

/**
 * The `record` payload of a `real_life_attestation` signed envelope. The
 * COUNTERPARTY (B) signs this with their OWN key as a self-issued v2 record on
 * THEIR chain (`subject === issuer === B.did`); the subject being attested (A)
 * is referenced by `about` (A's DID). The server resolves `about` → A's account
 * and awards A the HIGH-weight `real_life_attested` points, recording B as the
 * attestor (so B can be slashed if A's action is later found fraudulent).
 *
 * - `context` is an opaque interaction id from the QR (`oxydni://attest?ctx=…`).
 * - `nonce` is the single-use replay guard from the QR; `exp` is its expiry
 *   (epoch ms) — both are part of the signed bytes.
 * - `geohash` (optional) is a coarse co-location proof; `biometricOk` (optional)
 *   signals B's device biometric gate fired before signing (a support signal,
 *   never sufficient alone).
 */
export interface RealLifeAttestationRecord {
    about: string;
    context: string;
    nonce: string;
    exp: number;
    geohash?: string;
    biometricOk?: boolean;
}

export const realLifeAttestationRecordSchema: z.ZodType<RealLifeAttestationRecord> = z.object({
    about: z.string(),
    context: z.string(),
    nonce: z.string(),
    exp: z.number(),
    geohash: z.string().optional(),
    biometricOk: z.boolean().optional(),
});

/**
 * The result of `POST /civic/attestations` on success: the stored attestation
 * record id (B's envelope), the subject + attestor account ids, and the points
 * awarded to the subject.
 */
export interface RealLifeAttestationResult {
    accepted: true;
    recordId: string;
    subjectUserId: string;
    attestorUserId: string;
    points: number;
}

export const realLifeAttestationResultSchema: z.ZodType<RealLifeAttestationResult> = z.object({
    accepted: z.literal(true),
    recordId: z.string(),
    subjectUserId: z.string(),
    attestorUserId: z.string(),
    points: z.number(),
});

/* -------------------------------------------------------------------------- */
/*  Validator jury (Fase 2 — Part B)                                          */
/* -------------------------------------------------------------------------- */

/** A juror's verdict on a validation request. */
export type ValidationVerdict = 'valid' | 'invalid' | 'abstain';

/** The lifecycle status of a validation request. */
export type ValidationRequestStatus = 'pending' | 'quorum_met' | 'validated' | 'rejected' | 'expired';

/**
 * The `record` payload of a `validation_verdict` signed envelope — a juror's
 * SELF-ISSUED verdict, bound to the request id + the canonical payload hash (so
 * a verdict cannot be replayed onto a different request or an altered payload).
 */
export interface ValidationVerdictRecord {
    requestId: string;
    payloadHash: string;
    verdict: ValidationVerdict;
}

export const validationVerdictRecordSchema: z.ZodType<ValidationVerdictRecord> = z.object({
    requestId: z.string(),
    payloadHash: z.string(),
    verdict: z.enum(['valid', 'invalid', 'abstain']),
});

/** Request body for opening a validation request (`POST /civic/validations`). */
export const validationOpenRequestSchema = z.object({
    subjectUserId: z.string(),
    actionType: z.string().min(1),
    sourceActionId: z.string().min(1),
    payload: z.record(z.unknown()),
    highValue: z.boolean().optional(),
});

export type ValidationOpenRequest = z.infer<typeof validationOpenRequestSchema>;

/** The result of opening a validation request (`POST /civic/validations`). */
export interface ValidationOpenResult {
    requestId: string;
    selectedValidatorCount: number;
    expiresAt: string;
}

export const validationOpenResultSchema: z.ZodType<ValidationOpenResult> = z.object({
    requestId: z.string(),
    selectedValidatorCount: z.number(),
    expiresAt: z.string(),
});

/**
 * A pending validation request as shown in a juror's inbox. `payload` is the
 * claim the juror inspects; `payloadHash` is what their verdict must bind to.
 */
export interface ValidationRequestSummary {
    id: string;
    subjectUserId: string;
    actionType: string;
    payload: Record<string, unknown>;
    payloadHash: string;
    status: ValidationRequestStatus;
    highValue: boolean;
    expiresAt: string;
}

export const validationRequestSummarySchema: z.ZodType<ValidationRequestSummary> = z.object({
    id: z.string(),
    subjectUserId: z.string(),
    actionType: z.string(),
    payload: z.record(z.unknown()),
    payloadHash: z.string(),
    status: z.enum(['pending', 'quorum_met', 'validated', 'rejected', 'expired']),
    highValue: z.boolean(),
    expiresAt: z.string(),
});

/** The result of casting a vote (`POST /civic/validations/:id/vote`). */
export interface ValidationVoteResult {
    recorded: true;
    requestId: string;
    verdict: ValidationVerdict;
    status: ValidationRequestStatus;
}

export const validationVoteResultSchema: z.ZodType<ValidationVoteResult> = z.object({
    recorded: z.literal(true),
    requestId: z.string(),
    verdict: z.enum(['valid', 'invalid', 'abstain']),
    status: z.enum(['pending', 'quorum_met', 'validated', 'rejected', 'expired']),
});
