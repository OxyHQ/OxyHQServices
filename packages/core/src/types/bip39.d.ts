declare module 'bip39' {
  export interface Wordlist {
    [index: number]: string;
    length: number;
    getWord(index: number): string;
    getWordIndex(word: string): number;
  }

  export const wordlists: {
    english: string[];
    chinese_simplified: string[];
    chinese_traditional: string[];
    french: string[];
    italian: string[];
    japanese: string[];
    korean: string[];
    spanish: string[];
  };

  // Use Uint8Array instead of Buffer for React Native compatibility
  // In Node.js, Buffer extends Uint8Array so this is compatible
  export function generateMnemonic(strength?: number, rng?: (size: number) => Uint8Array, wordlist?: string[]): string;
  export function mnemonicToSeed(mnemonic: string, passphrase?: string): Promise<Uint8Array>;
  export function mnemonicToSeedSync(mnemonic: string, passphrase?: string): Uint8Array;
  export function mnemonicToEntropy(mnemonic: string, wordlist?: string[]): string;
  export function entropyToMnemonic(entropy: string, wordlist?: string[]): string;
  export function validateMnemonic(mnemonic: string, wordlist?: string[]): boolean;
  export function mnemonicToSeedHex(mnemonic: string, passphrase?: string): Promise<string>;
  export function mnemonicToSeedHexSync(mnemonic: string, passphrase?: string): string;
}


