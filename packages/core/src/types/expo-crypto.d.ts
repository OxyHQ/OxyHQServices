declare module 'expo-crypto' {
  export enum CryptoDigestAlgorithm {
    SHA256 = 'SHA-256',
    SHA384 = 'SHA-384',
    SHA512 = 'SHA-512',
  }

  export function digestStringAsync(
    algorithm: CryptoDigestAlgorithm,
    data: string,
  ): Promise<string>;

  export function getRandomBytes(byteCount: number): Uint8Array;

  export function getRandomBytesAsync(byteCount: number): Promise<Uint8Array>;
}
