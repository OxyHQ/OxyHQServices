/**
 * Recovery Phrase Service - BIP39 Mnemonic Generation
 * 
 * Handles generation and restoration of recovery phrases (mnemonic seeds)
 * for backing up and restoring user identities.
 * 
 * Note: This module requires the polyfill to be loaded first (done via crypto/index.ts)
 */

import * as bip39 from 'bip39';
import { KeyManager } from './keyManager';

/**
 * Convert Uint8Array or array-like to hexadecimal string
 * Works in both Node.js and React Native without depending on Buffer
 */
function toHex(data: Uint8Array | ArrayLike<number>): string {
  // Convert to array of numbers if needed
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface RecoveryPhraseResult {
  phrase: string;
  words: string[];
  publicKey: string;
}

export interface GenerateIdentityOptions {
  /**
   * Pass `true` to allow overwriting an existing on-device identity.
   *
   * Defaults to `false`. When false, this method throws
   * `IdentityAlreadyExistsError` if a complete identity already exists,
   * preventing accidental account loss. UI flows MUST only set this to
   * `true` after explicitly confirming the user has saved their previous
   * recovery phrase (or has otherwise been warned).
   */
  overwrite?: boolean;
}

export class RecoveryPhraseService {
  /**
   * Generate a new identity with a recovery phrase.
   * The mnemonic phrase MUST be shown to the user exactly once after this
   * call resolves — if it is lost, the account becomes unrecoverable.
   *
   * Refuses to overwrite an existing identity unless `options.overwrite === true`.
   *
   * @throws IdentityAlreadyExistsError if an identity already exists and overwrite is not set
   */
  static async generateIdentityWithRecovery(
    options?: GenerateIdentityOptions,
  ): Promise<RecoveryPhraseResult> {
    // Generate 128-bit entropy for 12-word mnemonic
    const mnemonic = bip39.generateMnemonic(128);

    // Derive private key from mnemonic
    // Using the seed directly as the private key (simplified approach)
    const seed = await bip39.mnemonicToSeed(mnemonic);

    // Use first 32 bytes of seed as private key
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);

    // Import the derived key pair. KeyManager.importKeyPair will refuse to
    // clobber an existing identity unless overwrite is explicitly requested.
    const publicKey = await KeyManager.importKeyPair(privateKeyHex, {
      overwrite: options?.overwrite === true,
    });

    return {
      phrase: mnemonic,
      words: mnemonic.split(' '),
      publicKey,
    };
  }

  /**
   * Generate a 24-word recovery phrase for higher security.
   *
   * Same overwrite-protection semantics as `generateIdentityWithRecovery`.
   */
  static async generateIdentityWithRecovery24(
    options?: GenerateIdentityOptions,
  ): Promise<RecoveryPhraseResult> {
    // Generate 256-bit entropy for 24-word mnemonic
    const mnemonic = bip39.generateMnemonic(256);

    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);
    const publicKey = await KeyManager.importKeyPair(privateKeyHex, {
      overwrite: options?.overwrite === true,
    });

    return {
      phrase: mnemonic,
      words: mnemonic.split(' '),
      publicKey,
    };
  }

  /**
   * Restore an identity from a recovery phrase.
   *
   * Refuses to overwrite a DIFFERENT existing identity unless
   * `options.overwrite === true`. Re-importing the same phrase that
   * matches the current identity is always allowed (it's a no-op refresh
   * of the backup record).
   */
  static async restoreFromPhrase(
    phrase: string,
    options?: GenerateIdentityOptions,
  ): Promise<string> {
    // Normalize and validate the phrase
    const normalizedPhrase = phrase.trim().toLowerCase();

    if (!bip39.validateMnemonic(normalizedPhrase)) {
      throw new Error('Invalid recovery phrase. Please check the words and try again.');
    }

    // Derive the same private key from the mnemonic
    const seed = await bip39.mnemonicToSeed(normalizedPhrase);
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);

    // Import and store the key pair
    const publicKey = await KeyManager.importKeyPair(privateKeyHex, {
      overwrite: options?.overwrite === true,
    });

    return publicKey;
  }

  /**
   * Validate a recovery phrase without importing it
   */
  static validatePhrase(phrase: string): boolean {
    const normalizedPhrase = phrase.trim().toLowerCase();
    return bip39.validateMnemonic(normalizedPhrase);
  }

  /**
   * Get the word list for autocomplete/validation
   */
  static getWordList(): string[] {
    return bip39.wordlists.english;
  }

  /**
   * Check if a word is valid in the BIP39 word list
   */
  static isValidWord(word: string): boolean {
    return bip39.wordlists.english.includes(word.toLowerCase());
  }

  /**
   * Get suggestions for a partial word
   */
  static getSuggestions(partial: string, limit = 5): string[] {
    const lowerPartial = partial.toLowerCase();
    return bip39.wordlists.english
      .filter((word: string) => word.startsWith(lowerPartial))
      .slice(0, limit);
  }

  /**
   * Derive the public key from a phrase without storing
   * Useful for verification before importing
   */
  static async derivePublicKeyFromPhrase(phrase: string): Promise<string> {
    const normalizedPhrase = phrase.trim().toLowerCase();
    
    if (!bip39.validateMnemonic(normalizedPhrase)) {
      throw new Error('Invalid recovery phrase');
    }

    const seed = await bip39.mnemonicToSeed(normalizedPhrase);
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);
    
    return KeyManager.derivePublicKey(privateKeyHex);
  }

  /**
   * Convert a phrase to its word array
   */
  static phraseToWords(phrase: string): string[] {
    return phrase.trim().toLowerCase().split(/\s+/);
  }

  /**
   * Convert a word array to a phrase string
   */
  static wordsToPhrase(words: string[]): string {
    return words.map(w => w.toLowerCase().trim()).join(' ');
  }
}

export default RecoveryPhraseService;


