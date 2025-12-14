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

export class RecoveryPhraseService {
  /**
   * Generate a new identity with a recovery phrase
   * Returns the mnemonic phrase (should only be shown once to the user)
   */
  static async generateIdentityWithRecovery(): Promise<RecoveryPhraseResult> {
    // Generate 128-bit entropy for 12-word mnemonic
    const mnemonic = bip39.generateMnemonic(128);
    
    // Derive private key from mnemonic
    // Using the seed directly as the private key (simplified approach)
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    // Use first 32 bytes of seed as private key
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);
    
    // Import the derived key pair
    const publicKey = await KeyManager.importKeyPair(privateKeyHex);

    return {
      phrase: mnemonic,
      words: mnemonic.split(' '),
      publicKey,
    };
  }

  /**
   * Generate a 24-word recovery phrase for higher security
   */
  static async generateIdentityWithRecovery24(): Promise<RecoveryPhraseResult> {
    // Generate 256-bit entropy for 24-word mnemonic
    const mnemonic = bip39.generateMnemonic(256);
    
    const seed = await bip39.mnemonicToSeed(mnemonic);
    const seedSlice = seed.subarray ? seed.subarray(0, 32) : seed.slice(0, 32);
    const privateKeyHex = toHex(seedSlice);
    const publicKey = await KeyManager.importKeyPair(privateKeyHex);

    return {
      phrase: mnemonic,
      words: mnemonic.split(' '),
      publicKey,
    };
  }

  /**
   * Restore an identity from a recovery phrase
   */
  static async restoreFromPhrase(phrase: string): Promise<string> {
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
    const publicKey = await KeyManager.importKeyPair(privateKeyHex);

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
  static getSuggestions(partial: string, limit: number = 5): string[] {
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


