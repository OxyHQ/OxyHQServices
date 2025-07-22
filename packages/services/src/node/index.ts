/**
 * Node.js-specific exports for OxyHQ Services
 * 
 * This module provides zero-config Express.js middleware and utilities
 * for backend integration with OxyHQ Services.
 */

// Export the zero-config middleware
export {
  createOxyAuth,
  createOptionalOxyAuth,
  createOxyExpressApp,
  type OxyAuthConfig,
  type AuthenticatedRequest
} from './middleware';

// ------------- Core Imports -------------
import { OxyServices, OXY_CLOUD_URL } from '../core'; // Adjusted path
import { createAuth } from './createAuth';
import * as Models from '../models/interfaces'; // Adjusted path

// ------------- Core Exports -------------
export { OxyServices, OXY_CLOUD_URL };

// Zero-config auth and session router
export { createAuth };

// ------------- Model Exports -------------
export { Models };  // Export all models as a namespace
export * from '../models/interfaces'; // Export all models directly
export * from '../models/secureSession';

// Re-export utilities
export { DeviceManager } from '../utils/deviceManager';

// Default export for consistency or specific use cases if needed
export default OxyServices;
