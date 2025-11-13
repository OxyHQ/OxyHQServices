export { DeviceManager } from './deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from './deviceManager';

// Request utilities
export { RequestDeduplicator, RequestQueue, SimpleLogger } from './requestUtils';

// Cache utilities
export { TTLCache, createCache, registerCacheForCleanup, unregisterCacheFromCleanup } from './cache';
export type { CacheStats } from './cache';
