/**
 * RecoveryPhraseService — pure, non-persisting derivation helpers (b3 rotation).
 *
 * `derivePendingIdentity()` and `derivePrivateKeyFromPhrase()` must produce
 * valid, self-consistent key material WITHOUT touching secure storage — the
 * whole point of a "pending" identity is that nothing is committed until an
 * external step (a server-confirmed key rotation) succeeds.
 */

import { RecoveryPhraseService } from '../recoveryPhrase';
import { KeyManager } from '../keyManager';

describe('RecoveryPhraseService.derivePendingIdentity (non-persisting)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('produces a valid 12-word phrase whose privateKey derives the returned publicKey', async () => {
    const pending = await RecoveryPhraseService.derivePendingIdentity();

    expect(RecoveryPhraseService.validatePhrase(pending.phrase)).toBe(true);
    expect(pending.words).toHaveLength(12);
    expect(pending.words.join(' ')).toBe(pending.phrase);

    // The private key is a canonical 64-hex-char secp256k1 scalar…
    expect(pending.privateKey).toMatch(/^[0-9a-f]{64}$/);
    // …and it deterministically derives the returned public key.
    expect(KeyManager.derivePublicKey(pending.privateKey)).toBe(pending.publicKey);
  });

  it('does NOT persist anything to secure storage (never imports a key pair)', async () => {
    const importSpy = jest.spyOn(KeyManager, 'importKeyPair');
    const createSpy = jest.spyOn(KeyManager, 'createIdentity');

    await RecoveryPhraseService.derivePendingIdentity();

    expect(importSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('yields a distinct identity on each call', async () => {
    const a = await RecoveryPhraseService.derivePendingIdentity();
    const b = await RecoveryPhraseService.derivePendingIdentity();
    expect(a.phrase).not.toBe(b.phrase);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it('derivePrivateKeyFromPhrase round-trips: same phrase → same private/public key', async () => {
    const pending = await RecoveryPhraseService.derivePendingIdentity();

    const rederivedPrivate = await RecoveryPhraseService.derivePrivateKeyFromPhrase(pending.phrase);
    expect(rederivedPrivate).toBe(pending.privateKey);
    expect(KeyManager.derivePublicKey(rederivedPrivate)).toBe(pending.publicKey);
  });

  it('derivePrivateKeyFromPhrase rejects an invalid mnemonic', async () => {
    await expect(
      RecoveryPhraseService.derivePrivateKeyFromPhrase('not a real recovery phrase at all'),
    ).rejects.toThrow(/Invalid recovery phrase/);
  });
});
