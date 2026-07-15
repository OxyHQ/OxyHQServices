/**
 * Auth-method ↔ DID verification-method mapping (self-sovereign identity — B4).
 *
 * Single source of the `AuthMethodEntry[]` shape served by `GET /auth/methods`
 * and embedded in the signed data export. Each entry maps a linked auth method
 * to its DID verification-method fragment: an `identity` method carries the
 * `#key-1` verification-method id (its key is a DID verification method);
 * `password`/social methods carry none.
 */

import type { AuthMethodEntry } from '@oxyhq/contracts';

/** The verification-method fragment for the primary identity key. */
export const IDENTITY_VERIFICATION_METHOD_ID = '#key-1';

const SOCIAL_TYPES = ['google', 'apple', 'github'] as const;
type SocialType = (typeof SOCIAL_TYPES)[number];

function isSocialType(type: string): type is SocialType {
  return (SOCIAL_TYPES as readonly string[]).includes(type);
}

export interface AuthMethodEntriesInput {
  publicKey?: string | null;
  email?: string | null;
  /** Whether a usable password credential exists (resolved by the caller). */
  hasPassword: boolean;
  authMethods?: Array<{
    type?: string | null;
    linkedAt?: Date | null;
    metadata?: { credentialID?: string | null; name?: string | null } | null;
  } | null> | null;
  /** Fallback `linkedAt` for methods predating the `authMethods[]` stamp. */
  createdAt: Date;
}

/**
 * Build the contract-shaped list of linked authentication methods for an
 * account. The identity entry is present when the account holds a `publicKey`;
 * the password entry when `hasPassword` and an `email` exist; one social entry
 * per linked social `authMethods[]` row; and one `webauthn` entry per registered
 * passkey row (carrying its `credentialId` + `name`). A passkey is NOT a DID
 * verification method, so its entry has no `verificationMethodId` — a
 * passkey-only account stays custodial.
 */
export function buildAuthMethodEntries(input: AuthMethodEntriesInput): AuthMethodEntry[] {
  const entries: AuthMethodEntry[] = [];
  const methods = input.authMethods ?? [];
  const linkedAtFor = (type: string): Date =>
    methods.find((method) => method?.type === type)?.linkedAt ?? input.createdAt;

  if (input.publicKey) {
    entries.push({
      type: 'identity',
      linkedAt: linkedAtFor('identity'),
      verificationMethodId: IDENTITY_VERIFICATION_METHOD_ID,
    });
  }

  if (input.hasPassword && input.email) {
    entries.push({ type: 'password', linkedAt: linkedAtFor('password') });
  }

  for (const method of methods) {
    if (method?.type && isSocialType(method.type)) {
      entries.push({ type: method.type, linkedAt: method.linkedAt ?? input.createdAt });
    } else if (method?.type === 'webauthn') {
      const entry: AuthMethodEntry = { type: 'webauthn', linkedAt: method.linkedAt ?? input.createdAt };
      if (method.metadata?.credentialID) entry.credentialId = method.metadata.credentialID;
      if (method.metadata?.name) entry.name = method.metadata.name;
      entries.push(entry);
    }
  }

  return entries;
}
