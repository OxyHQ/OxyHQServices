/**
 * Regression: real-life attestation under the PRODUCTION did:web anchor.
 *
 * Production re-anchors server-emitted DIDs at the API host
 * (`DID_WEB_DOMAIN=api.oxy.so`, oxy-infra `app-services.tf`), while the shipped
 * SDK (`@oxyhq/core` `OXY_IDENTITY_APEX`) signs every client envelope at the
 * canonical identity apex (`did:web:oxy.so:u:<accountId>`). The self-issuance
 * gate used to string-compare `buildUserDid(req.user._id)` against the
 * envelope's DIDs, so EVERY client-signed attestation failed `not_self_issued`
 * in prod (and only in prod — dev collapses both anchors to `oxy.so`). The gate
 * is now account-based (`isSelfIssuedByUser` + a dual-anchor `parseUserDid`).
 *
 * `did.service` is loaded FRESH with `DID_WEB_DOMAIN=api.oxy.so` (module-load
 * env read) via `jest.isolateModulesAsync`; everything around the service is
 * mocked exactly as in `civic.realLife.test.ts`.
 */

import type { SignedRecordEnvelope } from '@oxyhq/contracts';

const mockVerifySig = jest.fn();
const mockVerifyAndStore = jest.fn();
const mockIsSockPuppet = jest.fn();
const mockNonceCreate = jest.fn();
const mockAward = jest.fn();
const mockUserExists = jest.fn();
const mockTxnFindOne = jest.fn();

jest.mock('../signedRecord.service', () => ({
  verifyAndStoreRecord: (...a: unknown[]) => mockVerifyAndStore(...a),
}));
jest.mock('@oxyhq/protocol', () => ({
  ...jest.requireActual('@oxyhq/protocol'),
  verifyEnvelopeSignature: (...a: unknown[]) => mockVerifySig(...a),
}));
jest.mock('../civic/graphExclusion', () => ({
  isSockPuppetRelation: (...a: unknown[]) => mockIsSockPuppet(...a),
}));
jest.mock('../../models/CivicNonce', () => ({
  __esModule: true,
  default: { create: (...a: unknown[]) => mockNonceCreate(...a) },
}));
jest.mock('../reputation.service', () => ({
  reputationService: { award: (...a: unknown[]) => mockAward(...a) },
}));
jest.mock('../../models/User', () => ({
  __esModule: true,
  User: { exists: (...a: unknown[]) => mockUserExists(...a) },
}));
jest.mock('../../models/ReputationTransaction', () => ({
  __esModule: true,
  ReputationTransaction: { findOne: (...a: unknown[]) => mockTxnFindOne(...a) },
}));
jest.mock('../../utils/validation', () => ({ isValidObjectId: (id: string) => /^[a-f0-9]{24}$/i.test(id) }));
jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const A = 'a'.repeat(24); // subject (QR owner)
const B = 'b'.repeat(24); // attestor (authenticated caller)

/** The spelling the shipped SDK signs with (`@oxyhq/core` OXY_IDENTITY_APEX). */
function sdkDid(id: string): string {
  return `did:web:oxy.so:u:${id}`;
}

/** The spelling the server emits under the prod anchor. */
function serverDid(id: string): string {
  return `did:web:api.oxy.so:u:${id}`;
}

function envelope(overrides: { subject?: string; issuer?: string; about?: string } = {}): SignedRecordEnvelope {
  const subject = overrides.subject ?? sdkDid(B);
  return {
    version: 2,
    type: 'real_life_attestation',
    subject,
    issuer: overrides.issuer ?? subject,
    record: {
      about: overrides.about ?? sdkDid(A),
      context: 'ctx-1',
      nonce: 'nonce-1',
      exp: Date.now() + 5 * 60 * 1000,
    },
    issuedAt: Date.now(),
    seq: 0,
    prev: null,
    collection: 'app.oxy.attestation',
    rkey: 'nonce-1',
    publicKey: 'pk-b',
    alg: 'ES256K-DER-SHA256',
    signature: 'sig',
  };
}

describe('submitRealLifeAttestation under DID_WEB_DOMAIN=api.oxy.so (prod anchor)', () => {
  const ORIGINAL_DID_WEB_DOMAIN = process.env.DID_WEB_DOMAIN;
  let submit: typeof import('../civic/realLife.service').submitRealLifeAttestation;

  beforeAll(async () => {
    process.env.DID_WEB_DOMAIN = 'api.oxy.so';
    await jest.isolateModulesAsync(async () => {
      ({ submitRealLifeAttestation: submit } = await import('../civic/realLife.service'));
    });
  });

  afterAll(() => {
    if (ORIGINAL_DID_WEB_DOMAIN === undefined) {
      delete process.env.DID_WEB_DOMAIN;
    } else {
      process.env.DID_WEB_DOMAIN = ORIGINAL_DID_WEB_DOMAIN;
    }
    jest.resetModules();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifySig.mockReturnValue(true);
    mockIsSockPuppet.mockResolvedValue({ excluded: false });
    mockNonceCreate.mockResolvedValue({});
    mockVerifyAndStore.mockResolvedValue({ ok: true, record: { recordId: 'rec-1' } });
    mockAward.mockResolvedValue({ points: 25 });
    mockUserExists.mockResolvedValue({ _id: A });
    mockTxnFindOne.mockReturnValue({ select: () => ({ lean: async () => null }) });
  });

  it('accepts an SDK-spelled (did:web:oxy.so) self-issued envelope for the caller account', async () => {
    const result = await submit(envelope(), B);

    expect(result).toEqual({ ok: true, recordId: 'rec-1', subjectUserId: A, attestorUserId: B, points: 25 });
    expect(mockAward).toHaveBeenCalledTimes(1);
    expect(mockAward.mock.calls[0][0]).toMatchObject({ userId: A, createdByUserId: B });
  });

  it('accepts a server-spelled (did:web:api.oxy.so) self-issued envelope too', async () => {
    const env = envelope({ subject: serverDid(B), about: serverDid(A) });
    const result = await submit(env, B);
    expect(result).toEqual({ ok: true, recordId: 'rec-1', subjectUserId: A, attestorUserId: B, points: 25 });
  });

  it('still rejects an envelope self-issued as a DIFFERENT account', async () => {
    expect(await submit(envelope({ subject: sdkDid(A) }), B)).toEqual({ ok: false, reason: 'not_self_issued' });
    expect(mockAward).not.toHaveBeenCalled();
  });

  it('still rejects a foreign-domain subject DID', async () => {
    const foreign = `did:web:evil.com:u:${B}`;
    expect(await submit(envelope({ subject: foreign }), B)).toEqual({ ok: false, reason: 'not_self_issued' });
  });

  it('still rejects mixed subject/issuer identities', async () => {
    expect(await submit(envelope({ issuer: sdkDid(A) }), B)).toEqual({ ok: false, reason: 'not_self_issued' });
  });
});
