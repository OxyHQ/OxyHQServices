/**
 * OxyServices Core Module - Modular Architecture
 * 
 * This module exports the main OxyServices class and all individual service modules
 * for a clean, maintainable, and focused architecture.
 */

// Main OxyServices class (backward compatible)
export { OxyServicesMain as OxyServices } from './OxyServicesMain';

// Individual service classes for focused usage
export { AuthService } from './auth/AuthService';
export { UserService } from './users/UserService';
export { PaymentService } from './payments/PaymentService';
export { KarmaService } from './karma/KarmaService';
export { FileService } from './files/FileService';
export { LocationService } from './locations/LocationService';
export { AnalyticsService } from './analytics/AnalyticsService';
export { DeviceService } from './devices/DeviceService';

// Base class for custom service extensions
export { OxyServices as BaseOxyServices } from './OxyServices';

// Constants
export { OXY_CLOUD_URL } from './files/FileService';

// Re-export all models and types for convenience
export * from '../models/interfaces';
export * from '../models/session';

// Export device management utilities
export { DeviceManager } from '../utils/deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from '../utils/deviceManager';

// Import the main class for default export
import { OxyServicesMain } from './OxyServicesMain';

// Default export for backward compatibility
export default OxyServicesMain;