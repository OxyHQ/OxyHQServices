/**
 * OxyServices Core Module - Unified Architecture
 * 
 * This module exports the unified OxyServices class that provides all API functionality
 * in one simple, easy-to-use interface.
 */

// Main OxyServices class (unified)
export { OxyServices, OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices';
export { OXY_CLOUD_URL } from './OxyServices';

// Re-export all models and types for convenience
export * from '../models/interfaces';
export * from '../models/session';

// Export device management utilities
export { DeviceManager } from '../utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from '../utils/deviceManager';

// Import for default export
import { OxyServices } from './OxyServices';

// Default export for backward compatibility
export default OxyServices;