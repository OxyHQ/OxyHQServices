/**
 * Civic Mixin tests (Commons "DNI" — Fase 1; anti-gaming — Fase 2).
 *
 * Stubs `makeRequest` so the tests run with no network, then asserts:
 *  - Fase 1: `getPublicCard` shapes the request (GET `/civic/:userId/card`,
 *    cached) and verifies a GENUINE Oxy signature over `canonicalize(card)` →
 *    `verified:true`; a tampered card / wrong key → `verified:false` (NO throw);
 *    a `null` attestation → `verified:false`; a transport failure still rejects;
 *    `getMyDniPayload` builds the exact `oxydni://card?did=…&v=1` string and
 *    round-trips through `parseDniPayload`, which rejects garbage.
 *  - Fase 2: `buildAttestQrPayload` mints a fresh nonce + 10-min exp and encodes
 *    the context safely; `parseAttestPayload` round-trips + rejects garbage;
 *    `submitRealLifeAttestation` fetches the caller's chain head, signs a
 *    self-issued v2 envelope (about=subjectDid, seq=head+1, prev=head id,
 *    collection `app.oxy.attestation`, rkey=nonce) and POSTs it;
 *    `getValidatorInbox`/`submitValidationVote`/`denyValidation` shape their
 *    requests and the vote signs the right verdict envelope.
 *
 * The Fase 1 "genuine" card signatures use real secp256k1 keypairs (the same
 * `ES256K-DER-SHA256` scheme the server uses). The Fase 2 write tests mock
 * `SignatureService.signRecordV2` (asserting the exact record + chain coords) so
 * they isolate the SDK's request shaping from native key storage.
 */

import { ec as EC } from 'elliptic';
import type { ExportAttestation, PublicCard, SignedRecordEnvelope } from '@oxyhq/contracts';
import { OxyServices } from '../../OxyServices';
import { canonicalize } from '../../crypto/canonicalJson';
import { SignatureService } from '../../crypto/signatureService';
import { parseAttestPayload, parseDniPayload, verifyPublicCardAttestation } from '../OxyServices.civic';

const ec = new EC('secp256k1');

const baseCard: PublicCard = {
  did: 'did:web:oxy.so:u:user-123',
  userId: 'user-123',
  name: 'Nate',
  username: 'nate',
  avatarUrl: 'https://cloud.oxy.so/file-1',
  trustTier: 'trusted',
  personhoodStatus: 'unverified',
  verifiedDomains: ['nate.com'],
  credentialBadges: [],
  issuedAt: 1700000000000,
};

/** Sign `canonicalize(card)` with a fresh keypair and return the sealed attestation. */
async function signCard(card: PublicCard): Promise<{ attestation: ExportAttestation; publicKey: string }> {
  const keyPair = ec.genKeyPair();
  const privateKey = keyPair.getPrivate('hex');
  const publicKey = keyPair.getPublic('hex');
  const signature = await SignatureService.signWithKey(canonicalize(card), privateKey);
  return {
    attestation: {
      issuer: 'did:web:api.oxy.so',
      publicKey,
      alg: 'ES256K-DER-SHA256',
      signature,
      signedAt: 1700000000001,
    },
    publicKey,
  };
}

describe('OxyServices.civic', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;

  beforeEach(() => {
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
    jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue('user-123');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getPublicCard', () => {
    it('GETs /civic/:userId/card (cached) and verifies a genuine Oxy signature', async () => {
      const { attestation } = await signCard(baseCard);
      makeRequestSpy.mockResolvedValue({ card: baseCard, attestation });

      const result = await oxy.getPublicCard('user-123');

      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/civic/user-123/card',
        undefined,
        expect.objectContaining({ cache: true }),
      );
      expect(result.card).toEqual(baseCard);
      expect(result.attestation).toEqual(attestation);
      expect(result.verified).toBe(true);
    });

    it('URL-encodes the userId path segment', async () => {
      makeRequestSpy.mockResolvedValue({ card: baseCard, attestation: null });
      await oxy.getPublicCard('a/b');
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/civic/a%2Fb/card',
        undefined,
        expect.anything(),
      );
    });

    it('returns verified:false (no throw) when the card was tampered after signing', async () => {
      const { attestation } = await signCard(baseCard);
      // Attestation covers the ORIGINAL card; serve a mutated one.
      const tampered: PublicCard = { ...baseCard, name: 'Eve' };
      makeRequestSpy.mockResolvedValue({ card: tampered, attestation });

      const result = await oxy.getPublicCard('user-123');

      expect(result.card).toEqual(tampered);
      expect(result.verified).toBe(false);
    });

    it('returns verified:false (no throw) when the signature is from a different key', async () => {
      const { attestation } = await signCard(baseCard);
      const otherKey = ec.genKeyPair().getPublic('hex');
      const forged: ExportAttestation = { ...attestation, publicKey: otherKey };
      makeRequestSpy.mockResolvedValue({ card: baseCard, attestation: forged });

      const result = await oxy.getPublicCard('user-123');

      expect(result.verified).toBe(false);
    });

    it('returns verified:false (no throw) for an unsigned card (attestation null)', async () => {
      makeRequestSpy.mockResolvedValue({ card: baseCard, attestation: null });

      const result = await oxy.getPublicCard('user-123');

      expect(result.attestation).toBeNull();
      expect(result.verified).toBe(false);
    });

    it('rejects on a transport failure (the fetch itself)', async () => {
      makeRequestSpy.mockRejectedValue(new Error('network down'));
      await expect(oxy.getPublicCard('user-123')).rejects.toThrow();
    });
  });

  describe('verifyPublicCardAttestation (pure helper)', () => {
    it('verifies a genuine signature regardless of wire key order', async () => {
      const { attestation } = await signCard(baseCard);
      // A re-keyed object (different insertion order) must canonicalize identically.
      const reordered: PublicCard = {
        issuedAt: baseCard.issuedAt,
        credentialBadges: baseCard.credentialBadges,
        verifiedDomains: baseCard.verifiedDomains,
        personhoodStatus: baseCard.personhoodStatus,
        trustTier: baseCard.trustTier,
        avatarUrl: baseCard.avatarUrl,
        username: baseCard.username,
        name: baseCard.name,
        userId: baseCard.userId,
        did: baseCard.did,
      };
      await expect(verifyPublicCardAttestation(reordered, attestation)).resolves.toBe(true);
    });

    it('returns false for a null attestation', async () => {
      await expect(verifyPublicCardAttestation(baseCard, null)).resolves.toBe(false);
    });

    it('returns false when signature or publicKey is empty', async () => {
      const empty: ExportAttestation = {
        issuer: 'did:web:api.oxy.so',
        publicKey: '',
        alg: 'ES256K-DER-SHA256',
        signature: '',
        signedAt: 1,
      };
      await expect(verifyPublicCardAttestation(baseCard, empty)).resolves.toBe(false);
    });
  });

  describe('getMyDniPayload', () => {
    it('builds oxydni://card?did=<did>&v=1 for the current user', () => {
      expect(oxy.getMyDniPayload()).toBe('oxydni://card?did=did:web:oxy.so:u:user-123&v=1');
    });

    it('throws when no user is authenticated', () => {
      jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue(null);
      expect(() => oxy.getMyDniPayload()).toThrow(/No authenticated user/);
    });
  });

  describe('parseDniPayload', () => {
    it('round-trips the payload getMyDniPayload produces', () => {
      const payload = oxy.getMyDniPayload();
      expect(parseDniPayload(payload)).toEqual({ did: 'did:web:oxy.so:u:user-123' });
    });

    it('parses a percent-encoded DID', () => {
      const payload = 'oxydni://card?did=did%3Aweb%3Aoxy.so%3Au%3A42&v=1';
      expect(parseDniPayload(payload)).toEqual({ did: 'did:web:oxy.so:u:42' });
    });

    it('tolerates a trailing slash before the query', () => {
      expect(parseDniPayload('oxydni://card/?did=did:web:oxy.so:u:7')).toEqual({
        did: 'did:web:oxy.so:u:7',
      });
    });

    it('rejects a non-DNI scheme', () => {
      expect(parseDniPayload('https://evil.example/card?did=did:web:oxy.so:u:1')).toBeNull();
      expect(parseDniPayload('oxycommons://approve?did=did:web:oxy.so:u:1')).toBeNull();
    });

    it('rejects a DNI payload with no did', () => {
      expect(parseDniPayload('oxydni://card?v=1')).toBeNull();
      expect(parseDniPayload('oxydni://card')).toBeNull();
    });

    it('rejects empty / non-string input', () => {
      expect(parseDniPayload('')).toBeNull();
      expect(parseDniPayload('   ')).toBeNull();
      // Exercise the runtime guard for non-string callers (JS callers / scanners
      // can pass anything) without an `as any` cast or a ts-ignore directive.
      const notAString: unknown = undefined;
      expect(parseDniPayload(notAString as string)).toBeNull();
    });
  });

  // ===========================================================================
  // FASE 2 — real-life attestation
  // ===========================================================================

  describe('buildAttestQrPayload', () => {
    it('builds oxydni://attest with a fresh nonce + 10-min exp for the current user', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('deadbeefnonce');

      const result = await oxy.buildAttestQrPayload({ context: 'payment-42' });

      expect(result.nonce).toBe('deadbeefnonce');
      expect(result.exp).toBe(1700000000000 + 10 * 60 * 1000);
      expect(result.payload).toBe(
        'oxydni://attest?subject=did:web:oxy.so:u:user-123&ctx=payment-42&nonce=deadbeefnonce&exp=1700000600000',
      );
    });

    it('URL-encodes the context so a space / & cannot break the query', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('n1');

      const result = await oxy.buildAttestQrPayload({ context: 'a b&c' });

      expect(result.payload).toContain('&ctx=a%20b%26c&');
      // And it must round-trip back to the original context.
      expect(parseAttestPayload(result.payload)?.context).toBe('a b&c');
    });

    it('throws when no user is authenticated', async () => {
      jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue(null);
      await expect(oxy.buildAttestQrPayload({ context: 'x' })).rejects.toThrow(/No authenticated user/);
    });
  });

  describe('parseAttestPayload', () => {
    it('round-trips a payload built by buildAttestQrPayload', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(SignatureService, 'generateChallenge').mockResolvedValue('abc123');
      const { payload } = await oxy.buildAttestQrPayload({ context: 'ctx-1' });

      expect(parseAttestPayload(payload)).toEqual({
        subjectDid: 'did:web:oxy.so:u:user-123',
        context: 'ctx-1',
        nonce: 'abc123',
        exp: 1700000600000,
      });
    });

    it('defaults context to "" when ctx is omitted', () => {
      expect(parseAttestPayload('oxydni://attest?subject=did:web:oxy.so:u:7&nonce=n&exp=123')).toEqual({
        subjectDid: 'did:web:oxy.so:u:7',
        context: '',
        nonce: 'n',
        exp: 123,
      });
    });

    it('rejects a non-attest scheme, missing fields, and a bad exp', () => {
      expect(parseAttestPayload('oxydni://card?did=did:web:oxy.so:u:1')).toBeNull();
      expect(parseAttestPayload('oxydni://attest?subject=did:web:oxy.so:u:1&exp=1')).toBeNull(); // no nonce
      expect(parseAttestPayload('oxydni://attest?nonce=n&exp=1')).toBeNull(); // no subject
      expect(parseAttestPayload('oxydni://attest?subject=d&nonce=n')).toBeNull(); // no exp
      expect(parseAttestPayload('oxydni://attest?subject=d&nonce=n&exp=notnum')).toBeNull();
      expect(parseAttestPayload('')).toBeNull();
    });
  });

  describe('submitRealLifeAttestation', () => {
    it('signs a self-issued v2 envelope (about=subjectDid) on the caller chain and POSTs it', async () => {
      const signedEnvelope: SignedRecordEnvelope = {
        version: 2,
        type: 'real_life_attestation',
        subject: 'did:web:oxy.so:u:user-123',
        issuer: 'did:web:oxy.so:u:user-123',
        record: {},
        issuedAt: 1700000000000,
        seq: 4,
        prev: 'rec-3',
        collection: 'app.oxy.attestation',
        rkey: 'nonce-xyz',
        publicKey: 'pub',
        alg: 'ES256K-DER-SHA256',
        signature: 'sig',
      };
      const signV2Spy = jest
        .spyOn(SignatureService, 'signRecordV2')
        .mockResolvedValue(signedEnvelope);
      // 1st makeRequest = chain head; 2nd = POST result.
      makeRequestSpy
        .mockResolvedValueOnce({ headRecordId: 'rec-3', seq: 3, recordCount: 4 })
        .mockResolvedValueOnce({
          accepted: true,
          recordId: 'rec-4',
          subjectUserId: 'subject-1',
          attestorUserId: 'user-123',
          points: 25,
        });

      const result = await oxy.submitRealLifeAttestation({
        subjectDid: 'did:web:oxy.so:u:subject-1',
        context: 'payment-42',
        nonce: 'nonce-xyz',
        exp: 1700000600000,
        geohash: 'u4pruyd',
        biometricOk: true,
      });

      // Fetched the caller's chain head first (uncached).
      expect(makeRequestSpy).toHaveBeenNthCalledWith(
        1,
        'GET',
        '/identity/records/user-123/chain/head',
        undefined,
        expect.objectContaining({ cache: false }),
      );
      // Signed a self-issued v2 record: about=subjectDid, seq=head+1, prev=head id,
      // collection app.oxy.attestation, rkey=nonce.
      expect(signV2Spy).toHaveBeenCalledWith(
        'real_life_attestation',
        'did:web:oxy.so:u:user-123',
        {
          about: 'did:web:oxy.so:u:subject-1',
          context: 'payment-42',
          nonce: 'nonce-xyz',
          exp: 1700000600000,
          geohash: 'u4pruyd',
          biometricOk: true,
        },
        { seq: 4, prev: 'rec-3', collection: 'app.oxy.attestation', rkey: 'nonce-xyz' },
      );
      // POSTed the signed envelope to /civic/attestations.
      expect(makeRequestSpy).toHaveBeenNthCalledWith(
        2,
        'POST',
        '/civic/attestations',
        signedEnvelope,
        expect.objectContaining({ cache: false }),
      );
      expect(result.points).toBe(25);
      expect(result.subjectUserId).toBe('subject-1');
    });

    it('omits optional record keys (geohash/biometricOk) when not provided', async () => {
      const signV2Spy = jest
        .spyOn(SignatureService, 'signRecordV2')
        .mockResolvedValue({} as SignedRecordEnvelope);
      makeRequestSpy
        .mockResolvedValueOnce({ headRecordId: null, seq: -1, recordCount: 0 })
        .mockResolvedValueOnce({ accepted: true, recordId: 'r', subjectUserId: 's', attestorUserId: 'user-123', points: 25 });

      await oxy.submitRealLifeAttestation({
        subjectDid: 'did:web:oxy.so:u:s',
        context: 'c',
        nonce: 'n',
        exp: 1700000600000,
      });

      // Genesis chain coords (no head yet) + a record with ONLY the required keys.
      expect(signV2Spy).toHaveBeenCalledWith(
        'real_life_attestation',
        'did:web:oxy.so:u:user-123',
        { about: 'did:web:oxy.so:u:s', context: 'c', nonce: 'n', exp: 1700000600000 },
        { seq: 0, prev: null, collection: 'app.oxy.attestation', rkey: 'n' },
      );
    });

    it('throws when no user is authenticated (before any network)', async () => {
      jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue(null);
      await expect(
        oxy.submitRealLifeAttestation({ subjectDid: 'd', context: 'c', nonce: 'n', exp: 1 }),
      ).rejects.toThrow(/No authenticated user/);
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // FASE 2 — validator / jury
  // ===========================================================================

  describe('getValidatorInbox', () => {
    it('GETs the inbox (uncached) and unwraps requests', async () => {
      const request = {
        id: 'req-1',
        subjectUserId: 'subject-1',
        actionType: 'event_check_in',
        payload: { foo: 'bar' },
        payloadHash: 'hash-1',
        status: 'pending' as const,
        highValue: false,
        expiresAt: '2026-06-27T00:00:00.000Z',
      };
      makeRequestSpy.mockResolvedValue({ requests: [request] });

      const result = await oxy.getValidatorInbox();

      expect(result).toEqual([request]);
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'GET',
        '/civic/validations/inbox',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });

    it('defaults to an empty array when requests is absent', async () => {
      makeRequestSpy.mockResolvedValue({});
      await expect(oxy.getValidatorInbox()).resolves.toEqual([]);
    });
  });

  describe('submitValidationVote', () => {
    it('signs a self-issued verdict envelope bound to requestId+payloadHash and POSTs it', async () => {
      const signedEnvelope: SignedRecordEnvelope = {
        version: 2,
        type: 'validation_verdict',
        subject: 'did:web:oxy.so:u:user-123',
        issuer: 'did:web:oxy.so:u:user-123',
        record: { requestId: 'req-1', payloadHash: 'hash-1', verdict: 'valid' },
        issuedAt: 1700000000000,
        seq: 1,
        prev: 'rec-0',
        collection: 'app.oxy.validation',
        rkey: 'req-1',
        publicKey: 'pub',
        alg: 'ES256K-DER-SHA256',
        signature: 'sig',
      };
      const signV2Spy = jest
        .spyOn(SignatureService, 'signRecordV2')
        .mockResolvedValue(signedEnvelope);
      makeRequestSpy
        .mockResolvedValueOnce({ headRecordId: 'rec-0', seq: 0, recordCount: 1 })
        .mockResolvedValueOnce({ recorded: true, requestId: 'req-1', verdict: 'valid', status: 'quorum_met' });

      const result = await oxy.submitValidationVote('req-1', 'hash-1', 'valid');

      expect(signV2Spy).toHaveBeenCalledWith(
        'validation_verdict',
        'did:web:oxy.so:u:user-123',
        { requestId: 'req-1', payloadHash: 'hash-1', verdict: 'valid' },
        { seq: 1, prev: 'rec-0', collection: 'app.oxy.validation', rkey: 'req-1' },
      );
      expect(makeRequestSpy).toHaveBeenNthCalledWith(
        2,
        'POST',
        '/civic/validations/req-1/vote',
        signedEnvelope,
        expect.objectContaining({ cache: false }),
      );
      expect(result).toEqual({ recorded: true, requestId: 'req-1', verdict: 'valid', status: 'quorum_met' });
    });

    it('throws when no user is authenticated (before any network)', async () => {
      jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue(null);
      await expect(oxy.submitValidationVote('req-1', 'hash-1', 'invalid')).rejects.toThrow(
        /No authenticated user/,
      );
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('denyValidation', () => {
    it('POSTs /civic/validations/:id/deny and returns the verdict', async () => {
      makeRequestSpy.mockResolvedValue({ denied: true });

      const result = await oxy.denyValidation('req-9');

      expect(result).toEqual({ denied: true });
      expect(makeRequestSpy).toHaveBeenCalledWith(
        'POST',
        '/civic/validations/req-9/deny',
        undefined,
        expect.objectContaining({ cache: false }),
      );
    });
  });
});
