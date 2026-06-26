/**
 * Signed Record Service (self-sovereign identity layer — B5; F0.2 hash chain)
 *
 * Verifies and persists the signed-record envelopes a user publishes about their
 * own identity/profile/civic facts. The signing scheme is shared byte-for-byte
 * with the client (the Commons vault) via the canonical-JSON serializer imported
 * from `@oxyhq/core` — both sides canonicalize every envelope field EXCEPT
 * `publicKey` and `signature`, then sign/verify a secp256k1 DER signature over
 * the SHA-256 of those bytes (`alg: ES256K-DER-SHA256`).
 *
 * Verification asserts the following before a record is stored as `verified`:
 *  1. envelope shape (against `signedRecordEnvelopeSchema`),
 *  2. the signature is valid for the canonical signing input,
 *  3. `publicKey` is a CURRENT verification method of the subject account
 *     (its primary key or an `identity` auth-method key),
 *  4. `issuedAt` is fresh (not in the future beyond clock skew) and strictly
 *     monotonic vs. the latest stored record of the same type (replay/rollback
 *     defence),
 *  5. **v2 only** — chain continuity against the subject's {@link RepoHead}:
 *     `env.prev === head.headRecordId` and `env.seq === head.seq + 1`, with
 *     genesis (`seq === 0`, `prev === null`) requiring NO existing head.
 *
 * v1 envelopes (every `identity`/`profile` record already in production) skip
 * check 5 entirely and verify byte-identically to before.
 *
 * On success `verifyAndStoreRecord` appends the record AND — for v2 — advances
 * the per-subject hash chain head atomically (insert + head upsert in one
 * transaction, with a session-less fallback for standalone mongod). The unique
 * `{userId, seq}` index on `SignedRecord` is the concurrency backstop: the loser
 * of two concurrent writes at the same `seq` gets a duplicate-key error
 * (surfaced as `chain_conflict`) and re-reads the head.
 */

import mongoose, { ClientSession } from 'mongoose';
import { signedRecordSigningInput, computeRecordId } from '@oxyhq/core';
import { verifySecret } from '@oxyhq/core/server';
import { signedRecordEnvelopeSchema, type SignedRecordEnvelope } from '@oxyhq/contracts';
import SignatureService from './signature.service';
import { buildUserDid, OXY_DID } from './did.service';
import SignedRecord, { type ISignedRecord } from '../models/SignedRecord';
import RepoHead from '../models/RepoHead';
import { logger } from '../utils/logger';

/** Tolerated forward clock skew for a record's `issuedAt` (5 minutes). */
const CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Minimal subject-account shape needed to validate verification methods. */
export interface SignedRecordSubject {
  publicKey?: string | null;
  authMethods?: Array<{ type?: string | null; metadata?: { publicKey?: string | null } | null } | null> | null;
}

/** Reasons an envelope can fail verification (stable, machine-readable). */
export type EnvelopeRejectionReason =
  | 'invalid_envelope'
  | 'subject_mismatch'
  | 'public_key_not_a_current_verification_method'
  | 'bad_signature'
  | 'issued_in_future'
  | 'stale_issued_at'
  // v2 hash-chain (F0.2):
  | 'chain_gap'
  | 'chain_fork'
  | 'bad_seq'
  | 'chain_conflict'
  // custodial issuer (F1):
  | 'untrusted_issuer';

export type EnvelopeVerification =
  | { ok: true }
  | { ok: false; reason: EnvelopeRejectionReason };

/**
 * Run a unit of work inside a Mongo transaction, falling back to a session-less
 * execution when the deployment does not support transactions (e.g. a standalone
 * mongod in local dev). Production runs a single-node replica set, so the
 * transactional path is the norm. Mirrors `reputation.service.ts`.
 */
async function withTransaction<T>(
  work: (session: ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const transactionsUnsupported =
      message.includes('Transaction numbers are only allowed') ||
      message.includes('replica set') ||
      message.includes('does not support transactions');
    if (transactionsUnsupported) {
      logger.warn(
        'SignedRecord: transactions unsupported by this MongoDB deployment; executing without a transaction',
        { component: 'signedRecord.service' },
      );
      return work(undefined);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

/** True when an error is a MongoDB duplicate-key (E11000) error. */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * True when `signature` is a valid secp256k1 signature of the canonical input.
 *
 * The signing input is computed by `signedRecordSigningInput` from
 * `@oxyhq/core` — the SINGLE shared definition of what the signature covers. For
 * v2 it includes the chain fields (`seq`/`prev`/`collection`/`rkey`); for v1 it
 * does not. The client (Commons vault) signs with the same function, so a record
 * signed by a client and verified here cannot drift.
 */
export function verifyEnvelopeSignature(env: SignedRecordEnvelope): boolean {
  return SignatureService.verifySignature(signedRecordSigningInput(env), env.signature, env.publicKey);
}

/** True when `publicKey` is the subject's primary key or an `identity` auth-method key. */
export function isCurrentVerificationMethod(subject: SignedRecordSubject, publicKey: string): boolean {
  if (subject.publicKey && subject.publicKey === publicKey) {
    return true;
  }
  return (subject.authMethods ?? []).some(
    (method) => method?.type === 'identity' && method.metadata?.publicKey === publicKey,
  );
}

/**
 * True when `publicKey` is the configured Oxy custodial signing key
 * (`OXY_PUBLIC_KEY`) — the verification method of `OXY_DID`. Constant-time
 * compare via `verifySecret`. Returns false when the key is unconfigured, so a
 * custodial record can never verify in an environment with no Oxy key.
 *
 * Note: this is NOT a trust shortcut — the signature is still checked against
 * `env.publicKey`, so only the holder of `OXY_PRIVATE_KEY` (the server) can
 * produce a record that passes BOTH this check and {@link verifyEnvelopeSignature}.
 */
export function isOxyCustodialKey(publicKey: string): boolean {
  const oxyPublicKey = process.env.OXY_PUBLIC_KEY;
  if (!oxyPublicKey) {
    return false;
  }
  return verifySecret(publicKey, oxyPublicKey);
}

/**
 * Build and sign a record envelope with a secp256k1 private key. Used by tests
 * to forge a valid client signature and (server-side) for custodial provenance
 * attestations. The returned envelope verifies against {@link verifyEnvelopeSignature}.
 */
export function signRecordEnvelope(
  fields: Omit<SignedRecordEnvelope, 'signature'>,
  privateKeyHex: string,
): SignedRecordEnvelope {
  const signature = SignatureService.signMessage(signedRecordSigningInput(fields), privateKeyHex);
  return { ...fields, signature };
}

/**
 * v2-only chain-continuity check. Loads the subject's {@link RepoHead} and
 * asserts the record extends the head by exactly one (or is a valid genesis).
 *
 *  - No head yet → only a genesis (`seq === 0`, `prev === null`) is accepted;
 *    anything else is a `chain_gap` (it claims to extend a chain that does not
 *    exist).
 *  - Head exists → `env.prev` MUST equal `head.headRecordId` (else `chain_fork`,
 *    which also covers a re-genesis attempt whose `prev` is `null`), and
 *    `env.seq` MUST equal `head.seq + 1` (else `bad_seq`).
 */
async function verifyChainContinuity(env: SignedRecordEnvelope, subjectUserId: string): Promise<EnvelopeVerification> {
  const head = await RepoHead.findOne({ userId: subjectUserId }).lean();
  const isGenesis = env.seq === 0 && (env.prev === null || env.prev === undefined);

  if (!head) {
    if (!isGenesis) {
      return { ok: false, reason: 'chain_gap' };
    }
    return { ok: true };
  }

  if (env.prev !== head.headRecordId) {
    return { ok: false, reason: 'chain_fork' };
  }
  if (env.seq !== head.seq + 1) {
    return { ok: false, reason: 'bad_seq' };
  }
  return { ok: true };
}

/**
 * Full verification of an envelope for a given subject account. Performs the
 * shape, signature, current-verification-method, freshness, monotonicity, and —
 * for v2 — chain-continuity checks. The monotonic check queries the latest
 * stored record of the same type; the chain check queries {@link RepoHead}.
 */
export async function verifyEnvelope(
  env: SignedRecordEnvelope,
  subject: SignedRecordSubject,
  subjectUserId: string,
): Promise<EnvelopeVerification> {
  const parsed = signedRecordEnvelopeSchema.safeParse(env);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_envelope' };
  }

  if (env.subject !== buildUserDid(subjectUserId)) {
    return { ok: false, reason: 'subject_mismatch' };
  }

  // The signer is determined by the issuer:
  //  - Self-issued (`issuer === subject`): the signer MUST be a current
  //    verification method of the SUBJECT account (the user's own key).
  //  - Oxy-custodial (`issuer === OXY_DID`): an Oxy provenance attestation ABOUT
  //    the subject (e.g. a `reputation_attestation`) — the signer is Oxy, so the
  //    `publicKey` MUST be the Oxy custodial key. The record still lives on the
  //    SUBJECT's chain. (A user cannot forge one: they lack `OXY_PRIVATE_KEY`, so
  //    the signature check below rejects any issuer=OXY record they submit.)
  //  - Any other issuer is not trusted yet.
  if (env.issuer === env.subject) {
    if (!isCurrentVerificationMethod(subject, env.publicKey)) {
      return { ok: false, reason: 'public_key_not_a_current_verification_method' };
    }
  } else if (env.issuer === OXY_DID) {
    if (!isOxyCustodialKey(env.publicKey)) {
      return { ok: false, reason: 'public_key_not_a_current_verification_method' };
    }
  } else {
    return { ok: false, reason: 'untrusted_issuer' };
  }

  if (!verifyEnvelopeSignature(env)) {
    return { ok: false, reason: 'bad_signature' };
  }

  if (env.issuedAt > Date.now() + CLOCK_SKEW_MS) {
    return { ok: false, reason: 'issued_in_future' };
  }

  // Monotonicity (replay/rollback defence) is scoped to the LOGICAL record:
  //  - v1 (identity/profile singletons): per `type` — a newer record supersedes
  //    the latest of the same type. UNCHANGED.
  //  - v2: per record KEY (`nsid`, `rkey`) — last-writer-wins for THAT key.
  //    Distinct keys (e.g. one `reputation_attestation` per txn) are independent
  //    appends and must not constrain each other's `issuedAt`.
  const monotonicFilter =
    env.version === 2
      ? { userId: subjectUserId, nsid: env.collection, rkey: env.rkey }
      : { userId: subjectUserId, type: env.type };
  const latest = await SignedRecord.findOne(monotonicFilter).sort({ createdAt: -1 }).lean();
  const latestIssuedAt = latest?.envelope?.issuedAt;
  if (typeof latestIssuedAt === 'number' && env.issuedAt <= latestIssuedAt) {
    return { ok: false, reason: 'stale_issued_at' };
  }

  if (env.version === 2) {
    return verifyChainContinuity(env, subjectUserId);
  }

  return { ok: true };
}

/**
 * Verify an envelope and append it to the ledger as `verified: true`. Returns
 * the verification verdict (so the route maps a rejection to a 4xx) rather than
 * throwing on a bad envelope. On success the stored {@link ISignedRecord} is
 * returned.
 *
 * v1: a single append. v2: the append AND the per-subject hash-chain head
 * advance happen atomically (one transaction, session-less fallback). A
 * duplicate-key error from the unique `{userId, seq}` (or `recordId`) index — a
 * concurrent write that already took this `seq` — is surfaced as `chain_conflict`
 * so the caller re-reads the head and retries.
 */
export async function verifyAndStoreRecord(
  env: SignedRecordEnvelope,
  subject: SignedRecordSubject,
  subjectUserId: string,
): Promise<{ ok: true; record: ISignedRecord } | { ok: false; reason: EnvelopeRejectionReason }> {
  const verification = await verifyEnvelope(env, subject, subjectUserId);
  if (!verification.ok) {
    return verification;
  }

  if (env.version === 2) {
    const recordId = await computeRecordId(env);
    try {
      return await withTransaction(async (session) => {
        const opts = session ? { session } : {};
        const [record] = await SignedRecord.create(
          [
            {
              subjectDid: env.subject,
              userId: subjectUserId,
              type: env.type,
              envelope: env,
              publicKey: env.publicKey,
              verified: true,
              seq: env.seq,
              prev: env.prev ?? null,
              recordId,
              // Denormalize the envelope's `collection` to the `nsid` column.
              nsid: env.collection,
              rkey: env.rkey,
            },
          ],
          opts,
        );

        await RepoHead.findOneAndUpdate(
          { userId: subjectUserId },
          {
            $set: { subjectDid: env.subject, seq: env.seq, headRecordId: recordId },
            $inc: { recordCount: 1 },
            $setOnInsert: { userId: subjectUserId },
          },
          { upsert: true, new: true, ...opts },
        );

        return { ok: true as const, record };
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return { ok: false, reason: 'chain_conflict' };
      }
      throw error;
    }
  }

  const record = await SignedRecord.create({
    subjectDid: env.subject,
    userId: subjectUserId,
    type: env.type,
    envelope: env,
    publicKey: env.publicKey,
    verified: true,
  });

  return { ok: true, record };
}

/** Latest stored record of `type` for a user, or null. */
export async function getLatestRecord(userId: string, type: 'identity' | 'profile'): Promise<ISignedRecord | null> {
  return SignedRecord.findOne({ userId, type }).sort({ createdAt: -1 }).lean<ISignedRecord | null>();
}
