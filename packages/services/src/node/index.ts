/**
 * OxyHQServices Node.js Entry Point
 */

// ------------- Polyfills -------------
import '../utils/polyfills';

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

// Default export for consistency or specific use cases if needed
export default OxyServices;
