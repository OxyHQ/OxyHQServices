/**
 * DID Document Service (self-sovereign identity layer — B2)
 *
 * Derives a W3C DID document for an Oxy user ON DEMAND — there is no stored DID
 * document. The DID is anchored on the stable account id (`did:web:<domain>:u:<userId>`),
 * NOT on the keypair: the keypair is a *verification method* that maps 1:1 to
 * the existing `authMethods[]`. A password-only (custodial) account gets a DID
 * controlled solely by Oxy; creating a Commons key upgrades the account to
 * self-sovereign (`controller = [userDid, OXY_DID]`); the change is fully
 * reversible by linking/unlinking the identity auth method.
 *
 * The output is validated against `didDocumentSchema` from `@oxyhq/contracts` so
 * the API can never serve a document that drifts from the published contract.
 *
 * Pure and platform-agnostic: every input is passed in (no DB access here) so
 * the function can be unit-tested with plain objects and reused by the model
 * virtual, the `GET /u/:userId/did.json` route, the auth-methods route, and the
 * signed data export.
 */

import { getNormalizedUserHandle } from '@oxyhq/core';
import {
  didDocumentSchema,
  type DidDocument,
  type VerificationMethod,
  type DidService,
} from '@oxyhq/contracts';

/**
 * The federation/identity domain. `did:web` method-specific ids encode any `:`
 * as `%3A` (e.g. a `host:port` dev domain); the apex `oxy.so` has none.
 */
const RAW_DID_DOMAIN = process.env.FEDERATION_DOMAIN || 'oxy.so';
const DID_DOMAIN = RAW_DID_DOMAIN.replace(/:/g, '%3A');

/** The Oxy organisation DID (controller of custodial accounts). */
export const OXY_DID = `did:web:${DID_DOMAIN}`;

/** W3C DID core + secp256k1 verification-suite contexts. */
const DID_CONTEXT = [
  'https://www.w3.org/ns/did/v1',
  'https://w3id.org/security/suites/secp256k1-2019/v1',
];

const SECP256K1_VM_TYPE = 'EcdsaSecp256k1VerificationKey2019' as const;

/**
 * The minimal identity-bearing shape of a user the DID builder reads. Accepts a
 * lean Mongoose document or any structurally-compatible object.
 */
export interface DidUserInput {
  _id: string | { toString(): string };
  publicKey?: string | null;
  username?: string | null;
  authMethods?: Array<{ type?: string | null; metadata?: { publicKey?: string | null } | null } | null> | null;
  verifiedDomains?: Array<{ domain?: string | null } | null> | null;
  type?: string | null;
  federation?: { domain?: string | null } | null;
}

function stringifyId(id: string | { toString(): string }): string {
  return typeof id === 'string' ? id : id.toString();
}

/** Build the canonical user DID from the stable account id. */
export function buildUserDid(userId: string): string {
  return `did:web:${DID_DOMAIN}:u:${userId}`;
}

/**
 * Collect the distinct secp256k1 identity public keys for an account: the
 * primary `publicKey` first, then any `identity` auth-method keys not already
 * present. The ordering makes `#key-1` deterministically the primary key.
 */
function collectIdentityKeys(user: DidUserInput): string[] {
  const keys: string[] = [];
  if (user.publicKey) {
    keys.push(user.publicKey);
  }
  for (const method of user.authMethods ?? []) {
    const key = method?.type === 'identity' ? method.metadata?.publicKey : undefined;
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }
  return keys;
}

function oxyCustodialVerificationMethod(): VerificationMethod | null {
  const oxyPublicKey = process.env.OXY_PUBLIC_KEY;
  if (!oxyPublicKey) {
    return null;
  }
  return {
    id: `${OXY_DID}#oxy-custodial-key`,
    type: SECP256K1_VM_TYPE,
    controller: OXY_DID,
    publicKeyHex: oxyPublicKey,
  };
}

/**
 * Derive the W3C DID document for `user`. Self-sovereign accounts (≥1 identity
 * verification method) are controlled by `[userDid, OXY_DID]` and expose their
 * own keys; custodial accounts are controlled by `[OXY_DID]` and reference the
 * Oxy custodial key (when configured).
 */
export function buildDidDocument(user: DidUserInput): DidDocument {
  const userId = stringifyId(user._id);
  const did = buildUserDid(userId);

  const identityKeys = collectIdentityKeys(user);
  const isSelfSovereign = identityKeys.length > 0;

  const verificationMethod: VerificationMethod[] = [];
  const activeVerificationMethodIds: string[] = [];

  if (isSelfSovereign) {
    identityKeys.forEach((publicKeyHex, index) => {
      const id = `${did}#key-${index + 1}`;
      verificationMethod.push({ id, type: SECP256K1_VM_TYPE, controller: did, publicKeyHex });
      activeVerificationMethodIds.push(id);
    });
  } else {
    const custodial = oxyCustodialVerificationMethod();
    if (custodial) {
      verificationMethod.push(custodial);
      activeVerificationMethodIds.push(custodial.id);
    }
  }

  const controller = isSelfSovereign ? [did, OXY_DID] : [OXY_DID];

  const alsoKnownAs: string[] = [];
  const handle = getNormalizedUserHandle({
    username: user.username ?? undefined,
    type: user.type ?? undefined,
    federation: user.federation ?? undefined,
  });
  if (handle) {
    alsoKnownAs.push(`acct:${handle}@${RAW_DID_DOMAIN}`);
    alsoKnownAs.push(`https://${RAW_DID_DOMAIN}/@${handle}`);
  }
  for (const verified of user.verifiedDomains ?? []) {
    if (verified?.domain) {
      alsoKnownAs.push(`https://${verified.domain}`);
    }
  }

  const service: DidService[] = [
    { id: `${did}#oxy-api`, type: 'OxyApiService', serviceEndpoint: `https://api.${RAW_DID_DOMAIN}` },
  ];
  if (handle) {
    service.push({
      id: `${did}#profile`,
      type: 'OxyProfileService',
      serviceEndpoint: `https://${RAW_DID_DOMAIN}/@${handle}`,
    });
  }

  const document: DidDocument = {
    '@context': DID_CONTEXT,
    id: did,
    controller,
    verificationMethod,
    authentication: activeVerificationMethodIds,
    assertionMethod: activeVerificationMethodIds,
    alsoKnownAs,
    service,
  };

  return didDocumentSchema.parse(document);
}

/**
 * Derive the Oxy organisation DID document served at
 * `GET /.well-known/did.json`. References the Oxy custodial key when configured.
 */
export function buildOxyDidDocument(): DidDocument {
  const custodial = oxyCustodialVerificationMethod();
  const verificationMethod = custodial ? [custodial] : [];
  const activeVerificationMethodIds = custodial ? [custodial.id] : [];

  const document: DidDocument = {
    '@context': DID_CONTEXT,
    id: OXY_DID,
    controller: [OXY_DID],
    verificationMethod,
    authentication: activeVerificationMethodIds,
    assertionMethod: activeVerificationMethodIds,
    alsoKnownAs: [`https://${RAW_DID_DOMAIN}`],
    service: [
      { id: `${OXY_DID}#oxy-api`, type: 'OxyApiService', serviceEndpoint: `https://api.${RAW_DID_DOMAIN}` },
    ],
  };

  return didDocumentSchema.parse(document);
}
