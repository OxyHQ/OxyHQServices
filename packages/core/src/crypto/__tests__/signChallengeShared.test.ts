/**
 * `signChallengeWithSharedKey` tests.
 *
 * Verifies the shared-key challenge signer mirrors `signChallenge` exactly —
 * same `auth:${publicKey}:${challenge}:${timestamp}` message format so the
 * server verification path is unchanged — but sources the SHARED key from
 * `KeyManager` (not the primary device key). We mock the shared key access with
 * a REAL elliptic secp256k1 keypair so signing/verification is genuine.
 */

import { ec as EC } from 'elliptic';
import { verifySignature } from '@oxyhq/protocol';
import { KeyManager } from '../keyManager';
import { SignatureService } from '../signatureService';

const ec = new EC('secp256k1');

describe('SignatureService.signChallengeWithSharedKey', () => {
  const sharedKeyPair = ec.genKeyPair();
  const sharedPublicKey = sharedKeyPair.getPublic('hex');
  const sharedPrivateKey = sharedKeyPair.getPrivate('hex');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('signs with the shared key and uses the unchanged message format', async () => {
    jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue(sharedPublicKey);
    jest.spyOn(KeyManager, 'getSharedPrivateKey').mockResolvedValue(sharedPrivateKey);
    // Guard: it must NOT fall back to the primary device key.
    const primarySpy = jest.spyOn(KeyManager, 'getPublicKey');

    const result = await SignatureService.signChallengeWithSharedKey('chal-123');

    expect(result.publicKey).toBe(sharedPublicKey);
    expect(typeof result.challenge).toBe('string'); // the signature
    expect(typeof result.timestamp).toBe('number');
    expect(primarySpy).not.toHaveBeenCalled();

    // The signature verifies against the SAME message format `signChallenge`
    // uses, proving the format is unchanged and the shared key signed it.
    const message = `auth:${sharedPublicKey}:chal-123:${result.timestamp}`;
    await expect(
      verifySignature(message, result.challenge, sharedPublicKey),
    ).resolves.toBe(true);
  });

  it('throws when no shared identity exists', async () => {
    jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue(null);
    jest.spyOn(KeyManager, 'getSharedPrivateKey').mockResolvedValue(null);

    await expect(
      SignatureService.signChallengeWithSharedKey('chal-123'),
    ).rejects.toThrow(/No shared identity/);
  });

  it('throws when the shared private key is missing even if the public key is present', async () => {
    jest.spyOn(KeyManager, 'getSharedPublicKey').mockResolvedValue(sharedPublicKey);
    jest.spyOn(KeyManager, 'getSharedPrivateKey').mockResolvedValue(null);

    await expect(
      SignatureService.signChallengeWithSharedKey('chal-123'),
    ).rejects.toThrow(/No shared identity/);
  });
});
