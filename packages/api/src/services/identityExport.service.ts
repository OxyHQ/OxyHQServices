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
 * ## Storage (Postgres) — six tables where Mongo had one document plus two
 *
 * `verifiedDomains[]`, `authMethods[]`, `following[]` and `followers[]` were all
 * embedded arrays on the Mongo user document. Three are child tables now
 * (`user_verified_domains`, `user_auth_methods`) and the social graph is
 * `user_follows`, which `schema/CONVENTIONS.md` makes the SINGLE authority — the
 * embedded id arrays are deleted, so reading them is the only correct port.
 *
 * **Every read is ORDERED, and that is load-bearing here rather than tidiness.**
 * The bundle's bytes are the SIGNING INPUT of the Oxy attestation, so an
 * unordered read (Postgres heap order) would let two exports of an unchanged
 * account produce different bytes and different signatures. Each ordering is the
 * faithful analogue of what Mongo returned:
 *
 * | section | ordering | why it is the same order Mongo gave |
 * |---|---|---|
 * | `verifiedDomains` | `created_at, id` | array insertion order; re-verifying updated the entry in place |
 * | `authMethods` | `linked_at, id` | array insertion order, as `routes/authLinking.ts` also reads it |
 * | `appData` | `namespace, key` | Mongo served `find({userId})` from the `{userId, namespace, key}` unique index |
 * | `social.*` | `created_at, id` | the order edges were pushed onto the arrays |
 *
 * ## Secrets
 *
 * The profile comes from `UserService.readAccountDocument`, which selects
 * `publicColumns(users)` — the `select: false` replacement
 * (`db/schema/protectedColumns.ts`). That is STRICTLY stronger than the Mongoose
 * projection it replaces: the old `.select('-password …')` string never excluded
 * `phone`, and relied on `formatUserResponse`'s explicit field list to keep it
 * out of the bundle. Now the column cannot be read at all — the row type has no
 * `phone` property, so a serializer that reached for one would fail `tsc`.
 * `formatUserResponse` remains the second, independent gate.
 */

import { eq } from 'drizzle-orm';
import { canonicalize } from '@oxyhq/protocol';
import type {
  ExportBundle,
  ExportAttestation,
  VerifiedDomain,
  SignedRecordEnvelope,
} from '@oxyhq/contracts';
import { getDb } from '../config/postgres';
import { userAppData } from '../db/schema/userAppData';
import { userAuthMethods } from '../db/schema/userAuthMethods';
import { userFollows } from '../db/schema/userFollows';
import { users } from '../db/schema/users';
import { userVerifiedDomains } from '../db/schema/userVerifiedDomains';
import SignatureService from './signature.service';
import { buildUserDid, buildDidDocument, OXY_DID } from './did.service';
import { getLatestRecord } from './signedRecord.service';
import { userService } from './user.service';
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
 *
 * Secrets (password, refresh token, 2FA material, contact hashes, raw phone,
 * email forwarding/signature) are excluded at the QUERY level by
 * `publicColumns(users)` and again by `formatUserResponse`, which emits only an
 * explicit, secret-free field set. `user_auth_methods` is read as the three
 * non-secret columns the DID mapping needs — never the whole row.
 */
export async function buildExportBundle(userId: string): Promise<ExportBundleResult | null> {
  const db = getDb();

  // Two reads of the same `users` row, deliberately. `readAccountDocument`
  // assembles the whole account — including the 23 privacy toggles, locations,
  // link metadata and the folded theme preference that `formatUserResponse`
  // emits — and returns it as an `AccountDocument`, whose index signature types
  // every field `unknown`. The DID document and the auth-method entries need
  // TYPED values (`publicKey`, `createdAt`, …), and narrowing them back out of
  // `unknown` would be a cast; selecting the five identity columns explicitly is
  // both honest and cheaper than duplicating that assembly here.
  const [identity, account, domainRows, authMethodRows] = await Promise.all([
    db
      .select({
        publicKey: users.publicKey,
        username: users.username,
        type: users.type,
        federationDomain: users.federationDomain,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    userService.readAccountDocument(userId),
    db
      .select({
        domain: userVerifiedDomains.domain,
        verifiedAt: userVerifiedDomains.verifiedAt,
        method: userVerifiedDomains.method,
      })
      .from(userVerifiedDomains)
      .where(eq(userVerifiedDomains.userId, userId))
      .orderBy(userVerifiedDomains.createdAt, userVerifiedDomains.id),
    db
      .select({
        type: userAuthMethods.type,
        linkedAt: userAuthMethods.linkedAt,
        methodPublicKey: userAuthMethods.methodPublicKey,
        methodCredentialId: userAuthMethods.methodCredentialId,
        methodName: userAuthMethods.methodName,
      })
      .from(userAuthMethods)
      .where(eq(userAuthMethods.userId, userId))
      .orderBy(userAuthMethods.linkedAt, userAuthMethods.id),
  ]);
  const self = identity[0];
  if (!self || !account) {
    return null;
  }

  const did = buildUserDid(userId);
  const didDocument = buildDidDocument({
    _id: userId,
    publicKey: self.publicKey,
    username: self.username,
    // `buildAuthMethodEntries` and `buildDidDocument` both still read the
    // `metadata.*` shape the Mongo subdocument had; the child-table columns are
    // adapted to it HERE rather than by changing helpers other routes share.
    authMethods: authMethodRows.map((method) => ({
      type: method.type,
      metadata: { publicKey: method.methodPublicKey },
    })),
    verifiedDomains: domainRows,
    type: self.type,
    federation: self.federationDomain ? { domain: self.federationDomain } : null,
    node: null,
  });

  // formatUserResponse returns ONLY explicitly-picked, secret-free fields. The
  // account document is handed the ORDERED domain rows so the profile section
  // and the bundle's own `verifiedDomains` cannot disagree on order — two
  // renderings of one fact inside a single signed artifact.
  const profile = (formatUserResponse({ ...account, verifiedDomains: domainRows }) ?? {}) as Record<string, unknown>;

  const verifiedDomains: VerifiedDomain[] = domainRows.map((domain) => ({
    domain: domain.domain,
    verifiedAt: toIsoString(domain.verifiedAt),
    method: domain.method,
  }));

  const authMethods = buildAuthMethodEntries({
    publicKey: self.publicKey,
    authMethods: authMethodRows.map((method) => ({
      type: method.type,
      linkedAt: method.linkedAt,
      metadata: { credentialID: method.methodCredentialId, name: method.methodName },
    })),
    createdAt: self.createdAt,
  });

  // Latest identity + profile signed records (the published envelopes), through
  // the same accessor the public record route uses so the export can never serve
  // a different "latest" than `GET /identity/records/:userId/:type`.
  const latest = await Promise.all(
    (['identity', 'profile'] as const).map((type) => getLatestRecord(userId, type)),
  );
  const signedRecords: SignedRecordEnvelope[] = latest
    .filter((record): record is { envelope: SignedRecordEnvelope } => record !== null)
    .map((record) => record.envelope);

  const [appDataRows, followingRows, followerRows] = await Promise.all([
    db
      .select({ namespace: userAppData.namespace, key: userAppData.key, value: userAppData.value })
      .from(userAppData)
      .where(eq(userAppData.userId, userId))
      .orderBy(userAppData.namespace, userAppData.key),
    db
      .select({ id: userFollows.followedId })
      .from(userFollows)
      .where(eq(userFollows.followerId, userId))
      .orderBy(userFollows.createdAt, userFollows.id),
    db
      .select({ id: userFollows.followerId })
      .from(userFollows)
      .where(eq(userFollows.followedId, userId))
      .orderBy(userFollows.createdAt, userFollows.id),
  ]);

  const appData: Record<string, unknown>[] = appDataRows.map((row) => ({
    namespace: row.namespace,
    key: row.key,
    value: row.value,
  }));

  // Social graph as portable DIDs.
  const following = followingRows.map((row) => buildUserDid(row.id));
  const followers = followerRows.map((row) => buildUserDid(row.id));

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
