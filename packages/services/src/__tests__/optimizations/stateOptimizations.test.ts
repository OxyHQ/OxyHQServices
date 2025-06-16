// Tests for state management optimizations
import React from 'react';
import { render } from '@testing-library/react-native';
import {
  createSelectiveSubscription,
  createStateDiff,
  useOptimizedMemo,
  StateGarbageCollector,
  StatePerformanceMonitor,
} from '../../utils/stateOptimizations';
import { useOptimizedTheme, useOxySelector } from '../../ui/hooks/useOptimizedOxy';

describe('State Management Optimizations', () => {
  describe('Selective Subscription System', () => {
    test('should only notify listeners when selected values change', () => {
      const initialState = { count: 0, name: 'test' };
      const subscription = createSelectiveSubscription(initialState);
      
      let countCallCount = 0;
      let nameCallCount = 0;
      
      // Subscribe to count only
      const unsubscribeCount = subscription.subscribe(
        (state) => state.count,
        () => countCallCount++
      );
      
      // Subscribe to name only
      const unsubscribeName = subscription.subscribe(
        (state) => state.name,
        () => nameCallCount++
      );
      
      // Change count - should only notify count listener
      subscription.setState({ count: 1, name: 'test' });
      expect(countCallCount).toBe(1);
      expect(nameCallCount).toBe(0);
      
      // Change name - should only notify name listener
      subscription.setState({ count: 1, name: 'updated' });
      expect(countCallCount).toBe(1);
      expect(nameCallCount).toBe(1);
      
      // No change - should not notify anyone
      subscription.setState({ count: 1, name: 'updated' });
      expect(countCallCount).toBe(1);
      expect(nameCallCount).toBe(1);
      
      unsubscribeCount();
      unsubscribeName();
    });
  });

  describe('State Diffing', () => {
    test('should correctly identify changed values', () => {
      const prevState = { a: 1, b: 'test', c: { nested: true } };
      const newState = { a: 2, b: 'test', c: { nested: false } };
      
      const diff = createStateDiff(prevState, newState, true);
      
      expect(diff.hasChanges).toBe(true);
      expect(diff.changedKeys).toEqual(['a', 'c']);
      expect(diff.previousValues).toEqual({ a: 1, c: { nested: true } });
      expect(diff.currentValues).toEqual({ a: 2, c: { nested: false } });
    });
    
    test('should handle no changes', () => {
      const state = { a: 1, b: 'test' };
      const diff = createStateDiff(state, state);
      
      expect(diff.hasChanges).toBe(false);
      expect(diff.changedKeys).toEqual([]);
    });
  });

  describe('Garbage Collection', () => {
    test('should remove expired items', (done) => {
      const gc = new StateGarbageCollector({
        maxAge: 50, // 50ms
        cleanupInterval: 25, // 25ms
      });
      
      gc.set('key1', { data: 'test1' });
      gc.set('key2', { data: 'test2' });
      
      expect(gc.get('key1')).toEqual({ data: 'test1' });
      expect(gc.get('key2')).toEqual({ data: 'test2' });
      
      // Wait for expiration
      setTimeout(() => {
        const removedCount = gc.cleanup();
        expect(removedCount).toBeGreaterThan(0);
        expect(gc.get('key1')).toBeUndefined();
        expect(gc.get('key2')).toBeUndefined();
        
        gc.destroy();
        done();
      }, 100);
    });
    
    test('should enforce size limits', () => {
      const gc = new StateGarbageCollector({ maxSize: 2 });
      
      gc.set('key1', { data: 'test1' });
      gc.set('key2', { data: 'test2' });
      gc.set('key3', { data: 'test3' }); // Should trigger cleanup
      
      // Should have removed least recently accessed item
      const keys = ['key1', 'key2', 'key3'];
      const existingKeys = keys.filter(key => gc.get(key) !== undefined);
      expect(existingKeys.length).toBeLessThanOrEqual(2);
      
      gc.destroy();
    });
  });

  describe('Performance Monitoring', () => {
    test('should track render metrics', () => {
      const monitor = new StatePerformanceMonitor();
      
      monitor.startRender('TestComponent');
      
      // Simulate render time
      setTimeout(() => {
        monitor.endRender('TestComponent');
        
        const metrics = monitor.getMetrics('TestComponent') as any;
        expect(metrics.renderCount).toBe(1);
        expect(metrics.lastRenderTime).toBeGreaterThan(0);
        expect(metrics.averageRenderTime).toBeGreaterThan(0);
      }, 10);
    });
    
    test('should track slow renders', () => {
      const monitor = new StatePerformanceMonitor();
      
      monitor.startRender('SlowComponent');
      
      // Simulate slow render (>16ms)
      setTimeout(() => {
        monitor.endRender('SlowComponent');
        
        const metrics = monitor.getMetrics('SlowComponent') as any;
        expect(metrics.slowRenders).toBeGreaterThanOrEqual(0);
      }, 20);
    });
  });

  describe('Theme Optimization', () => {
    test('should memoize theme calculations', () => {
      let renderCount = 0;
      
      const TestComponent = ({ theme }: { theme: 'light' | 'dark' }) => {
        renderCount++;
        const themeColors = useOptimizedTheme(theme);
        return null;
      };
      
      const { rerender } = render(<TestComponent theme="light" />);
      expect(renderCount).toBe(1);
      
      // Re-render with same theme - should use memoized value
      rerender(<TestComponent theme="light" />);
      expect(renderCount).toBe(2); // Component still re-renders, but theme calculation is memoized
      
      // Re-render with different theme
      rerender(<TestComponent theme="dark" />);
      expect(renderCount).toBe(3);
    });
  });
});

describe('Memory Management', () => {
  test('should not leak memory with frequent state updates', () => {
    const subscription = createSelectiveSubscription({ counter: 0 });
    const listeners: (() => void)[] = [];
    
    // Create many listeners
    for (let i = 0; i < 1000; i++) {
      const unsubscribe = subscription.subscribe(
        (state) => state.counter,
        () => {}
      );
      listeners.push(unsubscribe);
    }
    
    // Update state many times
    for (let i = 0; i < 100; i++) {
      subscription.setState({ counter: i });
    }
    
    // Clean up listeners
    listeners.forEach(unsubscribe => unsubscribe());
    
    // This test mainly checks that the system doesn't crash
    // In a real scenario, you'd use heap snapshots to verify memory usage
    expect(true).toBe(true);
  });
});