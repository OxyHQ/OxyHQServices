/**
 * Civic Methods Mixin (Commons "DNI" — Fase 1)
 *
 * Provides typed access to the public, verifiable citizen-identity ("DNI") card
 * a Commons user shows and others scan:
 *
 *  - {@link OxyServicesCivicMixin.getPublicCard} fetches a user's signed card
 *    (`GET /civic/:userId/card`) and verifies the Oxy custodial attestation
 *    CLIENT-SIDE, so a scanner can trust the card OFFLINE (e.g. a cached card
 *    replayed without network) instead of re-trusting the transport.
 *  - {@link OxyServicesCivicMixin.getMyDniPayload} builds the QR payload the user
 *    displays. The QR encodes ONLY the DID (`oxydni://card?did=…&v=1`) — never
 *    trust data — so the card cannot be spoofed by crafting a QR; the scanner
 *    resolves the signed card server-side and re-verifies it.
 *
 * The wire shapes (`PublicCard`, `SignedPublicCard`, `ExportAttestation`) come
 * from `@oxyhq/contracts` — the single source of truth the API validates its
 * output against — so producer and consumer cannot drift. The attestation is an
 * `ES256K-DER-SHA256` signature over `canonicalize(card)` (the exact bytes the
 * server signed, with ONLY the present keys), so a consumer re-canonicalizes the
 * `card` it received and checks the signature against `attestation.publicKey`.
 *
 * Verification NEVER throws on a bad/absent signature — it returns
 * `verified: false` so the UI can render a forged/unsigned card as visibly
 * untrusted rather than silently trusting it. A transport/network failure (the
 * fetch itself) still rejects, as everywhere else in the SDK.
 *
 * Platform-agnostic: reading a public card and building/parsing a DNI payload
 * work on web and native alike (no on-device key required — the card is signed
 * by Oxy, not the user). Deriving the current user's DID requires an
 * authenticated session.
 */
import type { ExportAttestation, PublicCard, SignedPublicCard } from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';
import { canonicalize } from '../crypto/canonicalJson';
import { SignatureService } from '../crypto/signatureService';
import { buildUserDid } from './OxyServices.identity';
import { CACHE_TIMES } from './mixinHelpers';

/**
 * A {@link SignedPublicCard} augmented with the client's verification verdict.
 *
 * - `card` / `attestation` are echoed straight from the API response.
 * - `verified` is `true` ONLY when `attestation` is present and its signature
 *   over `canonicalize(card)` checks out against `attestation.publicKey`. It is
 *   `false` for an unsigned card (dev, `attestation === null`), a tampered card,
 *   or a signature made with a different key.
 *
 * `verified` confirms the attestation's signature is internally consistent with
 * its embedded `publicKey` (and that the card bytes were not mutated). It does
 * NOT, on its own, establish that `publicKey` is Oxy's custodial key — that trust
 * anchor is the Oxy API the card was fetched from (over TLS) and, for the
 * pinning-conscious, `attestation.issuer` (the Oxy DID). The UI shows a trust
 * indicator from `verified`; a `false` verdict MUST be surfaced as untrusted.
 */
export interface CivicCardResult extends SignedPublicCard {
  verified: boolean;
}

/** The DID extracted from a scanned `oxydni://card?did=…` DNI payload. */
export interface DniCardRef {
  /** The subject's Oxy DID (`did:web:oxy.so:u:<userId>`). */
  did: string;
}

/** URI scheme/host that introduces a Commons DNI card payload. */
const DNI_MATCHER = /^oxydni:\/\/card(?:[/?#]|$)/i;

/**
 * Minimal, allocation-light query-string parser (no `URL` / `URLSearchParams`)
 * so it runs identically under Hermes and jsdom — mirrors the robustness of the
 * "Sign in with Oxy" approval-link parser.
 */
function parseDniQuery(raw: string): Map<string, string> {
  const params = new Map<string, string>();
  const qIndex = raw.indexOf('?');
  if (qIndex < 0) return params;

  let query = raw.slice(qIndex + 1);
  const hashIndex = query.indexOf('#');
  if (hashIndex >= 0) query = query.slice(0, hashIndex);

  for (const pair of query.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawValue = eq < 0 ? '' : pair.slice(eq + 1);
    try {
      params.set(
        decodeURIComponent(rawKey),
        decodeURIComponent(rawValue.replace(/\+/g, ' ')),
      );
    } catch {
      // Malformed percent-encoding — keep the raw token rather than throwing, so
      // a single bad field doesn't sink an otherwise valid `did`.
      params.set(rawKey, rawValue);
    }
  }
  return params;
}

/**
 * Parse a scanned / deep-linked DNI payload (`oxydni://card?did=…`) into the
 * referenced DID. Pure + dependency-free (Hermes-safe, no `URL` global) so
 * Commons (and any scanner) can reuse it without an OxyServices instance.
 *
 * @param raw - The raw scanned string or deep-link URL.
 * @returns `{ did }` when a usable DID is present; `null` for anything else (a
 *   non-DNI scheme, a missing/empty `did`, or non-string input).
 */
export function parseDniPayload(raw: string): DniCardRef | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const value = raw.trim();
  if (!DNI_MATCHER.test(value)) {
    return null;
  }
  const did = parseDniQuery(value).get('did');
  if (!did || did.length === 0) {
    return null;
  }
  return { did };
}

/**
 * Verify the Oxy custodial attestation on a public card.
 *
 * Re-canonicalizes the received `card` (so the order of the JSON keys on the
 * wire is irrelevant; `canonicalize` also omits any `undefined`-valued optional
 * key, matching the server which omits absent keys entirely) and checks the
 * `ES256K-DER-SHA256` signature against `attestation.publicKey`.
 *
 * NEVER throws: `SignatureService.verify` already swallows malformed-input
 * errors and returns `false`, and an absent attestation short-circuits to
 * `false`. A pure, reusable helper (Commons can call it on a cached card).
 *
 * @param card - The card to verify (exactly as received).
 * @param attestation - The card's attestation, or `null` (unsigned ⇒ `false`).
 */
export async function verifyPublicCardAttestation(
  card: PublicCard,
  attestation: ExportAttestation | null,
): Promise<boolean> {
  if (!attestation) {
    return false;
  }
  const { signature, publicKey } = attestation;
  if (!signature || !publicKey) {
    return false;
  }
  return SignatureService.verify(canonicalize(card), signature, publicKey);
}

export function OxyServicesCivicMixin<T extends typeof OxyServicesBase>(Base: T) {
  return class extends Base {
    constructor(...args: any[]) {
      super(...(args as [any]));
    }

    /**
     * Fetch a user's signed public DNI card and verify the Oxy attestation
     * client-side. Public (no auth required); short-TTL cached.
     *
     * Resolves to `{ card, attestation, verified }`. A bad/absent signature does
     * NOT reject — it yields `verified: false` so the UI can warn. Only a
     * transport failure (the fetch itself) rejects.
     *
     * @param userId - The subject account's Mongo `_id`. URL-encoded into the path.
     */
    async getPublicCard(userId: string): Promise<CivicCardResult> {
      try {
        const signed = await this.makeRequest<SignedPublicCard>(
          'GET',
          `/civic/${encodeURIComponent(userId)}/card`,
          undefined,
          { cache: true, cacheTTL: CACHE_TIMES.SHORT },
        );
        const verified = await verifyPublicCardAttestation(signed.card, signed.attestation);
        return { card: signed.card, attestation: signed.attestation, verified };
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Build the DNI QR payload for the current user: `oxydni://card?did=<did>&v=1`,
     * where `<did>` is the user's Oxy DID (`did:web:oxy.so:u:<userId>`). The QR
     * encodes ONLY the DID (anti-spoof — no trust data); a scanner resolves the
     * signed card via {@link getPublicCard}. Round-trips through
     * {@link parseDniPayload}.
     *
     * Throws if no user is authenticated (no DID to derive).
     */
    getMyDniPayload(): string {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('No authenticated user — cannot build a DNI payload.');
      }
      return `oxydni://card?did=${buildUserDid(userId)}&v=1`;
    }
  };
}
