/**
 * OxyServices - Unified client for Oxy API and Oxy Cloud
 *
 * # Usage Examples
 *
 * ## Browser (ESM/TypeScript)
 *
 * ```typescript
 * import { OxyServices } from './core/OxyServices';
 *
 * const oxy = new OxyServices({
 *   baseURL: 'https://api.oxy.so',
 *   cloudURL: 'https://cloud.oxy.so',
 * });
 *
 * // Authenticate and fetch user
 * await oxy.setTokens('ACCESS_TOKEN');
 * const user = await oxy.getCurrentUser();
 *
 * // Upload a file (browser File API)
 * const fileInput = document.querySelector('input[type=file]');
 * const file = fileInput.files[0];
 * await oxy.uploadRawFile(file);
 *
 * // Get a file stream URL for <img src>
 * const url = oxy.getFileStreamUrl('fileId');
 * ```
 *
 * ## Node.js (CommonJS/TypeScript)
 *
 * ```typescript
 * import { OxyServices } from './core/OxyServices';
 * import fs from 'fs';
 *
 * const oxy = new OxyServices({
 *   baseURL: 'https://api.oxy.so',
 *   cloudURL: 'https://cloud.oxy.so',
 * });
 *
 * // Authenticate and fetch user
 * await oxy.setTokens('ACCESS_TOKEN');
 * const user = await oxy.getCurrentUser();
 *
 * // Upload a file (Node.js Buffer)
 * const buffer = fs.readFileSync('myfile.png');
 * const blob = new Blob([buffer]);
 * await oxy.uploadRawFile(blob, { filename: 'myfile.png' });
 *
 * // Get a file download URL
 * const url = oxy.getFileDownloadUrl('fileId');
 * ```
 *
 * ## Configuration
 * - `baseURL`: Oxy API endpoint (e.g., https://api.oxy.so)
 * - `cloudURL`: Oxy Cloud/CDN endpoint (e.g., https://cloud.oxy.so)
 *
 * See method JSDoc for more details and options.
 */
import { OxyServicesBase, type OxyConfig } from './OxyServices.base';
import { OxyAuthenticationError, OxyAuthenticationTimeoutError } from './OxyServices.errors';

// Import mixin composition helper
import { composeOxyServices } from './mixins';

/**
 * OxyServices - Unified client library for interacting with the Oxy API
 * 
 * This class provides all API functionality in one simple, easy-to-use interface.
 * 
 * ## Architecture
 * - **HttpClient**: Handles HTTP communication and authentication
 * - **RequestManager**: Handles caching, deduplication, queuing, and retry
 * - **OxyServices**: Provides high-level API methods
 * 
 * ## Mixin Composition
 * The class is composed using TypeScript mixins for better code organization:
 * - **Base**: Core infrastructure (HTTP client, request management, error handling)
 * - **Auth**: Authentication and session management
 * - **User**: User profiles, follow, notifications
 * - **TOTP**: Two-factor authentication enrollment
 * - **Privacy**: Blocked and restricted users
 * - **Language**: Language detection and metadata
 * - **Payment**: Payment processing
 * - **Karma**: Karma system
 * - **Assets**: File upload and asset management
 * - **Developer**: Developer API management
 * - **Location**: Location-based features
 * - **Analytics**: Analytics tracking
 * - **Devices**: Device management
 * - **Utility**: Utility methods and Express middleware
 * 
 * @example
 * ```typescript
 * const oxy = new OxyServices({
 *   baseURL: 'https://api.oxy.so',
 *   cloudURL: 'https://cloud.oxy.so'
 * });
 * ```
 */
// Compose all mixins into the final OxyServices class
const OxyServicesComposed = composeOxyServices();

// Export as a named class to avoid TypeScript issues with anonymous class types
export class OxyServices extends OxyServicesComposed {
  constructor(config: OxyConfig) {
    super(config);
  }
}

// Re-export error classes for convenience
export { OxyAuthenticationError, OxyAuthenticationTimeoutError };

/**
 * Export the default Oxy Cloud URL (for backward compatibility)
 */
export const OXY_CLOUD_URL = 'https://cloud.oxy.so';

/**
 * Export the default Oxy API URL (for documentation)
 */
export const OXY_API_URL = (typeof process !== 'undefined' && process.env && process.env.OXY_API_URL) || 'https://api.oxy.so';

/**
 * Pre-configured client instance for easy import
 * Uses OXY_API_URL as baseURL and OXY_CLOUD_URL as cloudURL
 */
export const oxyClient = new OxyServices({ baseURL: OXY_API_URL, cloudURL: OXY_CLOUD_URL });
