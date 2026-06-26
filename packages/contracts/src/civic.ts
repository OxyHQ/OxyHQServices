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
