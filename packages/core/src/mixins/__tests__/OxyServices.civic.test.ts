/**
 * Civic Mixin tests (Commons "DNI").
 *
 * Stubs `makeRequest` so the tests run with no network, then asserts:
 *  - `getPublicCard` shapes the request (GET `/civic/:userId/card`, cached) and
 *    verifies a GENUINE Oxy signature over `canonicalize(card)` → `verified:true`;
 *  - a tampered card or a signature made with a different key → `verified:false`,
 *    with NO throw (a forged/unsigned card must be visibly untrusted);
 *  - a `null` attestation → `verified:false`, no throw;
 *  - a transport failure still rejects;
 *  - `getMyDniPayload` builds the exact `oxydni://card?did=…&v=1` string and
 *    round-trips through `parseDniPayload`, which rejects garbage.
 *
 * The "genuine" signatures are produced with real secp256k1 keypairs (the same
 * `ES256K-DER-SHA256` scheme the server uses): sign `canonicalize(card)` with a
 * private key, expose its public key on the attestation, and let the SDK verify.
 */

import { ec as EC } from 'elliptic';
import type { ExportAttestation, PublicCard } from '@oxyhq/contracts';
import { OxyServices } from '../../OxyServices';
import { canonicalize } from '../../crypto/canonicalJson';
import { SignatureService } from '../../crypto/signatureService';
import { parseDniPayload, verifyPublicCardAttestation } from '../OxyServices.civic';

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
});
