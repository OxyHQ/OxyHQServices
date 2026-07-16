/**
 * Key-rotation mixin tests (b3 Feature 3).
 *
 * Cover the client orchestration of `oxy.identity.rotateKey(...)`:
 *  - the EXACT signed rotation payload (must match the server's reconstruction
 *    byte-for-byte);
 *  - device-proof signs with the on-device key; phrase-proof re-derives and
 *    signs with the OLD key (proving the last credential can be replaced);
 *  - the safety ordering (local key persisted ONLY after server confirmation);
 *  - the ambiguous-network-failure reconciliation against the DID document.
 *
 * `makeRequest` is stubbed so the tests run with no network. The real
 * secp256k1 signing runs in the phrase-proof test so we can cryptographically
 * assert which key produced the signature.
 */

import type { DidDocument } from '@oxyhq/contracts';
import { verifySignature } from '@oxyhq/protocol';
import { OxyServices } from '../../OxyServices';
import { KeyManager } from '../../crypto/keyManager';
import { SignatureService } from '../../crypto/signatureService';
import { RecoveryPhraseService } from '../../crypto/recoveryPhrase';
import { setPlatformOS } from '../../utils/platform';

const OLD_PUBLIC = 'oldpub-hex';
const NEW_PUBLIC = 'newpub-hex';

const pendingFixture = {
  phrase: 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima',
  words: ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima'],
  privateKey: 'newpriv-hex',
  publicKey: NEW_PUBLIC,
};

function didDocWithKey(publicKeyHex: string): DidDocument {
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: 'did:web:oxy.so:u:user-123',
    controller: ['did:web:oxy.so:u:user-123', 'did:web:oxy.so'],
    verificationMethod: [
      {
        id: 'did:web:oxy.so:u:user-123#key-1',
        type: 'EcdsaSecp256k1VerificationKey2019',
        controller: 'did:web:oxy.so:u:user-123',
        publicKeyHex,
      },
    ],
    authentication: ['did:web:oxy.so:u:user-123#key-1'],
    assertionMethod: ['did:web:oxy.so:u:user-123#key-1'],
    alsoKnownAs: [],
    service: [],
  };
}

describe('OxyServices.rotateKey', () => {
  let oxy: OxyServices;
  let makeRequestSpy: jest.SpyInstance;
  let clearEntrySpy: jest.SpyInstance;

  beforeEach(() => {
    setPlatformOS('ios'); // native → the new key is persisted locally after success
    oxy = new OxyServices({ baseURL: 'http://test.invalid' });
    makeRequestSpy = jest.spyOn(oxy, 'makeRequest');
    jest.spyOn(oxy, 'clearCacheByPrefix').mockReturnValue(0);
    clearEntrySpy = jest.spyOn(oxy, 'clearCacheEntry').mockReturnValue(undefined);
    jest.spyOn(oxy, 'getCurrentUserId').mockReturnValue('user-123');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('device proof', () => {
    it('signs the exact rotation payload, POSTs challenge→complete, then persists the new key locally', async () => {
      jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(OLD_PUBLIC);
      const signSpy = jest.spyOn(SignatureService, 'sign').mockResolvedValue('sig-hex');
      const importSpy = jest.spyOn(KeyManager, 'importKeyPair').mockResolvedValue(NEW_PUBLIC);
      makeRequestSpy
        .mockResolvedValueOnce({ challenge: 'chal-1', expiresAt: '2999-01-01T00:00:00.000Z' })
        .mockResolvedValueOnce({ success: true, publicKey: NEW_PUBLIC, message: 'ok' });

      const result = await oxy.rotateKey({ proof: 'device' });

      expect(result).toEqual({ newPublicKey: NEW_PUBLIC, newPhrase: pendingFixture.phrase, words: pendingFixture.words });

      // The signed message MUST match the server's reconstruction byte-for-byte.
      const expectedMessage = JSON.stringify({
        action: 'rotate_key',
        userId: 'user-123',
        oldPublicKey: OLD_PUBLIC,
        newPublicKey: NEW_PUBLIC,
        challenge: 'chal-1',
        timestamp: 1700000000000,
      });
      expect(signSpy).toHaveBeenCalledWith(expectedMessage);

      expect(makeRequestSpy).toHaveBeenNthCalledWith(1, 'POST', '/auth/rotate/challenge', undefined, expect.objectContaining({ cache: false }));
      expect(makeRequestSpy).toHaveBeenNthCalledWith(
        2,
        'POST',
        '/auth/rotate/complete',
        { newPublicKey: NEW_PUBLIC, challenge: 'chal-1', signature: 'sig-hex', timestamp: 1700000000000 },
        expect.objectContaining({ cache: false }),
      );

      // Persisted ONLY after the server confirmed the swap.
      expect(importSpy).toHaveBeenCalledWith('newpriv-hex', { overwrite: true });
      // DID + auth-method caches are swept.
      expect(clearEntrySpy).toHaveBeenCalledWith('GET:/u/user-123/did.json');
      expect(clearEntrySpy).toHaveBeenCalledWith('GET:/auth/methods');
    });

    it('forwards signOutEverywhere in the complete body', async () => {
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(OLD_PUBLIC);
      jest.spyOn(SignatureService, 'sign').mockResolvedValue('sig-hex');
      jest.spyOn(KeyManager, 'importKeyPair').mockResolvedValue(NEW_PUBLIC);
      makeRequestSpy
        .mockResolvedValueOnce({ challenge: 'chal-1', expiresAt: '2999-01-01T00:00:00.000Z' })
        .mockResolvedValueOnce({ success: true, publicKey: NEW_PUBLIC, message: 'ok' });

      await oxy.rotateKey({ proof: 'device', signOutEverywhere: true });

      expect(makeRequestSpy).toHaveBeenNthCalledWith(
        2,
        'POST',
        '/auth/rotate/complete',
        expect.objectContaining({ signOutEverywhere: true }),
        expect.anything(),
      );
    });

    it('throws (no network) when the device holds no identity', async () => {
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(null);

      await expect(oxy.rotateKey({ proof: 'device' })).rejects.toThrow(/No on-device identity/);
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('phrase proof (replace the LAST credential)', () => {
    it('re-derives the CURRENT key from the entered phrase and signs the proof with it', async () => {
      // A real "current" identity whose phrase the user re-enters, and a real new one.
      const current = await RecoveryPhraseService.derivePendingIdentity();
      const next = await RecoveryPhraseService.derivePendingIdentity();
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(next);
      jest.spyOn(KeyManager, 'importKeyPair').mockResolvedValue(next.publicKey);

      let completeBody: Record<string, unknown> | undefined;
      makeRequestSpy.mockImplementation((_m: string, path: string, body?: unknown) => {
        if (path === '/auth/rotate/challenge') return Promise.resolve({ challenge: 'chal-x', expiresAt: '2999-01-01T00:00:00.000Z' });
        if (path === '/auth/rotate/complete') {
          completeBody = body as Record<string, unknown>;
          return Promise.resolve({ success: true, publicKey: next.publicKey, message: 'ok' });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      });

      const result = await oxy.rotateKey({ proof: 'phrase', phrase: current.phrase });
      expect(result.newPublicKey).toBe(next.publicKey);

      // The signature MUST verify against the OLD key over the exact reconstructed message.
      const message = JSON.stringify({
        action: 'rotate_key',
        userId: 'user-123',
        oldPublicKey: current.publicKey,
        newPublicKey: next.publicKey,
        challenge: 'chal-x',
        timestamp: completeBody?.timestamp,
      });
      expect(await verifySignature(message, completeBody?.signature as string, current.publicKey)).toBe(true);
      // …and must NOT verify against the new key (proves it was signed by the current key).
      expect(await verifySignature(message, completeBody?.signature as string, next.publicKey)).toBe(false);
    });

    it('throws when proof is phrase but no phrase is supplied', async () => {
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      await expect(oxy.rotateKey({ proof: 'phrase' })).rejects.toThrow(/recovery phrase is required/);
      expect(makeRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe('ambiguous network failure', () => {
    it('reconciles a lost complete-response against the DID and treats a landed swap as done', async () => {
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(OLD_PUBLIC);
      jest.spyOn(SignatureService, 'sign').mockResolvedValue('sig-hex');
      const importSpy = jest.spyOn(KeyManager, 'importKeyPair').mockResolvedValue(NEW_PUBLIC);
      makeRequestSpy
        .mockResolvedValueOnce({ challenge: 'chal-1', expiresAt: '2999-01-01T00:00:00.000Z' })
        .mockRejectedValueOnce(new Error('network lost'))
        .mockResolvedValueOnce(didDocWithKey(NEW_PUBLIC)); // DID already advertises the new key

      const result = await oxy.rotateKey({ proof: 'device' });

      expect(result.newPublicKey).toBe(NEW_PUBLIC);
      expect(makeRequestSpy).toHaveBeenNthCalledWith(3, 'GET', '/u/user-123/did.json', undefined, expect.objectContaining({ cache: false }));
      // The swap landed server-side, so the new key is persisted locally.
      expect(importSpy).toHaveBeenCalledWith('newpriv-hex', { overwrite: true });
    });

    it('surfaces the error and does NOT persist locally when the DID shows the swap did not land', async () => {
      jest.spyOn(RecoveryPhraseService, 'derivePendingIdentity').mockResolvedValue(pendingFixture);
      jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(OLD_PUBLIC);
      jest.spyOn(SignatureService, 'sign').mockResolvedValue('sig-hex');
      const importSpy = jest.spyOn(KeyManager, 'importKeyPair').mockResolvedValue(NEW_PUBLIC);
      makeRequestSpy
        .mockResolvedValueOnce({ challenge: 'chal-1', expiresAt: '2999-01-01T00:00:00.000Z' })
        .mockRejectedValueOnce(new Error('network lost'))
        .mockResolvedValueOnce(didDocWithKey(OLD_PUBLIC)); // DID still shows the OLD key

      await expect(oxy.rotateKey({ proof: 'device' })).rejects.toBeDefined();
      expect(importSpy).not.toHaveBeenCalled();
    });
  });
});
