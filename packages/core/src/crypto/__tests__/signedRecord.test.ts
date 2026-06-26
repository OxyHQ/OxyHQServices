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
import { SignatureService, signedRecordSigningInput, computeRecordId } from '../signatureService';
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

/**
 * Critical regression guard: the v1 signing input MUST be byte-identical to the
 * original scheme. Every `identity`/`profile` record already in production was
 * signed over exactly these bytes, so any change to {@link signedRecordSigningInput}
 * for v1 would invalidate them all. This locks the exact canonical string.
 */
describe('signedRecordSigningInput — v1 byte stability (regression guard)', () => {
  it('produces the exact original canonical bytes for a v1 record', () => {
    const input = signedRecordSigningInput({
      version: 1,
      type: 'identity',
      subject: 'did:web:oxy.so:u:u1',
      issuer: 'did:web:oxy.so:u:u1',
      record: { handle: '@nate' },
      issuedAt: 1750000000000,
    });
    expect(input).toBe(
      '{"issuedAt":1750000000000,"issuer":"did:web:oxy.so:u:u1","record":{"handle":"@nate"},"subject":"did:web:oxy.so:u:u1","type":"identity","version":1}',
    );
  });

  it('does NOT include any v2 chain fields for a v1 record even if they are passed', () => {
    const input = signedRecordSigningInput({
      version: 1,
      type: 'identity',
      subject: 'did:web:oxy.so:u:u1',
      issuer: 'did:web:oxy.so:u:u1',
      record: { handle: '@nate' },
      issuedAt: 1750000000000,
      // These must be ignored by the v1 branch — proving v1 bytes are immutable.
      seq: 5,
      prev: 'deadbeef',
      collection: 'app.oxy.identity',
      rkey: 'self',
    });
    expect(input).not.toContain('seq');
    expect(input).not.toContain('prev');
    expect(input).not.toContain('collection');
    expect(input).not.toContain('rkey');
    expect(input).toBe(
      '{"issuedAt":1750000000000,"issuer":"did:web:oxy.so:u:u1","record":{"handle":"@nate"},"subject":"did:web:oxy.so:u:u1","type":"identity","version":1}',
    );
  });
});

describe('SignatureService.signRecordV2 / verifyRecord (v2 hash chain)', () => {
  const keyPair = ec.genKeyPair();
  const publicKey = keyPair.getPublic('hex');

  beforeEach(() => {
    jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(publicKey);
    jest.spyOn(KeyManager, 'getKeyPairObject').mockResolvedValue(keyPair);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const chain = {
    seq: 0,
    prev: null as string | null,
    collection: 'app.oxy.reputation',
    rkey: 'rt_1',
  };

  it('builds a well-formed v2 envelope carrying the chain fields', async () => {
    const subject = 'did:web:oxy.so:u:abc123';
    const envelope = await SignatureService.signRecordV2(
      'reputation_attestation',
      subject,
      { points: 25 },
      chain,
    );

    expect(envelope.version).toBe(2);
    expect(envelope.type).toBe('reputation_attestation');
    expect(envelope.subject).toBe(subject);
    expect(envelope.issuer).toBe(subject); // self-issued
    expect(envelope.seq).toBe(0);
    expect(envelope.prev).toBeNull();
    expect(envelope.collection).toBe('app.oxy.reputation');
    expect(envelope.rkey).toBe('rt_1');
    expect(envelope.publicKey).toBe(publicKey);
    expect(envelope.alg).toBe('ES256K-DER-SHA256');
    expect(typeof envelope.signature).toBe('string');
  });

  it('round-trips: a freshly signed v2 record verifies', async () => {
    const envelope = await SignatureService.signRecordV2(
      'validation_verdict',
      'did:web:oxy.so:u:v1',
      { verdict: 'approve' },
      { seq: 3, prev: 'a'.repeat(64), collection: 'app.oxy.validation', rkey: 'req_9' },
    );
    await expect(SignatureService.verifyRecord(envelope)).resolves.toBe(true);
  });

  it('covers the chain fields in the signed bytes (tampering breaks verify)', async () => {
    const envelope = await SignatureService.signRecordV2(
      'reputation_attestation',
      'did:web:oxy.so:u:t1',
      { points: 8 },
      chain,
    );

    await expect(
      SignatureService.verifyRecord({ ...envelope, seq: 1 }),
    ).resolves.toBe(false);
    await expect(
      SignatureService.verifyRecord({ ...envelope, prev: 'b'.repeat(64) }),
    ).resolves.toBe(false);
    await expect(
      SignatureService.verifyRecord({ ...envelope, collection: 'app.evil' }),
    ).resolves.toBe(false);
    await expect(
      SignatureService.verifyRecord({ ...envelope, rkey: 'other' }),
    ).resolves.toBe(false);
  });

  it('a v2 envelope signs over DIFFERENT bytes than the same base fields as v1', async () => {
    const subject = 'did:web:oxy.so:u:diff';
    const record = { x: 1 };
    const v2 = await SignatureService.signRecordV2('profile', subject, record, chain);

    const v1Input = signedRecordSigningInput({
      version: 1,
      type: 'profile',
      subject,
      issuer: subject,
      record,
      issuedAt: v2.issuedAt,
    });
    const v2Input = signedRecordSigningInput(v2);
    expect(v2Input).not.toBe(v1Input);
    expect(v2Input).toContain('"seq":0');
    expect(v2Input).toContain('"prev":null');
    expect(v2Input).toContain('"collection":"app.oxy.reputation"');
  });

  it('throws when no identity is stored', async () => {
    jest.spyOn(KeyManager, 'getPublicKey').mockResolvedValue(null);
    await expect(
      SignatureService.signRecordV2('identity', 'did:web:oxy.so:u:u4', {}, chain),
    ).rejects.toThrow(/No identity found/);
  });
});

describe('computeRecordId — deterministic content address', () => {
  const base: SignedRecordEnvelope = {
    version: 2,
    type: 'reputation_attestation',
    subject: 'did:web:oxy.so:u:rid',
    issuer: 'did:web:oxy.so',
    record: { points: 25 },
    issuedAt: 1750000000000,
    seq: 0,
    prev: null,
    collection: 'app.oxy.reputation',
    rkey: 'rt_1',
    publicKey: '03oxykey',
    alg: 'ES256K-DER-SHA256',
    signature: 'sig-is-not-part-of-the-id',
  };

  it('is a 64-char lowercase hex SHA-256 digest', async () => {
    const id = await computeRecordId(base);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical signing fields', async () => {
    const a = await computeRecordId(base);
    const b = await computeRecordId(base);
    expect(a).toBe(b);
  });

  it('equals sha256 of the canonical signing input (content address, excludes publicKey/signature)', async () => {
    const id = await computeRecordId(base);
    const expected = await SignatureService.hashMessage(signedRecordSigningInput(base));
    expect(id).toBe(expected);
    // Changing only signature/publicKey does NOT change the recordId.
    const sameId = await computeRecordId({
      ...base,
      signature: 'totally-different',
      publicKey: 'different-key',
    });
    expect(sameId).toBe(id);
  });

  it('changes when any signed field changes', async () => {
    const id = await computeRecordId(base);
    expect(await computeRecordId({ ...base, seq: 1 })).not.toBe(id);
    expect(await computeRecordId({ ...base, record: { points: 26 } })).not.toBe(id);
    expect(await computeRecordId({ ...base, prev: 'a'.repeat(64) })).not.toBe(id);
  });

  it('a v1 record and a v2 record with the same base fields have different recordIds', async () => {
    const v1Id = await computeRecordId({
      version: 1,
      type: 'profile',
      subject: 'did:web:oxy.so:u:rid',
      issuer: 'did:web:oxy.so:u:rid',
      record: { points: 25 },
      issuedAt: 1750000000000,
    });
    const v2Id = await computeRecordId({
      version: 2,
      type: 'profile',
      subject: 'did:web:oxy.so:u:rid',
      issuer: 'did:web:oxy.so:u:rid',
      record: { points: 25 },
      issuedAt: 1750000000000,
      seq: 0,
      prev: null,
      collection: 'app.oxy.profile',
      rkey: 'self',
    });
    expect(v1Id).not.toBe(v2Id);
  });
});
