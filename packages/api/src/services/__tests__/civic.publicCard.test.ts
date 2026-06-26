/**
 * Civic public-card tests (Fase 1).
 *
 * Asserts `buildSignedPublicCard` assembles the canonical card shape from the
 * user + reputation balance, and that the Oxy attestation verifies against the
 * canonical-JSON of the card (the same `ES256K-DER-SHA256` scheme a Commons
 * scanner uses OFFLINE). The User/ReputationBalance models are mocked; the
 * display-name composition + canonicalization run for real.
 */

import { ec as EC } from 'elliptic';
import { canonicalize } from '@oxyhq/core';

const ec = new EC('secp256k1');
const oxyKey = ec.genKeyPair();
const OXY_PUBLIC = oxyKey.getPublic('hex');
const OXY_PRIVATE = oxyKey.getPrivate('hex');

const USER_ID = '507f1f77bcf86cd799439011';

const mockUserFindById = jest.fn();
const mockBalanceFindOne = jest.fn();

jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { findById: (...a: unknown[]) => mockUserFindById(...a) },
}));
jest.mock('../../models/ReputationBalance', () => ({
  __esModule: true,
  ReputationBalance: { findOne: (...a: unknown[]) => mockBalanceFindOne(...a) },
}));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { buildSignedPublicCard } from '../civic/publicCard.service';
import SignatureService from '../signature.service';
import { buildUserDid, OXY_DID } from '../did.service';

function userDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: USER_ID,
    username: 'nate',
    name: { first: 'Nate', last: 'Isern' },
    avatar: 'fileabc',
    publicKey: 'pk',
    verified: true,
    verifiedDomains: [{ domain: 'oxy.so', verifiedAt: new Date(), method: 'dns-txt' }],
    ...overrides,
  };
}

beforeAll(() => {
  process.env.OXY_PRIVATE_KEY = OXY_PRIVATE;
  process.env.OXY_PUBLIC_KEY = OXY_PUBLIC;
});
afterAll(() => {
  delete process.env.OXY_PRIVATE_KEY;
  delete process.env.OXY_PUBLIC_KEY;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindById.mockReturnValue({ select: () => ({ lean: async () => userDoc() }) });
  mockBalanceFindOne.mockReturnValue({ lean: async () => ({ trustTier: 'trusted' }) });
});

describe('buildSignedPublicCard', () => {
  it('assembles the canonical card shape', async () => {
    const signed = await buildSignedPublicCard(USER_ID);
    if (!signed) {
      throw new Error('expected a signed card');
    }
    const { card } = signed;

    expect(card.did).toBe(buildUserDid(USER_ID));
    expect(card.userId).toBe(USER_ID);
    expect(typeof card.name).toBe('string');
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.username).toBe('nate');
    expect(card.avatarUrl).toBe('https://cloud.oxy.so/fileabc');
    expect(card.trustTier).toBe('trusted');
    expect(card.personhoodStatus).toBe('unverified');
    expect(card.verifiedDomains).toEqual(['oxy.so']);
    expect(card.credentialBadges).toEqual([]);
    expect(typeof card.issuedAt).toBe('number');
  });

  it('seals the card with an Oxy attestation that verifies over the canonical card', async () => {
    const signed = await buildSignedPublicCard(USER_ID);
    if (!signed?.attestation) {
      throw new Error('expected a signed card with an attestation');
    }
    const { card, attestation } = signed;

    expect(attestation.issuer).toBe(OXY_DID);
    expect(attestation.alg).toBe('ES256K-DER-SHA256');
    expect(attestation.publicKey).toBe(OXY_PUBLIC);
    expect(
      SignatureService.verifySignature(canonicalize(card), attestation.signature, attestation.publicKey),
    ).toBe(true);
  });

  it('omits optional fields when absent (no username / avatar)', async () => {
    mockUserFindById.mockReturnValue({
      select: () => ({ lean: async () => userDoc({ username: undefined, avatar: undefined }) }),
    });
    const signed = await buildSignedPublicCard(USER_ID);
    if (!signed) {
      throw new Error('expected a signed card');
    }
    expect(signed.card.username).toBeUndefined();
    expect(signed.card.avatarUrl).toBeUndefined();
  });

  it('defaults trustTier to "new" when the user has no balance', async () => {
    mockBalanceFindOne.mockReturnValue({ lean: async () => null });
    const signed = await buildSignedPublicCard(USER_ID);
    if (!signed) {
      throw new Error('expected a signed card');
    }
    expect(signed.card.trustTier).toBe('new');
  });

  it('returns null for an unknown user', async () => {
    mockUserFindById.mockReturnValue({ select: () => ({ lean: async () => null }) });
    expect(await buildSignedPublicCard(USER_ID)).toBeNull();
  });

  it('still returns a card (attestation null) when the Oxy key is unconfigured', async () => {
    delete process.env.OXY_PRIVATE_KEY;
    delete process.env.OXY_PUBLIC_KEY;
    const signed = await buildSignedPublicCard(USER_ID);
    if (!signed) {
      throw new Error('expected a signed card');
    }
    expect(signed.attestation).toBeNull();
    process.env.OXY_PRIVATE_KEY = OXY_PRIVATE;
    process.env.OXY_PUBLIC_KEY = OXY_PUBLIC;
  });
});
