import { oxySignedRecordTypeSchema, signedRecordEnvelopeSchema } from '../index';
import type { OxySignedRecordType, SignedRecordEnvelope } from '../index';

/**
 * The base `signedRecordEnvelopeSchema` is now OPEN on `type` (any app may sign
 * its own records on the shared grammar); the Oxy store re-narrows with
 * `oxySignedRecordTypeSchema`. These tests lock the "open base, strict store"
 * contract — the single coordination point that unblocks app records while
 * keeping the Oxy chain strict.
 */
describe('oxySignedRecordTypeSchema (Oxy store re-narrowing)', () => {
    const oxyTypes: OxySignedRecordType[] = [
        'identity',
        'profile',
        'reputation_attestation',
        'real_life_attestation',
        'validation_verdict',
        'personhood_vouch',
        'credential',
        'node',
    ];

    it('accepts every Oxy record type', () => {
        for (const type of oxyTypes) {
            expect(oxySignedRecordTypeSchema.safeParse(type).success).toBe(true);
        }
    });

    it('rejects a non-Oxy app record type, a bogus type, and an empty string', () => {
        expect(oxySignedRecordTypeSchema.safeParse('app_record').success).toBe(false);
        expect(oxySignedRecordTypeSchema.safeParse('foobar').success).toBe(false);
        expect(oxySignedRecordTypeSchema.safeParse('').success).toBe(false);
    });

    it('exposes the closed set as the single source of truth (8 values, .options)', () => {
        expect([...oxySignedRecordTypeSchema.options]).toEqual(oxyTypes);
    });

    it('the base envelope ACCEPTS what the Oxy store REJECTS (open base, strict store)', () => {
        const appRecordEnvelope: SignedRecordEnvelope = {
            version: 2,
            type: 'app_record',
            subject: 'did:web:oxy.so:u:507f1f77bcf86cd799439011',
            issuer: 'did:web:oxy.so:u:507f1f77bcf86cd799439011',
            record: { text: 'hello from mention' },
            issuedAt: 1750000000000,
            seq: 0,
            prev: null,
            collection: 'app.mention.feed.post',
            rkey: 'post_1',
            publicKey: '02a1b2c3',
            alg: 'ES256K-DER-SHA256',
            signature: '3045...',
        };

        // The base grammar accepts the app record on the shared envelope...
        expect(signedRecordEnvelopeSchema.safeParse(appRecordEnvelope).success).toBe(true);
        // ...but the Oxy store would reject its `type` (it is not an Oxy category).
        expect(oxySignedRecordTypeSchema.safeParse(appRecordEnvelope.type).success).toBe(false);
    });
});
