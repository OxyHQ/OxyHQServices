/**
 * Oxy Crypto Module
 * 
 * Provides cryptographic identity management for the Oxy ecosystem.
 * Handles key generation, secure storage, and digital signatures.
 */

// Import polyfills first - this ensures Buffer is available for crypto libraries
import './polyfill';

export { KeyManager, type KeyPair } from './keyManager';
export { 
  SignatureService, 
  type SignedMessage, 
  type AuthChallenge 
} from './signatureService';
export { type BackupData } from './types';

// Export core crypto utilities (shared across platforms)
export * from './core';

// Re-export for convenience
export { KeyManager as default } from './keyManager';

