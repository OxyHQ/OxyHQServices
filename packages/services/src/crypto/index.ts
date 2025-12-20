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

// Re-export for convenience
export { KeyManager as default } from './keyManager';


