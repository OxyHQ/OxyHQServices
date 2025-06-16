export { DeviceManager } from './deviceManager';
export type { DeviceFingerprint, StoredDeviceInfo } from './deviceManager';

// Export state optimization utilities
export {
  createSelectiveSubscription,
  createStateDiff,
  createMemoizedComputation,
  useOptimizedMemo,
  useStableCallback,
  StateGarbageCollector,
  StatePerformanceMonitor,
  globalPerformanceMonitor
} from './stateOptimizations';
export type {
  StateSelector,
  StateListener,
  SelectiveSubscription,
  StateDiff,
  GarbageCollectionOptions,
  PerformanceMetrics
} from './stateOptimizations';
