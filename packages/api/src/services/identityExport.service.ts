/**
 * Identity Export Service (self-sovereign identity layer — B6, "credible exit")
 *
 * Assembles the signed, open-format data-export bundle a user can download to
 * take a portable, verifiable snapshot of their Oxy account: DID document,
 * profile (secrets stripped exactly like `formatUserResponse`), verified
 * domains, auth methods (no secrets), published signed records, per-app data,
 * and social graph — sealed with an Oxy provenance attestation.
 *
 * The attestation is an `ES256K-DER-SHA256` signature over the canonical-JSON of
 * the bundle WITHOUT the attestation, produced with the server-held Oxy key
 * (`OXY_PRIVATE_KEY` / `OXY_PUBLIC_KEY`). When that key is not configured the
 * bundle is still served with `attestation: null` and a warning is logged — the
 * export must never crash on a missing key.
 *
 * Large `appData`/`social` sets are read via a Mongo cursor so the working set
 * is bounded; for very large accounts the route can stream the assembled bundle
 * as NDJSON.
 */

import { canonicalize } from '@oxyhq/protocol';
import type {
  ExportBundle,
  ExportAttestation,
  VerifiedDomain,
  SignedRecordEnvelope,
} from '@oxyhq/contracts';
import { User } from '../models/User';
import SignedRecord from '../models/SignedRecord';
import UserAppData from '../models/UserAppData';
import SignatureService from './signature.service';
import { buildUserDid, buildDidDocument, OXY_DID } from './did.service';
import { buildAuthMethodEntries } from '../utils/authMethodEntries';
import { formatUserResponse } from '../utils/userTransform';
import { logger } from '../utils/logger';

/** Versioned schema id for the export envelope. */
const EXPORT_SCHEMA_URL = 'https://oxy.so/schemas/identity-export/v1';
const ALG = 'ES256K-DER-SHA256' as const;

/** The bundle as assembled BEFORE the attestation is computed/appended. */
export type ExportBundleWithoutAttestation = Omit<ExportBundle, 'attestation' | 'proof'>;

export interface ExportBundleResult {
  /** The bundle. `attestation` is null when the Oxy signing key is unconfigured. */
  bundle: ExportBundleWithoutAttestation & { attestation: ExportAttestation | null };
  attestationMissing: boolean;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * Sign the assembled bundle with the Oxy custodial key. Returns null (and logs)
 * when `OXY_PRIVATE_KEY`/`OXY_PUBLIC_KEY` are not configured.
 */
function signBundle(bundle: ExportBundleWithoutAttestation): ExportAttestation | null {
  const privateKey = process.env.OXY_PRIVATE_KEY;
  const publicKey = process.env.OXY_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    logger.warn(
      'Identity export attestation omitted: OXY_PRIVATE_KEY/OXY_PUBLIC_KEY not configured',
      { component: 'identityExport' },
    );
    return null;
  }
  const signature = SignatureService.signMessage(canonicalize(bundle), privateKey);
  return { issuer: OXY_DID, publicKey, alg: ALG, signature, signedAt: Date.now() };
}

/**
 * Build the signed export bundle for `userId`, or null when the user is absent.
 * Secrets (password, refreshToken, 2FA secret/backup codes, contact hashes,
 * email forwarding/signature) are excluded at the query level and again by
 * `formatUserResponse`, which emits only an explicit, secret-free field set.
 */
export async function buildExportBundle(userId: string): Promise<ExportBundleResult | null> {
  const user = await User.findById(userId)
    .select(
      '-password -refreshToken -twoFactorAuth.secret -twoFactorAuth.backupCodes ' +
      '-hashedEmail -hashedPhone -autoForwardTo -emailSignature',
    )
    .lean();
  if (!user) {
    return null;
  }

  const did = buildUserDid(userId);
  const didDocument = buildDidDocument({
    _id: user._id,
    publicKey: user.publicKey,
    username: user.username,
    authMethods: user.authMethods,
    verifiedDomains: user.verifiedDomains,
    type: user.type,
    federation: user.federation,
  });

  // formatUserResponse returns ONLY explicitly-picked, secret-free fields.
  const profile = (formatUserResponse(user) ?? {}) as Record<string, unknown>;

  const verifiedDomains: VerifiedDomain[] = (user.verifiedDomains ?? []).map((domain) => ({
    domain: domain.domain,
    verifiedAt: toIsoString(domain.verifiedAt),
    method: domain.method,
  }));

  const authMethods = buildAuthMethodEntries({
    publicKey: user.publicKey,
    email: user.email,
    hasPassword: (user.authMethods ?? []).some((method) => method?.type === 'password'),
    authMethods: user.authMethods,
    createdAt: user.createdAt,
  });

  // Latest identity + profile signed records (the published envelopes).
  const records = await SignedRecord.find({ userId }).sort({ createdAt: -1 }).lean();
  const signedRecords: SignedRecordEnvelope[] = [];
  for (const type of ['identity', 'profile'] as const) {
    const latest = records.find((record) => record.type === type);
    if (latest?.envelope) {
      signedRecords.push(latest.envelope);
    }
  }

  // Per-app data — read via cursor to bound the working set.
  const appData: Record<string, unknown>[] = [];
  const cursor = UserAppData.find({ userId }).lean().cursor();
  for await (const doc of cursor) {
    appData.push({ namespace: doc.namespace, key: doc.key, value: doc.value });
  }

  // Social graph as portable DIDs.
  const following = (user.following ?? []).map((id) => buildUserDid(id.toString()));
  const followers = (user.followers ?? []).map((id) => buildUserDid(id.toString()));

  const bundleWithoutAttestation: ExportBundleWithoutAttestation = {
    '$schema': EXPORT_SCHEMA_URL,
    exportedAt: new Date().toISOString(),
    did,
    didDocument,
    profile,
    verifiedDomains,
    authMethods,
    signedRecords,
    appData,
    social: { following, followers },
  };

  const attestation = signBundle(bundleWithoutAttestation);
  return {
    bundle: { ...bundleWithoutAttestation, attestation },
    attestationMissing: attestation === null,
  };
}
