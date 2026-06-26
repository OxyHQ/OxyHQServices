/**
 * Signed-record envelope tests.
 *
 * Exercises the full client-side path: `SignatureService.signRecord` builds an
 * envelope whose signature covers the canonical JSON of every field EXCEPT
 * `publicKey`/`signature`, and `SignatureService.verifyRecord` round-trips it.
 * We mock `KeyManager`'s key access with a REAL elliptic secp256k1 keypair, so
 * the signing/verification is genuine cryptography (not a stub).
 */

import { ec as EC } from 'elliptic';
import type { SignedRecordEnvelope } from '@oxyhq/contracts';
import { KeyManager } from '../keyManager';
import { SignatureService, signedRecordSigningInput } from '../signatureService';
import { canonicalize } from '../canonicalJson';

const ec = new EC('secp256k1');

describe('SignatureService.signRecord / verifyRecord', () => {
  const keyPair = ec.genKeyPair();
  const publicKey = keyPair.getPublic('hex');

  beforeEach(() => {
    jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(publicKey);
    jest.spyOn(KeyManager, 'getKeyPairObject').mockResolvedValue(keyPair);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('builds a well-formed self-issued envelope', async () => {
    const subject = 'did:web:oxy.so:u:abc123';
    const record = { displayName: 'Nate', bio: 'builder' };

    const envelope = await SignatureService.signRecord('profile', subject, record);

    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe('profile');
    expect(envelope.subject).toBe(subject);
    expect(envelope.issuer).toBe(subject); // self-issued
    expect(envelope.record).toEqual(record);
    expect(envelope.publicKey).toBe(publicKey);
    expect(envelope.alg).toBe('ES256K-DER-SHA256');
    expect(typeof envelope.signature).toBe('string');
    expect(envelope.signature.length).toBeGreaterThan(0);
    expect(typeof envelope.issuedAt).toBe('number');
  });

  it('round-trips: a freshly signed record verifies', async () => {
    const envelope = await SignatureService.signRecord('identity', 'did:web:oxy.so:u:u1', {
      handle: '@nate',
      nested: { a: 1, b: [2, 3] },
    });
    await expect(SignatureService.verifyRecord(envelope)).resolves.toBe(true);
  });

  it('signs the canonical JSON of every field except publicKey + signature', async () => {
    const subject = 'did:web:oxy.so:u:u2';
    const record = { z: 1, a: 2 };
    const envelope = await SignatureService.signRecord('profile', subject, record);

    const expectedInput = canonicalize({
      version: envelope.version,
      type: envelope.type,
      subject: envelope.subject,
      issuer: envelope.issuer,
      record: envelope.record,
      issuedAt: envelope.issuedAt,
    });

    // The helper reproduces exactly that input from the envelope.
    expect(signedRecordSigningInput(envelope)).toBe(expectedInput);
    // And it omits publicKey/signature.
    expect(expectedInput).not.toContain(envelope.publicKey);
    expect(expectedInput).not.toContain(envelope.signature);

    // The signature verifies against that exact input + the embedded key.
    await expect(
      SignatureService.verify(expectedInput, envelope.signature, envelope.publicKey),
    ).resolves.toBe(true);
  });

  describe('tamper detection', () => {
    let envelope: SignedRecordEnvelope;

    beforeEach(async () => {
      envelope = await SignatureService.signRecord('profile', 'did:web:oxy.so:u:u3', {
        displayName: 'Original',
        score: 10,
      });
    });

    it('rejects a mutated record', async () => {
      const tampered: SignedRecordEnvelope = {
        ...envelope,
        record: { ...envelope.record, displayName: 'Tampered' },
      };
      await expect(SignatureService.verifyRecord(tampered)).resolves.toBe(false);
    });

    it('rejects a changed subject', async () => {
      const tampered: SignedRecordEnvelope = { ...envelope, subject: 'did:web:oxy.so:u:evil' };
      await expect(SignatureService.verifyRecord(tampered)).resolves.toBe(false);
    });

    it('rejects a changed issuedAt', async () => {
      const tampered: SignedRecordEnvelope = { ...envelope, issuedAt: envelope.issuedAt + 1 };
      await expect(SignatureService.verifyRecord(tampered)).resolves.toBe(false);
    });

    it('rejects verification against an unrelated public key', async () => {
      const otherKey = ec.genKeyPair().getPublic('hex');
      const tampered: SignedRecordEnvelope = { ...envelope, publicKey: otherKey };
      await expect(SignatureService.verifyRecord(tampered)).resolves.toBe(false);
    });
  });

  it('throws when no identity is stored', async () => {
    jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(null);
    await expect(
      SignatureService.signRecord('identity', 'did:web:oxy.so:u:u4', {}),
    ).rejects.toThrow(/No identity found/);
  });
});
