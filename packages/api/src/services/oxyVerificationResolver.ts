/**
 * Oxy VerificationMethodResolver — the identity HALF of the chain adapter.
 *
 * This is the Oxy AUTHORIZATION policy the app-agnostic @oxyhq/protocol engine
 * delegates to: given a subject DID, it resolves the account's current
 * verification methods (its primary key + any `identity` auth-method keys) and
 * the Oxy custodial issuer that may sign provenance records ABOUT the subject.
 * The engine's `isAuthorizedKey` then applies the uniform rule (self-issued ⇒
 * key ∈ current VMs; custodial ⇒ key === the custodial key; else untrusted).
 *
 * Custodial note: `OXY_PUBLIC_KEY` is the verification method of `OXY_DID` and is
 * PUBLIC (it is published in the Oxy organisation's DID document at
 * `/.well-known/did.json`). It is not a secret, so a plain-equality comparison
 * in the engine is sufficient — there is no secret to protect with a
 * constant-time compare. The signature is still verified against `env.publicKey`,
 * so only the holder of `OXY_PRIVATE_KEY` (the server) can mint a record that
 * passes BOTH the custodial-key check and the signature check.
 */

import type { ResolvedVerificationMethods, VerificationMethodResolver } from '@oxyhq/protocol';
import { OXY_DID, parseUserDid } from './did.service';
import { User } from '../models/User';

/** The minimal subject-account projection the resolver reads from the DB. */
interface SubjectVerificationMethods {
  publicKey?: string | null;
  authMethods?: Array<{ type?: string | null; metadata?: { publicKey?: string | null } | null } | null> | null;
}

/**
 * Collect the distinct current verification-method public keys for a subject:
 * its primary `publicKey` first, then any `identity` auth-method keys. Mirrors
 * the DID document's `verificationMethod` set.
 */
function collectCurrentPublicKeys(subject: SubjectVerificationMethods): string[] {
  const keys: string[] = [];
  if (subject.publicKey) {
    keys.push(subject.publicKey);
  }
  for (const method of subject.authMethods ?? []) {
    const key = method?.type === 'identity' ? method.metadata?.publicKey : undefined;
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The Oxy resolver: maps a subject DID → its current verification methods + the
 * Oxy custodial issuer. Returns `null` when the DID is not a user DID for this
 * issuer's domain or the account does not exist (no key is then authorized).
 */
export const oxyVerificationResolver: VerificationMethodResolver = {
  async resolve(subjectDid: string): Promise<ResolvedVerificationMethods | null> {
    const userId = parseUserDid(subjectDid);
    if (!userId) {
      return null;
    }
    const user = await User.findById(userId)
      .select('publicKey authMethods')
      .lean<SubjectVerificationMethods | null>();
    if (!user) {
      return null;
    }

    const custodialPublicKey = process.env.OXY_PUBLIC_KEY;
    return {
      currentPublicKeys: collectCurrentPublicKeys(user),
      custodialIssuer: OXY_DID,
      // Omit the custodial key when unconfigured so a custodial record can never
      // verify in an environment with no Oxy key.
      ...(custodialPublicKey ? { custodialPublicKey } : {}),
    };
  },
};
