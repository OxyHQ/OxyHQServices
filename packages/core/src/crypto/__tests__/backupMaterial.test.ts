/**
 * RecoveryPhraseService.deriveBackupMaterial — encrypted off-device backup key
 * schedule (b3 Feature 1).
 *
 * The two outputs are derived from the FULL 64-byte BIP-39 seed via HKDF-SHA256
 * with domain-separated `info` labels. These tests PIN the derivation against a
 * fixed phrase so an accidental algorithm/library/label swap is caught as a
 * regression, and assert the domain separation is real (backup key ≠ lookup id ≠
 * the raw private key, all from the same seed).
 *
 * The fixed phrase is the canonical BIP-39 all-zero-entropy vector
 * ("abandon…about"), whose seed is the published `5eb00bbd…ce9e38e4` — so the
 * pinned outputs below are reproducible from any independent HKDF-SHA256
 * implementation over that seed.
 */
import { RecoveryPhraseService } from '../recoveryPhrase';
import { KeyManager } from '../keyManager';

const FIXED_PHRASE =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Pinned outputs (independently reproducible — see file header).
const EXPECTED_BACKUP_KEY_HEX = 'c6bb29585610550e2667a9d05f35d081f67dd8ccee20a04488c39b25f47a9e74';
const EXPECTED_LOOKUP_ID = '8cad137ca961bfc62a2ef329869e8369777737c7c5353a8d94bb70d888c0ad0d';
// The raw private key = seed[0:32] (the FROZEN phrase→privateKey derivation).
const EXPECTED_PRIVATE_KEY = '5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc1';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('RecoveryPhraseService.deriveBackupMaterial (KDF vectors)', () => {
  it('derives the pinned backupKey + lookupId for the fixed phrase', async () => {
    const { backupKey, lookupId } = await RecoveryPhraseService.deriveBackupMaterial(FIXED_PHRASE);

    expect(backupKey).toBeInstanceOf(Uint8Array);
    expect(backupKey).toHaveLength(32);
    expect(toHex(backupKey)).toBe(EXPECTED_BACKUP_KEY_HEX);

    expect(lookupId).toBe(EXPECTED_LOOKUP_ID);
    expect(lookupId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same phrase → identical material)', async () => {
    const a = await RecoveryPhraseService.deriveBackupMaterial(FIXED_PHRASE);
    const b = await RecoveryPhraseService.deriveBackupMaterial(FIXED_PHRASE);
    expect(toHex(a.backupKey)).toBe(toHex(b.backupKey));
    expect(a.lookupId).toBe(b.lookupId);
  });

  it('normalizes case/whitespace like the other phrase helpers', async () => {
    const messy = `  ${FIXED_PHRASE.toUpperCase()}  `;
    const { backupKey, lookupId } = await RecoveryPhraseService.deriveBackupMaterial(messy);
    expect(toHex(backupKey)).toBe(EXPECTED_BACKUP_KEY_HEX);
    expect(lookupId).toBe(EXPECTED_LOOKUP_ID);
  });

  it('enforces real domain separation (backupKey ≠ lookupId ≠ raw private key)', async () => {
    const { backupKey, lookupId } = await RecoveryPhraseService.deriveBackupMaterial(FIXED_PHRASE);
    const privateKey = await RecoveryPhraseService.derivePrivateKeyFromPhrase(FIXED_PHRASE);

    // Sanity: the frozen phrase→privateKey path is unchanged.
    expect(privateKey).toBe(EXPECTED_PRIVATE_KEY);

    // The three derivations from the SAME seed are mutually distinct — a device
    // compromise leaking only the 32-byte private key reveals nothing about the
    // backup key or lookup id (both need the full 64-byte seed).
    expect(toHex(backupKey)).not.toBe(lookupId);
    expect(toHex(backupKey)).not.toBe(privateKey);
    expect(lookupId).not.toBe(privateKey);
  });

  it('produces a valid signing key material that is NOT the backup key', async () => {
    // Extra guard: the backupKey must never coincide with a usable identity key
    // for this phrase.
    const { backupKey } = await RecoveryPhraseService.deriveBackupMaterial(FIXED_PHRASE);
    const privateKey = await RecoveryPhraseService.derivePrivateKeyFromPhrase(FIXED_PHRASE);
    const publicKey = KeyManager.derivePublicKey(privateKey);
    expect(publicKey).toMatch(/^04[0-9a-f]+$/);
    expect(toHex(backupKey)).not.toBe(privateKey);
  });

  it('rejects an invalid recovery phrase', async () => {
    await expect(RecoveryPhraseService.deriveBackupMaterial('not a real phrase')).rejects.toThrow(
      /Invalid recovery phrase/,
    );
  });
});
