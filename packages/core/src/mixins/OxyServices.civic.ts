/**
 * Civic Methods Mixin (Commons "DNI" — Fase 1; anti-gaming — Fase 2)
 *
 * Provides typed access to the public, verifiable citizen-identity ("DNI") card
 * a Commons user shows and others scan, plus the Fase 2 anti-gaming surfaces
 * (real-life counterparty attestation + the validator/jury flow):
 *
 *  - {@link OxyServicesCivicMixin.getPublicCard} fetches a user's signed card
 *    (`GET /civic/:userId/card`) and verifies the Oxy custodial attestation
 *    CLIENT-SIDE, so a scanner can trust the card OFFLINE (e.g. a cached card
 *    replayed without network) instead of re-trusting the transport.
 *  - {@link OxyServicesCivicMixin.getMyDniPayload} builds the QR payload the user
 *    displays. The QR encodes ONLY the DID (`oxydni://card?did=…&v=1`) — never
 *    trust data — so the card cannot be spoofed by crafting a QR; the scanner
 *    resolves the signed card server-side and re-verifies it.
 *  - {@link OxyServicesCivicMixin.buildAttestQrPayload} builds the high-value
 *    real-life-attestation QR the person BEING attested (A) shows; the SCANNER
 *    (B) parses it with {@link parseAttestPayload} and signs a self-issued
 *    counterparty attestation via
 *    {@link OxyServicesCivicMixin.submitRealLifeAttestation}.
 *  - {@link OxyServicesCivicMixin.getValidatorInbox} /
 *    {@link OxyServicesCivicMixin.submitValidationVote} /
 *    {@link OxyServicesCivicMixin.denyValidation} drive a randomly-selected
 *    juror's medium-weight peer-validation duties.
 *
 * The wire shapes (`PublicCard`, `SignedPublicCard`, `ExportAttestation`,
 * `RealLifeAttestationResult`, `ValidationRequestSummary`, `ValidationVoteResult`,
 * `SignedRecordEnvelope`) come from `@oxyhq/contracts` — the single source of
 * truth the API validates its output against — so producer and consumer cannot
 * drift. The public DNI card's attestation is an `ES256K-DER-SHA256` signature
 * over `canonicalize(card)` (the exact bytes the server signed, with ONLY the
 * present keys), so a consumer re-canonicalizes the `card` it received and checks
 * the signature against `attestation.publicKey`.
 *
 * Card verification NEVER throws on a bad/absent signature — it returns
 * `verified: false` so the UI can render a forged/unsigned card as visibly
 * untrusted rather than silently trusting it. A transport/network failure (the
 * fetch itself) still rejects, as everywhere else in the SDK.
 *
 * The Fase 2 writes (`submitRealLifeAttestation`, `submitValidationVote`) sign a
 * v2 self-issued signed-record envelope with the on-device identity key (so they
 * are NATIVE-ONLY — they throw on web, where `KeyManager` has no key) on the
 * caller's own per-subject hash chain: each fetches the caller's chain head
 * (`GET /identity/records/:userId/chain/head`) to set `seq`/`prev` before signing
 * with {@link SignatureService.signRecordV2}.
 *
 * Reading a public card and building/parsing the QR payloads are
 * platform-agnostic; deriving the current user's DID requires an authenticated
 * session.
 */
import type {
  ExportAttestation,
  PublicCard,
  RealLifeAttestationResult,
  SignedPublicCard,
  SignedRecordEnvelope,
  SignedRecordType,
  ValidationRequestSummary,
  ValidationVerdict,
  ValidationVoteResult,
} from '@oxyhq/contracts';
import type { OxyServicesBase } from '../OxyServices.base';
import { canonicalize } from '../crypto/canonicalJson';
import { SignatureService } from '../crypto/signatureService';
import { buildUserDid } from './OxyServices.identity';
import { CACHE_TIMES } from './mixinHelpers';

/**
 * Validity window of a real-life-attestation QR (`oxydni://attest?…exp=…`),
 * matching the server's `REAL_LIFE_NONCE_MAX_AGE_MS` ceiling: the QR must be
 * scanned and submitted within this window. The server is authoritative on
 * freshness; this is the client-issued `exp`.
 */
const ATTEST_QR_TTL_MS = 10 * 60 * 1000;

/** AtProto-style collection for a real-life counterparty attestation record. */
const ATTEST_COLLECTION = 'app.oxy.attestation';

/** AtProto-style collection for a validator's signed verdict record. */
const VALIDATION_COLLECTION = 'app.oxy.validation';

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

/** URI scheme/host that introduces a real-life counterparty attestation payload. */
const ATTEST_MATCHER = /^oxydni:\/\/attest(?:[/?#]|$)/i;

/**
 * Minimal, allocation-light query-string parser (no `URL` / `URLSearchParams`)
 * so it runs identically under Hermes and jsdom — mirrors the robustness of the
 * "Sign in with Oxy" approval-link parser. Shared by every `oxydni://…` payload
 * parser in this module.
 */
function parseOxydniQuery(raw: string): Map<string, string> {
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
      // a single bad field doesn't sink an otherwise valid payload.
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
  const did = parseOxydniQuery(value).get('did');
  if (!did || did.length === 0) {
    return null;
  }
  return { did };
}

/**
 * The fields decoded from a scanned real-life-attestation QR
 * (`oxydni://attest?subject=…&ctx=…&nonce=…&exp=…`). The SCANNER feeds these to
 * {@link OxyServicesCivicMixin.submitRealLifeAttestation}.
 */
export interface ParsedAttestPayload {
  /** The DID of the person being attested (A) — becomes the record's `about`. */
  subjectDid: string;
  /** Opaque interaction id (`ctx`); `''` when the QR omitted it. */
  context: string;
  /** Single-use replay-guard nonce. */
  nonce: string;
  /** Nonce expiry (epoch ms); the server re-checks freshness authoritatively. */
  exp: number;
}

/**
 * The QR a person shows to be attested in real life, plus the fresh nonce/exp it
 * embeds so the displaying app can track which scan completed it.
 */
export interface AttestQrPayload {
  /** The `oxydni://attest?subject=…&ctx=…&nonce=…&exp=…` string to encode as a QR. */
  payload: string;
  /** The single-use nonce embedded in the payload. */
  nonce: string;
  /** The nonce expiry embedded in the payload (epoch ms). */
  exp: number;
}

/**
 * Parse a scanned / deep-linked real-life-attestation payload
 * (`oxydni://attest?subject=…&ctx=…&nonce=…&exp=…`). Pure + dependency-free
 * (Hermes-safe, no `URL` global), mirroring {@link parseDniPayload}, so Commons
 * (and any scanner) can reuse it without an OxyServices instance.
 *
 * @param raw - The raw scanned string or deep-link URL.
 * @returns `{ subjectDid, context, nonce, exp }` when the required fields are
 *   present and `exp` is a positive finite number; `null` otherwise (a non-attest
 *   scheme, a missing `subject`/`nonce`/`exp`, an unparseable `exp`, or non-string
 *   input). `context` defaults to `''` when the QR omits `ctx`.
 */
export function parseAttestPayload(raw: string): ParsedAttestPayload | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }
  const value = raw.trim();
  if (!ATTEST_MATCHER.test(value)) {
    return null;
  }
  const params = parseOxydniQuery(value);
  const subjectDid = params.get('subject');
  const nonce = params.get('nonce');
  const expRaw = params.get('exp');
  if (!subjectDid || !nonce || expRaw === undefined || expRaw.length === 0) {
    return null;
  }
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= 0) {
    return null;
  }
  return { subjectDid, context: params.get('ctx') ?? '', nonce, exp };
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

/**
 * Input for {@link OxyServicesCivicMixin.submitRealLifeAttestation} — the fields
 * the SCANNER (B) carries over from a parsed {@link ParsedAttestPayload}, plus
 * the optional co-location / biometric support signals B contributes.
 */
export interface SubmitRealLifeAttestationInput {
  /** The DID of the person being attested (A); becomes the record's `about`. */
  subjectDid: string;
  /** Opaque interaction id from the QR. */
  context: string;
  /** Single-use nonce from the QR (also the record's `rkey`). */
  nonce: string;
  /** Nonce expiry from the QR (epoch ms). */
  exp: number;
  /** Coarse co-location proof (optional). */
  geohash?: string;
  /** Whether B's device biometric gate fired before signing (optional). */
  biometricOk?: boolean;
}

/** Result of {@link OxyServicesCivicMixin.denyValidation}. */
export interface DenyValidationResult {
  denied: boolean;
}

/**
 * The current chain head as returned by `GET /identity/records/:userId/chain/head`.
 * `headRecordId` is `null` and `seq` is `-1` when the subject has no chain yet,
 * so the next record's coordinates are always `seq: head.seq + 1` (genesis = 0)
 * and `prev: head.headRecordId` (genesis = null).
 */
interface ChainHeadResponse {
  headRecordId: string | null;
  seq: number;
  recordCount: number;
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

    // =========================================================================
    // FASE 2 — real-life counterparty attestation (HIGH weight)
    // =========================================================================

    /**
     * Build the real-life-attestation QR the current user (A) shows to be
     * attested by a counterparty (B):
     * `oxydni://attest?subject=<A.did>&ctx=<context>&nonce=<fresh>&exp=<now+10m>`.
     *
     * A fresh crypto-random nonce is minted per call (single-use replay guard);
     * `exp` is `now + 10min` (matching the server ceiling — scan promptly). The
     * QR carries NO trust data; B re-signs and the server is authoritative. The
     * returned `nonce`/`exp` let the displaying screen track which scan completed.
     *
     * Async because a crypto-secure nonce requires the platform RNG (async on
     * native via expo-crypto). Throws if no user is authenticated.
     *
     * @param input.context - An opaque interaction id describing the encounter.
     */
    async buildAttestQrPayload(input: { context: string }): Promise<AttestQrPayload> {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('No authenticated user — cannot build an attestation QR.');
      }
      const subject = buildUserDid(userId);
      const nonce = await SignatureService.generateChallenge();
      const exp = Date.now() + ATTEST_QR_TTL_MS;
      const payload =
        `oxydni://attest?subject=${subject}` +
        `&ctx=${encodeURIComponent(input.context)}` +
        `&nonce=${nonce}&exp=${exp}`;
      return { payload, nonce, exp };
    }

    /**
     * Submit a real-life counterparty attestation as the SCANNER (B): sign a
     * self-issued `real_life_attestation` v2 record on B's own chain
     * (`subject === issuer === B.did`), referencing A via `record.about`, then
     * `POST /civic/attestations`. The server enforces nonce single-use,
     * freshness, graph-exclusion (B is not A's puppet), and the per-pair
     * cooldown, then awards A the HIGH-weight points.
     *
     * NATIVE-ONLY (signs with the on-device key; throws on web / when no
     * identity or no authenticated user). The record is keyed
     * `collection: 'app.oxy.attestation'`, `rkey: <nonce>`.
     *
     * @param input - The parsed QR fields ({@link ParsedAttestPayload}) plus B's
     *   optional `geohash` / `biometricOk` support signals.
     */
    async submitRealLifeAttestation(
      input: SubmitRealLifeAttestationInput,
    ): Promise<RealLifeAttestationResult> {
      try {
        const envelope = await this._signMyCivicRecordV2(
          'real_life_attestation',
          {
            about: input.subjectDid,
            context: input.context,
            nonce: input.nonce,
            exp: input.exp,
            ...(input.geohash !== undefined ? { geohash: input.geohash } : {}),
            ...(input.biometricOk !== undefined ? { biometricOk: input.biometricOk } : {}),
          },
          ATTEST_COLLECTION,
          input.nonce,
        );
        return await this.makeRequest<RealLifeAttestationResult>(
          'POST',
          '/civic/attestations',
          envelope,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    // =========================================================================
    // FASE 2 — validator / jury (MEDIUM weight)
    // =========================================================================

    /**
     * List the current user's pending jury duties (`GET /civic/validations/inbox`).
     * Auth required; never cached (the inbox is a live queue). Returns `[]` when
     * the caller is on no juries.
     */
    async getValidatorInbox(): Promise<ValidationRequestSummary[]> {
      try {
        const res = await this.makeRequest<{ requests?: ValidationRequestSummary[] }>(
          'GET',
          '/civic/validations/inbox',
          undefined,
          { cache: false },
        );
        return res.requests ?? [];
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Cast a SIGNED verdict on a validation request as a selected juror: sign a
     * self-issued `validation_verdict` v2 record on the juror's own chain bound
     * to `requestId` + `payloadHash` (so a verdict cannot be replayed onto a
     * different request or an altered payload), then
     * `POST /civic/validations/:id/vote`.
     *
     * NATIVE-ONLY (signs with the on-device key; throws on web / when no
     * identity or no authenticated user). The record is keyed
     * `collection: 'app.oxy.validation'`, `rkey: <requestId>`.
     *
     * @param requestId - The validation request being voted on.
     * @param payloadHash - The request's canonical payload hash (from the inbox);
     *   the server rejects a vote whose hash does not match the stored request.
     * @param verdict - `'valid'` | `'invalid'` | `'abstain'`.
     */
    async submitValidationVote(
      requestId: string,
      payloadHash: string,
      verdict: ValidationVerdict,
    ): Promise<ValidationVoteResult> {
      try {
        const envelope = await this._signMyCivicRecordV2(
          'validation_verdict',
          { requestId, payloadHash, verdict },
          VALIDATION_COLLECTION,
          requestId,
        );
        return await this.makeRequest<ValidationVoteResult>(
          'POST',
          `/civic/validations/${encodeURIComponent(requestId)}/vote`,
          envelope,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Recuse from a validation request (`POST /civic/validations/:id/deny`): the
     * juror is removed from the jury and the request is re-tallied. Auth
     * required; no signed record (recusal is not an attestation).
     *
     * @param requestId - The validation request to recuse from.
     */
    async denyValidation(requestId: string): Promise<DenyValidationResult> {
      try {
        return await this.makeRequest<DenyValidationResult>(
          'POST',
          `/civic/validations/${encodeURIComponent(requestId)}/deny`,
          undefined,
          { cache: false },
        );
      } catch (error) {
        throw this.handleError(error);
      }
    }

    /**
     * Sign a self-issued v2 signed-record envelope on the CURRENT user's own
     * per-subject hash chain. Fetches the caller's chain head fresh (uncached, so
     * `seq`/`prev` are never stale → no `bad_seq`/`chain_fork`) and signs with
     * {@link SignatureService.signRecordV2}.
     *
     * NATIVE-ONLY (the private key lives in native secure storage). Internal
     * helper (leading underscore); public rather than `private` because mixins
     * compose into an exported anonymous class where TypeScript cannot represent a
     * private member in the emitted declaration file (TS4094).
     *
     * @param type - The signed-record category.
     * @param record - The record payload (canonicalized into the signed bytes).
     * @param collection - The AtProto-style collection namespace.
     * @param rkey - The AtProto-style record key within the collection.
     */
    async _signMyCivicRecordV2(
      type: SignedRecordType,
      record: Record<string, unknown>,
      collection: string,
      rkey: string,
    ): Promise<SignedRecordEnvelope> {
      const userId = this.getCurrentUserId();
      if (!userId) {
        throw new Error('No authenticated user — cannot sign a civic record.');
      }
      const subject = buildUserDid(userId);
      const head = await this.makeRequest<ChainHeadResponse>(
        'GET',
        `/identity/records/${encodeURIComponent(userId)}/chain/head`,
        undefined,
        { cache: false },
      );
      return SignatureService.signRecordV2(type, subject, record, {
        seq: head.seq + 1,
        prev: head.headRecordId,
        collection,
        rkey,
      });
    }
  };
}
