/**
 * Chain engine types — the per-subject hash-chain vocabulary.
 *
 * A "chain" is a single signer's append-only log of signed-record envelopes
 * ("personal blockchain": one signer, no consensus/mining), ordered by a
 * strictly-increasing `seq` with each record's `prev` pointing at the content
 * address (`recordId`) of the one before it. These types are storage-agnostic:
 * the engine ({@link ./verify}, {@link ./engine}) drives them over an injected
 * {@link ./recordStore.RecordStore}, and any app (Oxy identity/civic/node,
 * Mention posts, …) supplies its own store + resolver.
 *
 * The {@link RejectionReason} union is the SINGLE source of truth for every way
 * an append can fail — it consolidates what used to be three divergent copies
 * (oxy-api's `EnvelopeRejectionReason`, the node store's `AppendOutcome.reason`,
 * and the node verifier's `VerifyRejectionReason`). The exact strings match the
 * ones oxy-api returns today, so API responses are byte-for-byte unchanged.
 */

/**
 * The O(1) head pointer of a subject's chain.
 *
 * `headRecordId` is the content address of the latest record (`null` only on the
 * "no chain yet" wire shape); `seq` is its sequence number; `recordCount` is the
 * total appended so far. A store returns `null` (not a `ChainHead`) when the
 * subject has no chain — the engine treats both `null` and a `headRecordId:null`
 * head as "no chain".
 */
export interface ChainHead {
  headRecordId: string | null;
  seq: number;
  recordCount: number;
}

/**
 * Every way verifying or appending a signed record can be rejected — stable,
 * machine-readable, and the ONE consolidated union across the protocol.
 *
 *  - `invalid_envelope` — the envelope failed the base schema shape.
 *  - `subject_mismatch` — the envelope's `subject` is not who the caller is
 *    authorized to write for (an adapter-policy binding, surfaced here so a
 *    store/adapter can report it on the same channel).
 *  - `public_key_not_a_current_verification_method` — the issuer is recognized
 *    (self or custodial) but the signing key is not its current key.
 *  - `bad_signature` — the signature does not verify against the embedded key.
 *  - `issued_in_future` — `issuedAt` is beyond the tolerated clock skew.
 *  - `stale_issued_at` — `issuedAt` is not strictly newer than the latest record
 *    for the same logical key (replay/rollback defence).
 *  - `chain_gap` — a non-genesis record claims to extend a chain that has no head.
 *  - `chain_fork` — `prev` does not match the current head (or a re-genesis).
 *  - `bad_seq` — `seq` is not exactly `head.seq + 1`.
 *  - `chain_conflict` — a concurrent writer already took this `seq` (the store's
 *    unique-index backstop, surfaced from a duplicate-key error).
 *  - `untrusted_issuer` — the `issuer` is neither the subject nor a recognized
 *    custodial issuer.
 */
export type RejectionReason =
  | 'invalid_envelope'
  | 'subject_mismatch'
  | 'public_key_not_a_current_verification_method'
  | 'bad_signature'
  | 'issued_in_future'
  | 'stale_issued_at'
  | 'chain_gap'
  | 'chain_fork'
  | 'bad_seq'
  | 'chain_conflict'
  | 'untrusted_issuer';

/** Verdict of verifying an envelope WITHOUT persisting it. */
export type VerifyOutcome = { ok: true } | { ok: false; reason: RejectionReason };

/**
 * Outcome of appending a verified envelope to a chain.
 *
 * On success it carries the record's content address (`recordId`) and its chain
 * `seq` (`-1` for an unchained v1 record, which has no sequence). On failure it
 * carries the {@link RejectionReason} (a continuity violation or the store's
 * `chain_conflict` backstop).
 */
export type AppendOutcome =
  | { ok: true; recordId: string; seq: number }
  | { ok: false; reason: RejectionReason };

/** The `seq` reported for a v1 (unchained) append — it has no sequence. */
export const UNCHAINED_SEQ = -1;
