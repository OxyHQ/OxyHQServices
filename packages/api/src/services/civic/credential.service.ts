/**
 * Verifiable Credential Service (civic / Commons — Fase 4).
 *
 * A Verifiable Credential (VC) is an ISSUER (an employer / course / app that
 * holds a DID) cryptographically attesting a CLAIM about a HOLDER — e.g. "worked
 * at X 2020–2024", "completed course Y". The credential is a SIGNED record
 * (envelope `type: 'credential'`, already in the `SignedRecordType` union) whose
 * `record.about` is the HOLDER's DID (the W3C `credentialSubject`). It is
 * verifiable OFFLINE against the issuer DID's CURRENT verification method plus a
 * revocation/expiry check — anyone the holder shows the credential to can verify
 * it without trusting Oxy beyond resolving the issuer's DID document.
 *
 * Two issuance modes share one wire shape (`record.about` is ALWAYS the holder):
 *
 *  1. USER-ISSUED ({@link issueCredential}) — the issuer signs with their OWN
 *     key; the envelope is SELF-ISSUED (`subject === issuer === issuerDid`) and
 *     lands on the issuer's per-subject hash chain. This mirrors
 *     `real_life_attestation` / `personhood_vouch` exactly and reuses
 *     `verifyAndStoreRecord` UNCHANGED.
 *
 *  2. APP/ORG-ISSUED ({@link issueOrgCredential}, internal seam) — the Oxy
 *     CUSTODIAL key signs on behalf of an Application DID (`issuer === OXY_DID`,
 *     `subject === holderDid`) and lands on the HOLDER's chain. This mirrors
 *     `reputation_attestation` (see `attestation.service.ts`): the server reads
 *     the holder's chain head + retries the multi-writer race. A user cannot
 *     forge one (they lack `OXY_PRIVATE_KEY`).
 *
 * The {@link VerifiableCredential} model is a queryable projection; the signed
 * envelope on the {@link SignedRecord} ledger is the authoritative proof.
 * Verification ALWAYS recomputes the canonical signing input from the stored
 * envelope — never from the projection's denormalized claims.
 */

import type { SignedRecordEnvelope, VerifiableCredentialResponse, CredentialStatus } from '@oxyhq/contracts';
import { credentialRecordSchema } from '@oxyhq/contracts';
import { signedRecordSigningInput } from '@oxyhq/protocol';
import SignatureService from '../signature.service';
import {
  buildUserDid,
  parseUserDid,
  buildDidDocument,
  buildOxyDidDocument,
  OXY_DID,
  type DidUserInput,
} from '../did.service';
import {
  verifyEnvelopeSignature,
  verifyAndStoreRecord,
  type SignedRecordSubject,
  type EnvelopeRejectionReason,
} from '../signedRecord.service';
import { getHead } from '../repoLog.service';
import { User } from '../../models/User';
import SignedRecord from '../../models/SignedRecord';
import VerifiableCredential, { type IVerifiableCredential } from '../../models/VerifiableCredential';
import { isValidObjectId } from '../../utils/validation';
import { CREDENTIAL_COLLECTION, CREDENTIAL_BASE_TYPE } from '../../utils/civic.constants';
import { logger } from '../../utils/logger';

const ALG = 'ES256K-DER-SHA256' as const;

/** Retry budget for the org-issued holder-chain head race (rare). */
const MAX_CREDENTIAL_ATTEMPTS = 4;

/** Why a credential issuance can be rejected (stable, machine-readable). */
export type CredentialIssueRejectionReason =
  | 'invalid_type'
  | 'not_self_issued'
  | 'invalid_record'
  | 'missing_base_type'
  | 'invalid_holder'
  | 'self_credential'
  | 'holder_not_found'
  | 'invalid_expiry'
  | 'oxy_key_unconfigured'
  | EnvelopeRejectionReason;

export type CredentialIssueResult =
  | { ok: true; credential: VerifiableCredentialResponse }
  | { ok: false; reason: CredentialIssueRejectionReason };

/** Why a revoke can be rejected. */
export type CredentialRevokeRejectionReason = 'not_found' | 'not_issuer' | 'already_revoked';

export type CredentialRevokeResult =
  | { ok: true; credential: VerifiableCredentialResponse }
  | { ok: false; reason: CredentialRevokeRejectionReason };

/** The verdict of verifying a credential. `credential` is null only when none exists. */
export interface CredentialVerification {
  valid: boolean;
  reason?: string;
  credential: VerifiableCredentialResponse | null;
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
 * The effective status of a credential AT READ TIME: an `active` credential past
 * its `expiresAt` reads as `expired` even if the row has not yet been flipped by
 * the lazy sweep. `revoked` is terminal and never overridden.
 */
function effectiveStatus(vc: Pick<IVerifiableCredential, 'status' | 'expiresAt'>, now: number): CredentialStatus {
  if (vc.status === 'active' && vc.expiresAt && vc.expiresAt.getTime() <= now) {
    return 'expired';
  }
  return vc.status;
}

/** Serialize a stored credential to the public wire shape. */
function serializeCredential(vc: IVerifiableCredential): VerifiableCredentialResponse {
  return {
    id: vc._id.toString(),
    recordId: vc.recordId,
    holderUserId: vc.holderUserId.toString(),
    holderDid: vc.holderDid,
    ...(vc.issuerUserId ? { issuerUserId: vc.issuerUserId.toString() } : {}),
    issuerDid: vc.issuerDid,
    types: vc.types,
    claims: vc.claims,
    status: effectiveStatus(vc, Date.now()),
    issuedAt: vc.issuedAt.getTime(),
    ...(vc.expiresAt ? { expiresAt: vc.expiresAt.getTime() } : {}),
    ...(vc.revokedAt ? { revokedAt: vc.revokedAt.getTime() } : {}),
  };
}

/** Fields needed to insert a credential projection row. */
interface PersistCredentialInput {
  holderUserId: string;
  holderDid: string;
  issuerUserId?: string;
  issuerDid: string;
  types: string[];
  claims: Record<string, unknown>;
  recordId: string;
  issuedAt: number;
  expiresAt?: number;
}

/**
 * Insert the credential projection row, idempotently on `recordId`. If a row for
 * this signed record already exists (a retried write after the SignedRecord was
 * stored), the existing row is returned rather than throwing.
 */
async function persistCredentialRow(input: PersistCredentialInput): Promise<VerifiableCredentialResponse> {
  try {
    const created = await VerifiableCredential.create({
      holderUserId: input.holderUserId,
      holderDid: input.holderDid,
      ...(input.issuerUserId ? { issuerUserId: input.issuerUserId } : {}),
      issuerDid: input.issuerDid,
      types: input.types,
      claims: input.claims,
      recordId: input.recordId,
      status: 'active',
      issuedAt: new Date(input.issuedAt),
      ...(input.expiresAt !== undefined ? { expiresAt: new Date(input.expiresAt) } : {}),
    });
    return serializeCredential(created);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      const existing = await VerifiableCredential.findOne({ recordId: input.recordId }).lean<IVerifiableCredential | null>();
      if (existing) {
        return serializeCredential(existing);
      }
    }
    throw error;
  }
}

/**
 * Issue a USER-signed verifiable credential. The caller (`issuerUserId`) signs a
 * SELF-ISSUED `credential` envelope with their own key (`subject === issuer ===
 * issuerDid`); `record.about` references the HOLDER. The envelope is verified +
 * appended to the issuer's hash chain, then projected into a queryable row.
 *
 * The holder + all claim data are taken from the SIGNED envelope (the source of
 * truth) — never from out-of-band request metadata — so an issuer cannot persist
 * a claim they did not sign.
 */
export async function issueCredential(
  envelope: SignedRecordEnvelope,
  issuerUserId: string,
): Promise<CredentialIssueResult> {
  if (envelope.type !== 'credential') {
    return { ok: false, reason: 'invalid_type' };
  }

  // User-issued: the envelope is self-issued by the caller (their key signs).
  const issuerDid = buildUserDid(issuerUserId);
  if (envelope.subject !== issuerDid || envelope.issuer !== issuerDid) {
    return { ok: false, reason: 'not_self_issued' };
  }

  const parsedRecord = credentialRecordSchema.safeParse(envelope.record);
  if (!parsedRecord.success) {
    return { ok: false, reason: 'invalid_record' };
  }
  const record = parsedRecord.data;

  if (!record.types.includes(CREDENTIAL_BASE_TYPE)) {
    return { ok: false, reason: 'missing_base_type' };
  }

  const holderUserId = parseUserDid(record.about);
  if (!holderUserId || !isValidObjectId(holderUserId)) {
    return { ok: false, reason: 'invalid_holder' };
  }
  if (holderUserId === issuerUserId) {
    return { ok: false, reason: 'self_credential' };
  }

  // An expiry, if present, must be in the future (issuing a dead credential is
  // a no-op and almost always a client bug). It is part of the signed bytes.
  if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
    return { ok: false, reason: 'invalid_expiry' };
  }

  const [holderExists, issuer] = await Promise.all([
    User.exists({ _id: holderUserId }),
    User.findById(issuerUserId).select('publicKey authMethods').lean(),
  ]);
  if (!holderExists) {
    return { ok: false, reason: 'holder_not_found' };
  }
  const issuerSubject: SignedRecordSubject = {
    publicKey: issuer?.publicKey,
    authMethods: issuer?.authMethods,
  };

  // Cheap forgery gate before the authoritative verify-and-store (which repeats
  // signature + current-VM + chain-continuity checks transactionally).
  if (!verifyEnvelopeSignature(envelope)) {
    return { ok: false, reason: 'bad_signature' };
  }

  const stored = await verifyAndStoreRecord(envelope, issuerSubject, issuerUserId);
  if (!stored.ok) {
    return { ok: false, reason: stored.reason };
  }
  const recordId = stored.record.recordId ?? '';

  const credential = await persistCredentialRow({
    holderUserId,
    holderDid: record.about,
    issuerUserId,
    issuerDid,
    types: record.types,
    claims: record.claims,
    recordId,
    issuedAt: envelope.issuedAt,
    expiresAt: record.expiresAt,
  });

  logger.info('Verifiable credential issued (user-signed)', {
    component: 'civic.credential',
    issuerUserId,
    holderUserId,
    recordId,
  });

  return { ok: true, credential };
}

/** Input for the app/org-issued (Oxy-custodial) credential seam. */
export interface IssueOrgCredentialInput {
  /** The holder's DID (`did:web:oxy.so:u:<userId>`). */
  holderDid: string;
  types: string[];
  claims: Record<string, unknown>;
  /** AtProto-style record key — MUST be unique per credential. */
  rkey: string;
  expiresAt?: number;
  /** Optional Application id the Oxy key issues on behalf of (recorded in claims). */
  onBehalfOfApplicationId?: string;
}

/**
 * APP/ORG-ISSUED seam: mint a credential signed by the Oxy CUSTODIAL key on
 * behalf of an Application DID, anchored on the HOLDER's chain (`subject ===
 * holderDid`, `issuer === OXY_DID`). Mirrors `attestation.service.attestAward`:
 * reads the holder's chain head, signs the v2 envelope server-side, retries the
 * multi-writer race, and projects the row. Skipped (returns
 * `oxy_key_unconfigured`) when no Oxy key is configured (dev / pre-prod).
 *
 * This is NOT exposed on the public route — only the server can produce an
 * Oxy-signed envelope. It is the clean seam for verified org/app credentials.
 */
export async function issueOrgCredential(input: IssueOrgCredentialInput): Promise<CredentialIssueResult> {
  const privateKey = process.env.OXY_PRIVATE_KEY;
  const publicKey = process.env.OXY_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    return { ok: false, reason: 'oxy_key_unconfigured' };
  }

  if (!input.types.includes(CREDENTIAL_BASE_TYPE)) {
    return { ok: false, reason: 'missing_base_type' };
  }

  const holderUserId = parseUserDid(input.holderDid);
  if (!holderUserId || !isValidObjectId(holderUserId)) {
    return { ok: false, reason: 'invalid_holder' };
  }
  if (input.expiresAt !== undefined && input.expiresAt <= Date.now()) {
    return { ok: false, reason: 'invalid_expiry' };
  }
  const holderExists = await User.exists({ _id: holderUserId });
  if (!holderExists) {
    return { ok: false, reason: 'holder_not_found' };
  }

  const claims: Record<string, unknown> = input.onBehalfOfApplicationId
    ? { ...input.claims, onBehalfOf: input.onBehalfOfApplicationId }
    : { ...input.claims };

  for (let attempt = 0; attempt < MAX_CREDENTIAL_ATTEMPTS; attempt += 1) {
    const head = await getHead(holderUserId);
    const seq = head ? head.seq + 1 : 0;
    const prev = head ? head.headRecordId : null;

    const record: Record<string, unknown> = {
      about: input.holderDid,
      types: input.types,
      claims,
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    const fields: Omit<SignedRecordEnvelope, 'signature'> = {
      version: 2,
      type: 'credential',
      subject: input.holderDid,
      issuer: OXY_DID,
      record,
      issuedAt: Date.now(),
      seq,
      prev,
      collection: CREDENTIAL_COLLECTION,
      rkey: input.rkey,
      publicKey,
      alg: ALG,
    };
    const signature = SignatureService.signMessage(signedRecordSigningInput(fields), privateKey);
    const envelope: SignedRecordEnvelope = { ...fields, signature };

    // The holder account's VMs are NOT consulted for a custodial record (the
    // issuer is OXY_DID), so an empty subject is sufficient here.
    const stored = await verifyAndStoreRecord(envelope, { publicKey: null, authMethods: [] }, holderUserId);
    if (stored.ok) {
      const recordId = stored.record.recordId ?? '';
      const credential = await persistCredentialRow({
        holderUserId,
        holderDid: input.holderDid,
        issuerDid: OXY_DID,
        types: input.types,
        claims,
        recordId,
        issuedAt: envelope.issuedAt,
        expiresAt: input.expiresAt,
      });
      logger.info('Verifiable credential issued (org/custodial)', {
        component: 'civic.credential',
        holderUserId,
        recordId,
        onBehalfOf: input.onBehalfOfApplicationId,
      });
      return { ok: true, credential };
    }

    // A concurrent writer advanced the holder's chain head — re-read + retry.
    if (stored.reason === 'chain_conflict' || stored.reason === 'bad_seq' || stored.reason === 'chain_fork') {
      continue;
    }
    return { ok: false, reason: stored.reason };
  }

  return { ok: false, reason: 'chain_conflict' };
}

/** List a holder's credentials, newest first, optionally filtered by stored status. */
export async function listCredentialsForHolder(
  holderUserId: string,
  options: { status?: CredentialStatus } = {},
): Promise<VerifiableCredentialResponse[]> {
  const filter: Record<string, unknown> = { holderUserId };
  if (options.status) {
    filter.status = options.status;
  }
  const rows = await VerifiableCredential.find(filter)
    .sort({ issuedAt: -1 })
    .lean<IVerifiableCredential[]>();
  return rows.map(serializeCredential);
}

/**
 * Resolve the issuer DID's CURRENT verification-method public keys. Returns the
 * key list (possibly empty) or `null` when the issuer DID cannot be resolved to
 * a known account. For `OXY_DID` the keys come from the Oxy organisation DID
 * document (the custodial key); for a user DID they come from the account's
 * derived DID document (primary + identity keys, reflecting any rotation).
 */
async function resolveIssuerVmKeys(issuerDid: string): Promise<string[] | null> {
  if (issuerDid === OXY_DID) {
    return buildOxyDidDocument().verificationMethod.map((vm) => vm.publicKeyHex);
  }
  const issuerUserId = parseUserDid(issuerDid);
  if (!issuerUserId || !isValidObjectId(issuerUserId)) {
    return null;
  }
  const issuer = await User.findById(issuerUserId)
    .select('publicKey authMethods username type federation verifiedDomains')
    .lean<DidUserInput | null>();
  if (!issuer) {
    return null;
  }
  return buildDidDocument(issuer).verificationMethod.map((vm) => vm.publicKeyHex);
}

/** Best-effort lazy flip of an expired credential's status (never throws). */
async function markExpired(id: IVerifiableCredential['_id']): Promise<void> {
  try {
    await VerifiableCredential.updateOne({ _id: id, status: 'active' }, { $set: { status: 'expired' } });
  } catch (error) {
    logger.warn('Credential lazy-expire failed (non-fatal)', {
      component: 'civic.credential',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Verify a credential by its signed-record id (preferred) or its credential id.
 *
 * Recomputes the canonical signing input from the STORED envelope and verifies
 * the signature against a CURRENT verification method of the ISSUER DID (so a
 * credential signed with a key the issuer has since rotated away no longer
 * verifies), then checks the credential is neither revoked nor expired. The
 * denormalized projection claims are never trusted — the signed envelope is the
 * source of truth, so any tampering of the signed bytes fails the signature.
 */
export async function verifyCredential(idOrRecordId: string): Promise<CredentialVerification> {
  let vc = await VerifiableCredential.findOne({ recordId: idOrRecordId }).lean<IVerifiableCredential | null>();
  if (!vc && isValidObjectId(idOrRecordId)) {
    vc = await VerifiableCredential.findById(idOrRecordId).lean<IVerifiableCredential | null>();
  }
  if (!vc) {
    return { valid: false, reason: 'not_found', credential: null };
  }

  const signed = await SignedRecord.findOne({ recordId: vc.recordId }).lean<{ envelope: SignedRecordEnvelope } | null>();
  if (!signed?.envelope) {
    return { valid: false, reason: 'record_missing', credential: serializeCredential(vc) };
  }
  const env = signed.envelope;

  const issuerVmKeys = await resolveIssuerVmKeys(env.issuer);
  if (issuerVmKeys === null) {
    return { valid: false, reason: 'issuer_not_found', credential: serializeCredential(vc) };
  }
  if (!issuerVmKeys.includes(env.publicKey)) {
    return { valid: false, reason: 'issuer_key_not_current', credential: serializeCredential(vc) };
  }
  if (!verifyEnvelopeSignature(env)) {
    return { valid: false, reason: 'bad_signature', credential: serializeCredential(vc) };
  }

  // Lazy expiry: flip an active-but-past-expiry row before reporting it.
  const now = Date.now();
  if (vc.status === 'active' && vc.expiresAt && vc.expiresAt.getTime() <= now) {
    await markExpired(vc._id);
    vc = { ...vc, status: 'expired' } as IVerifiableCredential;
  }

  if (vc.status === 'revoked') {
    return { valid: false, reason: 'revoked', credential: serializeCredential(vc) };
  }
  if (effectiveStatus(vc, now) === 'expired') {
    return { valid: false, reason: 'expired', credential: serializeCredential(vc) };
  }

  return { valid: true, credential: serializeCredential(vc) };
}

/**
 * Revoke a credential — only the ORIGINAL user issuer may revoke. Flips the row
 * to `revoked` + stamps `revokedAt`; the append-only signed record is untouched
 * (a future signed revocation record is a documented seam, intentionally not
 * implemented here to keep the flow simple). App/org-issued credentials (no
 * `issuerUserId`) are not revocable via this user path — that is a separate
 * admin concern owned by the org seam.
 */
export async function revokeCredential(id: string, issuerUserId: string): Promise<CredentialRevokeResult> {
  if (!isValidObjectId(id)) {
    return { ok: false, reason: 'not_found' };
  }
  const vc = await VerifiableCredential.findById(id);
  if (!vc) {
    return { ok: false, reason: 'not_found' };
  }
  if (!vc.issuerUserId || vc.issuerUserId.toString() !== issuerUserId) {
    return { ok: false, reason: 'not_issuer' };
  }
  if (vc.status === 'revoked') {
    return { ok: false, reason: 'already_revoked' };
  }

  vc.status = 'revoked';
  vc.revokedAt = new Date();
  await vc.save();

  logger.info('Verifiable credential revoked', {
    component: 'civic.credential',
    issuerUserId,
    credentialId: id,
    recordId: vc.recordId,
  });

  return { ok: true, credential: serializeCredential(vc) };
}
