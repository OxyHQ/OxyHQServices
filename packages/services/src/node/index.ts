/**
 * OxyHQServices Node.js Entry Point
 */

// ------------- Core Imports -------------
import { OxyServices, OXY_CLOUD_URL, oxyClient } from '../core'; // Adjusted path
import * as Models from '../models/interfaces'; // Adjusted path

// ------------- Core Exports -------------
export { OxyServices, OXY_CLOUD_URL, oxyClient };

// ------------- Model Exports -------------
export { Models };  // Export all models as a namespace
export * from '../models/interfaces'; // Export all models directly

// Default export for consistency or specific use cases if needed
export default OxyServices;
