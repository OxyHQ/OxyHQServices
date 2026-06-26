/**
 * Unit tests for the DID document service (B2).
 *
 * Pure functions over plain objects — no DB. Asserts the self-sovereign vs.
 * custodial controller/verification-method derivation, the `alsoKnownAs`/service
 * composition, and the Oxy organisation document.
 */

import { ec as EC } from 'elliptic';
import { buildUserDid, buildDidDocument, buildOxyDidDocument, OXY_DID } from '../did.service';
import { didDocumentSchema } from '@oxyhq/contracts';

const ec = new EC('secp256k1');

function newPublicKey(): string {
  return ec.genKeyPair().getPublic('hex');
}

const ORIGINAL_OXY_PUBLIC_KEY = process.env.OXY_PUBLIC_KEY;

afterEach(() => {
  if (ORIGINAL_OXY_PUBLIC_KEY === undefined) {
    delete process.env.OXY_PUBLIC_KEY;
  } else {
    process.env.OXY_PUBLIC_KEY = ORIGINAL_OXY_PUBLIC_KEY;
  }
});

describe('buildUserDid', () => {
  it('anchors the DID on the account id, not the keypair', () => {
    expect(buildUserDid('507f1f77bcf86cd799439011')).toBe('did:web:oxy.so:u:507f1f77bcf86cd799439011');
  });
});

describe('buildDidDocument — self-sovereign account', () => {
  const publicKey = newPublicKey();
  const user = {
    _id: '507f1f77bcf86cd799439011',
    publicKey,
    username: 'nate',
    authMethods: [{ type: 'identity', metadata: { publicKey } }],
    verifiedDomains: [{ domain: 'nate.com' }],
    type: 'local',
  };

  it('produces a contract-valid document controlled by [userDid, OXY_DID]', () => {
    const doc = buildDidDocument(user);
    expect(() => didDocumentSchema.parse(doc)).not.toThrow();

    const did = buildUserDid(user._id);
    expect(doc.id).toBe(did);
    expect(doc.controller).toEqual([did, OXY_DID]);
  });

  it('exposes the account key as the #key-1 verification method + active auth', () => {
    const doc = buildDidDocument(user);
    const did = buildUserDid(user._id);

    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0]).toMatchObject({
      id: `${did}#key-1`,
      type: 'EcdsaSecp256k1VerificationKey2019',
      controller: did,
      publicKeyHex: publicKey,
    });
    expect(doc.authentication).toEqual([`${did}#key-1`]);
    expect(doc.assertionMethod).toEqual([`${did}#key-1`]);
  });

  it('includes acct handle, profile URL, and verified-domain in alsoKnownAs', () => {
    const doc = buildDidDocument(user);
    expect(doc.alsoKnownAs).toContain('acct:nate@oxy.so');
    expect(doc.alsoKnownAs).toContain('https://oxy.so/@nate');
    expect(doc.alsoKnownAs).toContain('https://nate.com');
  });

  it('publishes Oxy API + profile service endpoints', () => {
    const doc = buildDidDocument(user);
    const did = buildUserDid(user._id);
    expect(doc.service).toContainEqual({
      id: `${did}#oxy-api`,
      type: 'OxyApiService',
      serviceEndpoint: 'https://api.oxy.so',
    });
    expect(doc.service).toContainEqual({
      id: `${did}#profile`,
      type: 'OxyProfileService',
      serviceEndpoint: 'https://oxy.so/@nate',
    });
  });
});

describe('buildDidDocument — custodial (password-only) account', () => {
  const user = {
    _id: '507f1f77bcf86cd799439012',
    username: 'paula',
    authMethods: [{ type: 'password', metadata: { email: 'paula@oxy.so' } }],
    type: 'local',
  };

  it('is controlled solely by OXY_DID and references the Oxy custodial key', () => {
    process.env.OXY_PUBLIC_KEY = newPublicKey();
    const doc = buildDidDocument(user);
    expect(() => didDocumentSchema.parse(doc)).not.toThrow();

    expect(doc.controller).toEqual([OXY_DID]);
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0]).toMatchObject({
      id: `${OXY_DID}#oxy-custodial-key`,
      controller: OXY_DID,
      publicKeyHex: process.env.OXY_PUBLIC_KEY,
    });
    expect(doc.authentication).toEqual([`${OXY_DID}#oxy-custodial-key`]);
  });

  it('emits an empty verification-method set when no Oxy key is configured', () => {
    delete process.env.OXY_PUBLIC_KEY;
    const doc = buildDidDocument(user);
    expect(() => didDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.controller).toEqual([OXY_DID]);
    expect(doc.verificationMethod).toEqual([]);
    expect(doc.authentication).toEqual([]);
  });
});

describe('buildOxyDidDocument', () => {
  it('returns the Oxy organisation DID document', () => {
    process.env.OXY_PUBLIC_KEY = newPublicKey();
    const doc = buildOxyDidDocument();
    expect(() => didDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.id).toBe(OXY_DID);
    expect(doc.controller).toEqual([OXY_DID]);
    expect(doc.verificationMethod[0]?.publicKeyHex).toBe(process.env.OXY_PUBLIC_KEY);
  });
});

describe('DID_WEB_DOMAIN override', () => {
  // The DID-web domain is read at module-load time, so a fresh module registry
  // is required to exercise a different `DID_WEB_DOMAIN`.
  const ORIGINAL_DID_WEB_DOMAIN = process.env.DID_WEB_DOMAIN;

  afterEach(() => {
    if (ORIGINAL_DID_WEB_DOMAIN === undefined) {
      delete process.env.DID_WEB_DOMAIN;
    } else {
      process.env.DID_WEB_DOMAIN = ORIGINAL_DID_WEB_DOMAIN;
    }
    jest.resetModules();
  });

  function loadDidServiceFresh(): typeof import('../did.service') {
    let mod: typeof import('../did.service') | undefined;
    jest.isolateModules(() => {
      mod = require('../did.service') as typeof import('../did.service');
    });
    if (!mod) {
      throw new Error('did.service failed to load under isolateModules');
    }
    return mod;
  }

  it('anchors every did:web id at DID_WEB_DOMAIN while keeping federation URLs on oxy.so', () => {
    process.env.DID_WEB_DOMAIN = 'api.oxy.so';
    const fresh = loadDidServiceFresh();

    expect(fresh.OXY_DID).toBe('did:web:api.oxy.so');
    expect(fresh.buildUserDid('507f1f77bcf86cd799439011')).toBe(
      'did:web:api.oxy.so:u:507f1f77bcf86cd799439011',
    );

    const publicKey = newPublicKey();
    const did = 'did:web:api.oxy.so:u:507f1f77bcf86cd799439011';
    const doc = fresh.buildDidDocument({
      _id: '507f1f77bcf86cd799439011',
      publicKey,
      username: 'nate',
      authMethods: [{ type: 'identity', metadata: { publicKey } }],
      verifiedDomains: [{ domain: 'nate.com' }],
      type: 'local',
    });

    // DID id, controllers, verification-method ids, and service ids all follow
    // the DID-web domain.
    expect(doc.id).toBe(did);
    expect(doc.controller).toEqual([did, 'did:web:api.oxy.so']);
    expect(doc.verificationMethod[0]?.id).toBe(`${did}#key-1`);
    expect(doc.service.map((s) => s.id)).toEqual([`${did}#oxy-api`, `${did}#profile`]);

    // Federation-anchored handles/URLs/endpoints STAY on the federation apex.
    expect(doc.alsoKnownAs).toContain('acct:nate@oxy.so');
    expect(doc.alsoKnownAs).toContain('https://oxy.so/@nate');
    expect(doc.service).toContainEqual({
      id: `${did}#oxy-api`,
      type: 'OxyApiService',
      serviceEndpoint: 'https://api.oxy.so',
    });
    expect(doc.service).toContainEqual({
      id: `${did}#profile`,
      type: 'OxyProfileService',
      serviceEndpoint: 'https://oxy.so/@nate',
    });

    const orgDoc = fresh.buildOxyDidDocument();
    expect(orgDoc.id).toBe('did:web:api.oxy.so');
    expect(orgDoc.controller).toEqual(['did:web:api.oxy.so']);
    expect(orgDoc.service[0]?.serviceEndpoint).toBe('https://api.oxy.so');
  });

  it('defaults to did:web:oxy.so when DID_WEB_DOMAIN is unset', () => {
    delete process.env.DID_WEB_DOMAIN;
    const fresh = loadDidServiceFresh();

    expect(fresh.OXY_DID).toBe('did:web:oxy.so');
    expect(fresh.buildUserDid('507f1f77bcf86cd799439011')).toBe(
      'did:web:oxy.so:u:507f1f77bcf86cd799439011',
    );
  });
});
