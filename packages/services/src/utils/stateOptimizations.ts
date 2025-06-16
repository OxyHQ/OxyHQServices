// State management optimizations for reduced re-renders and better performance
import { useCallback, useMemo, useRef, useEffect } from 'react';

/**
 * Selective subscription system to prevent unnecessary re-renders
 * Only re-renders components when specific state slices change
 */
export type StateSelector<T, R> = (state: T) => R;
export type StateListener<T> = (state: T, prevState: T) => void;

export interface SelectiveSubscription<T> {
  subscribe: <R>(selector: StateSelector<T, R>, listener: StateListener<R>) => () => void;
  getState: () => T;
  setState: (newState: T | ((prevState: T) => T)) => void;
}

/**
 * Creates a selective subscription system for state management
 */
export function createSelectiveSubscription<T>(initialState: T): SelectiveSubscription<T> {
  let state = initialState;
  const listeners = new Set<{ selector: StateSelector<T, any>; listener: StateListener<any>; lastValue: any }>();

  const getState = () => state;

  const setState = (newState: T | ((prevState: T) => T)) => {
    const prevState = state;
    state = typeof newState === 'function' ? (newState as (prevState: T) => T)(prevState) : newState;
    
    // Only notify listeners whose selected values have changed
    listeners.forEach(({ selector, listener, lastValue }, subscription) => {
      const currentValue = selector(state);
      if (!Object.is(currentValue, lastValue)) {
        subscription.lastValue = currentValue;
        listener(currentValue, selector(prevState));
      }
    });
  };

  const subscribe = <R>(selector: StateSelector<T, R>, listener: StateListener<R>) => {
    const subscription = {
      selector,
      listener,
      lastValue: selector(state),
    };
    
    listeners.add(subscription);
    
    return () => {
      listeners.delete(subscription);
    };
  };

  return { subscribe, getState, setState };
}

/**
 * State diffing utility to efficiently determine what has changed
 */
export interface StateDiff<T> {
  hasChanges: boolean;
  changedKeys: (keyof T)[];
  previousValues: Partial<T>;
  currentValues: Partial<T>;
}

export function createStateDiff<T extends Record<string, any>>(
  previousState: T,
  currentState: T,
  deepCompare = false
): StateDiff<T> {
  const changedKeys: (keyof T)[] = [];
  const previousValues: Partial<T> = {};
  const currentValues: Partial<T> = {};

  for (const key in currentState) {
    const prevValue = previousState[key];
    const currentValue = currentState[key];
    
    let hasChanged = false;
    
    if (deepCompare && typeof currentValue === 'object' && currentValue !== null) {
      hasChanged = JSON.stringify(prevValue) !== JSON.stringify(currentValue);
    } else {
      hasChanged = !Object.is(prevValue, currentValue);
    }
    
    if (hasChanged) {
      changedKeys.push(key);
      previousValues[key] = prevValue;
      currentValues[key] = currentValue;
    }
  }

  return {
    hasChanges: changedKeys.length > 0,
    changedKeys,
    previousValues,
    currentValues,
  };
}

/**
 * Memory-efficient memoization utility with automatic cleanup
 */
export function createMemoizedComputation<Args extends any[], Return>(
  computeFn: (...args: Args) => Return,
  maxCacheSize = 50
) {
  const cache = new Map<string, { value: Return; timestamp: number; accessCount: number }>();
  
  return (...args: Args): Return => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);
    
    if (cached) {
      cached.accessCount++;
      cached.timestamp = Date.now();
      return cached.value;
    }
    
    // Cleanup cache if it gets too large
    if (cache.size >= maxCacheSize) {
      // Remove least recently used items
      const entries = Array.from(cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest 25% of entries
      const toRemove = Math.floor(maxCacheSize * 0.25);
      for (let i = 0; i < toRemove; i++) {
        cache.delete(entries[i][0]);
      }
    }
    
    const value = computeFn(...args);
    cache.set(key, { value, timestamp: Date.now(), accessCount: 1 });
    
    return value;
  };
}

/**
 * Hook for optimized computed values with dependency tracking
 */
export function useOptimizedMemo<T>(
  computeFn: () => T,
  deps: React.DependencyList,
  options: { 
    shallow?: boolean; 
    debugName?: string;
    enableLogging?: boolean;
  } = {}
): T {
  const { shallow = false, debugName, enableLogging = false } = options;
  const prevDepsRef = useRef<React.DependencyList>();
  const prevValueRef = useRef<T>();
  
  const memoizedValue = useMemo(() => {
    if (enableLogging && debugName) {
      console.log(`[useOptimizedMemo:${debugName}] Computing new value`);
    }
    
    const value = computeFn();
    prevValueRef.current = value;
    return value;
  }, deps);
  
  // Track dependency changes for debugging
  useEffect(() => {
    if (enableLogging && debugName && prevDepsRef.current) {
      const prevDeps = prevDepsRef.current;
      const changedIndices = deps.map((dep, index) => 
        !Object.is(dep, prevDeps[index]) ? index : -1
      ).filter(index => index !== -1);
      
      if (changedIndices.length > 0) {
        console.log(`[useOptimizedMemo:${debugName}] Dependencies changed at indices:`, changedIndices);
      }
    }
    prevDepsRef.current = deps;
  });
  
  if (shallow && prevValueRef.current && typeof memoizedValue === 'object') {
    // Shallow comparison for objects
    const prevValue = prevValueRef.current as any;
    const currentValue = memoizedValue as any;
    
    if (typeof prevValue === 'object' && typeof currentValue === 'object') {
      const prevKeys = Object.keys(prevValue);
      const currentKeys = Object.keys(currentValue);
      
      if (prevKeys.length === currentKeys.length && 
          prevKeys.every(key => Object.is(prevValue[key], currentValue[key]))) {
        return prevValueRef.current;
      }
    }
  }
  
  return memoizedValue;
}

/**
 * Hook for stable callback references that don't cause re-renders
 */
export function useStableCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList
): T {
  const callbackRef = useRef<T>(callback);
  const stableCallbackRef = useRef<T>();
  
  // Update the callback ref when dependencies change
  useEffect(() => {
    callbackRef.current = callback;
  });
  
  // Create stable callback only once
  if (!stableCallbackRef.current) {
    stableCallbackRef.current = ((...args: any[]) => {
      return callbackRef.current(...args);
    }) as T;
  }
  
  return stableCallbackRef.current;
}

/**
 * Garbage collection utility for cleaning up unused state
 */
export interface GarbageCollectionOptions {
  maxAge?: number; // milliseconds
  maxSize?: number; // number of items
  cleanupInterval?: number; // milliseconds
}

export class StateGarbageCollector<T> {
  private items = new Map<string, { value: T; timestamp: number; accessed: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private options: Required<GarbageCollectionOptions>;

  constructor(options: GarbageCollectionOptions = {}) {
    this.options = {
      maxAge: options.maxAge ?? 5 * 60 * 1000, // 5 minutes
      maxSize: options.maxSize ?? 100,
      cleanupInterval: options.cleanupInterval ?? 60 * 1000, // 1 minute
    };
    
    this.startCleanup();
  }

  set(key: string, value: T): void {
    this.items.set(key, {
      value,
      timestamp: Date.now(),
      accessed: Date.now(),
    });
    
    // Immediate cleanup if over size limit
    if (this.items.size > this.options.maxSize) {
      this.cleanup();
    }
  }

  get(key: string): T | undefined {
    const item = this.items.get(key);
    if (item) {
      item.accessed = Date.now();
      return item.value;
    }
    return undefined;
  }

  delete(key: string): boolean {
    return this.items.delete(key);
  }

  cleanup(): number {
    const now = Date.now();
    let removedCount = 0;
    
    // Remove expired items
    for (const [key, item] of this.items.entries()) {
      if (now - item.timestamp > this.options.maxAge) {
        this.items.delete(key);
        removedCount++;
      }
    }
    
    // If still over size limit, remove least recently accessed
    if (this.items.size > this.options.maxSize) {
      const sortedItems = Array.from(this.items.entries())
        .sort((a, b) => a[1].accessed - b[1].accessed);
      
      const toRemove = this.items.size - this.options.maxSize;
      for (let i = 0; i < toRemove; i++) {
        this.items.delete(sortedItems[i][0]);
        removedCount++;
      }
    }
    
    return removedCount;
  }

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.items.clear();
  }
}

/**
 * Performance monitoring utility for state management
 */
export interface PerformanceMetrics {
  renderCount: number;
  averageRenderTime: number;
  lastRenderTime: number;
  slowRenders: number; // renders > 16ms
}

export class StatePerformanceMonitor {
  private metrics = new Map<string, PerformanceMetrics>();
  private renderStartTimes = new Map<string, number>();
  
  startRender(componentName: string): void {
    this.renderStartTimes.set(componentName, performance.now());
  }
  
  endRender(componentName: string): void {
    const startTime = this.renderStartTimes.get(componentName);
    if (!startTime) return;
    
    const renderTime = performance.now() - startTime;
    this.renderStartTimes.delete(componentName);
    
    const existing = this.metrics.get(componentName) || {
      renderCount: 0,
      averageRenderTime: 0,
      lastRenderTime: 0,
      slowRenders: 0,
    };
    
    const newRenderCount = existing.renderCount + 1;
    const newAverageRenderTime = 
      (existing.averageRenderTime * existing.renderCount + renderTime) / newRenderCount;
    
    this.metrics.set(componentName, {
      renderCount: newRenderCount,
      averageRenderTime: newAverageRenderTime,
      lastRenderTime: renderTime,
      slowRenders: existing.slowRenders + (renderTime > 16 ? 1 : 0),
    });
  }
  
  getMetrics(componentName?: string): PerformanceMetrics | Map<string, PerformanceMetrics> {
    if (componentName) {
      return this.metrics.get(componentName) || {
        renderCount: 0,
        averageRenderTime: 0,
        lastRenderTime: 0,
        slowRenders: 0,
      };
    }
    return new Map(this.metrics);
  }
  
  reset(componentName?: string): void {
    if (componentName) {
      this.metrics.delete(componentName);
    } else {
      this.metrics.clear();
    }
  }
}

// Global performance monitor instance
export const globalPerformanceMonitor = new StatePerformanceMonitor();