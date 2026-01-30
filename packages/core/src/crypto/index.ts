/**
 * Oxy Crypto Module
 * 
 * Provides cryptographic identity management for the Oxy ecosystem.
 * Handles key generation, secure storage, digital signatures, and recovery phrases.
 */

// Import polyfills first - this ensures Buffer is available for bip39 and other libraries
import './polyfill';

export { KeyManager, type KeyPair } from './keyManager';
export { 
  SignatureService, 
  type SignedMessage, 
  type AuthChallenge 
} from './signatureService';
export { 
  RecoveryPhraseService, 
  type RecoveryPhraseResult 
} from './recoveryPhrase';

// Re-export for convenience
export { KeyManager as default } from './keyManager';


