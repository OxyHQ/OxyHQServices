/**
 * OxyServices Core Module - Unified Architecture
 * 
 * This module exports the unified OxyServices class that provides all API functionality
 * in one simple, easy-to-use interface.
 */

// Main OxyServices class (unified)
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices';
export { OXY_CLOUD_URL, oxyClient } from './OxyServices';

// Cross-domain authentication
export { CrossDomainAuth, createCrossDomainAuth } from './CrossDomainAuth';
export type { CrossDomainAuthOptions } from './CrossDomainAuth';

// Centralized auth management
export { AuthManager, createAuthManager } from './AuthManager';
export type { StorageAdapter, AuthStateChangeCallback, AuthMethod, AuthManagerConfig } from './AuthManager';

// Re-export all models and types for convenience
export * from '../models/interfaces';
export * from '../models/session';

// Export device management utilities
export { DeviceManager } from '../utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from '../utils/deviceManager';

// Export language utilities
export { 
  SUPPORTED_LANGUAGES,
  getLanguageMetadata,
  getLanguageName,
  getNativeLanguageName,
  normalizeLanguageCode
} from '../utils/languageUtils';
export type { LanguageMetadata } from '../utils/languageUtils';

// Import for default export
import { OxyServices } from './OxyServices';

// Default export for backward compatibility
export default OxyServices;